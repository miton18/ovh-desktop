use tauri::menu::{AboutMetadata, CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Métadonnées de la fenêtre « À propos ».
///
/// `comments` porte la mention de non-affiliation : c'est le seul endroit de
/// l'application où quelqu'un vient chercher qui édite ce logiciel.
///
/// Attention à la portabilité : macOS ignore `comments`, `authors`, `license` et
/// `website` dans sa fenêtre native. Sur cette plateforme, la mention devra être
/// rappelée ailleurs — un écran « À propos » maison, le jour où l'on en aura un.
fn about_metadata<'a>() -> AboutMetadata<'a> {
    AboutMetadata {
        name: Some("O.V.H.".into()),
        version: Some(env!("CARGO_PKG_VERSION").into()),
        authors: Some(
            env!("CARGO_PKG_AUTHORS")
                .split(':')
                .filter(|a| !a.is_empty())
                .map(str::to_owned)
                .collect(),
        ),
        comments: Some(
            "Console de management OVHcloud alternative, pensée pour être compréhensible.\n\n\
             O.V.H. signifie « Olès Va Hurler ». Client tiers, sans aucun lien avec \
             OVHcloud SAS : les points du nom le distinguent de la marque officielle."
                .into(),
        ),
        copyright: Some(format!("© {} {}", 2026, env!("CARGO_PKG_AUTHORS"))),
        ..Default::default()
    }
}

/// Préfixe des entrées « basculer vers ce compte ».
const ACCOUNT_PREFIX: &str = "account:";

/// Menu applicatif. Les ids sont des chaînes libres : on les réutilise dans
/// `handle_menu_event` et on les relaie au frontend via l'event `menu-action`.
///
/// Le sous-menu « Comptes » est construit à partir du registre : il change quand
/// le registre change, d'où [`refresh`].
pub fn build<R: Runtime>(
    app: &AppHandle<R>,
    registry: &crate::ovh::accounts::Registry,
) -> tauri::Result<Menu<R>> {
    let file = Submenu::with_items(
        app,
        "Fichier",
        true,
        &[
            &MenuItem::with_id(app, "settings", "Préférences…", true, Some("CmdOrCtrl+,"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some("Quitter"))?,
        ],
    )?;

    let edit = Submenu::with_items(
        app,
        "Édition",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    // Un menu « Comptes » vide n'aurait rien à proposer : dans ce cas il ne
    // contient que l'ajout, et c'est suffisant.
    let mut account_items: Vec<Box<dyn tauri::menu::IsMenuItem<R>>> = Vec::new();
    for account in &registry.accounts {
        let checked = registry.active.as_deref() == Some(account.id.as_str());
        account_items.push(Box::new(CheckMenuItem::with_id(
            app,
            format!("{ACCOUNT_PREFIX}{}", account.id),
            format!("{} — {}", account.display_name(), account.endpoint.label()),
            true,
            checked,
            None::<&str>,
        )?));
    }
    if !registry.accounts.is_empty() {
        account_items.push(Box::new(PredefinedMenuItem::separator(app)?));
    }
    account_items.push(Box::new(MenuItem::with_id(
        app,
        "account-add",
        "Ajouter un compte…",
        true,
        None::<&str>,
    )?));

    let accounts = Submenu::with_items(
        app,
        "Comptes",
        true,
        &account_items.iter().map(|i| i.as_ref()).collect::<Vec<_>>(),
    )?;

    let help = Submenu::with_items(
        app,
        "Aide",
        true,
        &[
            &MenuItem::with_id(app, "docs", "Documentation Tauri", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            // Élément prédéfini : chaque plateforme ouvre sa propre fenêtre
            // « À propos », native, sans code d'affichage de notre côté.
            &PredefinedMenuItem::about(app, Some("À propos de O.V.H."), Some(about_metadata()))?,
        ],
    )?;

    Menu::with_items(app, &[&file, &accounts, &edit, &help])
}

/// Reconstruit le menu après un changement du registre des comptes.
///
/// Un menu qui diverge du registre propose de basculer vers un compte qui
/// n'existe plus : l'échec serait silencieux et incompréhensible.
pub fn refresh<R: Runtime>(app: &AppHandle<R>, registry: &crate::ovh::accounts::Registry) {
    match build(app, registry) {
        Ok(menu) => {
            if let Err(e) = app.set_menu(menu) {
                log::error!("mise à jour du menu impossible: {e}");
            }
        }
        Err(e) => log::error!("reconstruction du menu impossible: {e}"),
    }
}

/// Routage commun au menu applicatif et au menu du tray.
pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match id {
        "docs" => {
            use tauri_plugin_opener::OpenerExt;
            if let Err(e) = app.opener().open_url("https://v2.tauri.app/", None::<&str>) {
                log::error!("ouverture de l'URL impossible: {e}");
            }
        }
        "show" => show_main_window(app),
        "quit" => app.exit(0),
        id if id.starts_with(ACCOUNT_PREFIX) => {
            // La bascule touche le trousseau et le disque : elle ne peut pas se
            // faire dans le fil du menu.
            let account_id = id[ACCOUNT_PREFIX.len()..].to_owned();
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let state = app.state::<crate::ovh::commands::OvhState>();
                match crate::ovh::commands::accounts_select(app.clone(), state, account_id).await {
                    // Le frontend recharge : le compte actif a changé sous ses pieds.
                    Ok(account) => {
                        if let Err(e) = app.emit("account-changed", account.id) {
                            log::error!("emit account-changed: {e}");
                        }
                    }
                    Err(e) => log::error!("bascule de compte impossible: {e}"),
                }
            });
        }
        other => {
            // Tout le reste part au frontend, qui décide quoi en faire.
            if let Err(e) = app.emit("menu-action", other) {
                log::error!("emit menu-action: {e}");
            }
        }
    }
}

pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

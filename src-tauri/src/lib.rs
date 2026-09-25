mod gtk_noise;
mod menu;
pub mod ovh;
mod tray;

use tauri::{Manager, WindowEvent};
use tauri_plugin_log::{Target, TargetKind};

/// Part de l'écran occupée par la fenêtre au premier lancement.
const WINDOW_SCREEN_RATIO: f64 = 0.82;
/// Bornes logiques : au-delà, une fenêtre plus grande ne sert plus à rien et
/// éloigne la barre latérale du contenu sur un ultra-large ou un 4K.
const WINDOW_MAX_LOGICAL: (f64, f64) = (1760.0, 1120.0);

/// Dimensionne la fenêtre principale d'après l'écran qui l'accueille.
///
/// `tauri.conf.json` ne sait exprimer qu'une taille absolue : 900×700 est
/// à l'étroit sur un écran de bureau et déborde sur un petit portable. On mesure
/// donc l'écran au démarrage. Un échec n'est pas bloquant — la fenêtre garde la
/// taille de la configuration.
fn size_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let monitor = match window.current_monitor() {
        Ok(Some(m)) => m,
        Ok(None) => return,
        Err(e) => {
            log::warn!("écran non identifié, taille de fenêtre par défaut: {e}");
            return;
        }
    };

    let screen = monitor.size();
    let scale = monitor.scale_factor();
    let width = (screen.width as f64 * WINDOW_SCREEN_RATIO).min(WINDOW_MAX_LOGICAL.0 * scale);
    let height = (screen.height as f64 * WINDOW_SCREEN_RATIO).min(WINDOW_MAX_LOGICAL.1 * scale);

    if let Err(e) = window.set_size(tauri::PhysicalSize::new(width as u32, height as u32)) {
        log::warn!("redimensionnement impossible: {e}");
        return;
    }
    // Recentrer après coup : la fenêtre a été centrée à son ancienne taille.
    if let Err(e) = window.center() {
        log::warn!("recentrage impossible: {e}");
    }
    log::info!(
        "fenêtre {}×{} px sur un écran de {}×{} (échelle {scale})",
        width as u32,
        height as u32,
        screen.width,
        screen.height
    );
}

/// Point d'entrée unique : `main.rs` (desktop) comme les cibles mobiles
/// appellent cette fonction.
pub fn run() {
    // Avant toute construction de widget, sinon les messages passent devant.
    gtk_noise::install_filter();

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    // Un fichier tournant dans le dossier de logs de l'app.
                    Target::new(TargetKind::LogDir { file_name: None }),
                    // Renvoie aussi les logs Rust dans la console du webview.
                    Target::new(TargetKind::Webview),
                ])
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                // Les dépendances bavardent en DEBUG — keyring_core écrit
                // quatre lignes par lecture du trousseau, zbus davantage.
                // On les ramène à Warn pour que nos traces restent lisibles.
                .level_for("keyring_core", log::LevelFilter::Warn)
                .level_for("zbus", log::LevelFilter::Warn)
                .level_for("tracing", log::LevelFilter::Warn)
                // reqwest et hyper décrivent leurs connexions et leurs trames :
                // c'est du bruit face à la ligne « méthode URL → code » que le
                // client émet lui-même pour chaque appel.
                .level_for("reqwest", log::LevelFilter::Warn)
                .level_for("hyper_util", log::LevelFilter::Warn)
                .level_for("hyper", log::LevelFilter::Warn)
                .level_for("rustls", log::LevelFilter::Warn)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();

            let user_agent = format!("{}/{}", app.package_info().name, app.package_info().version);
            // L'endpoint retenu au dernier lancement décide de la racine et de
            // la branche : Kimsufi et So you Start ne servent que `/1.0`.
            let endpoint = ovh::preferences::load_endpoint(&handle);
            let registry = ovh::accounts::bootstrap(&handle, endpoint);

            app.manage(ovh::commands::OvhState {
                client: ovh::OvhClient::new(
                    registry
                        .active_account()
                        .map(|a| a.endpoint)
                        .unwrap_or(endpoint),
                    &user_agent,
                )?,
                accounts: std::sync::RwLock::new(registry.clone()),
            });

            app.set_menu(menu::build(&handle, &registry)?)?;
            app.on_menu_event(|app, event| {
                menu::handle_menu_event(app, event.id().as_ref());
            });

            tray::build(&handle)?;
            size_main_window(&handle);

            log::info!(
                "application démarrée ({user_agent}) sur {} ({})",
                endpoint.label(),
                endpoint.root()
            );
            Ok(())
        })
        .on_window_event(|window, event| {
            // Fermer la fenêtre met l'app dans le tray au lieu de la quitter ;
            // `Quitter` (menu ou tray) reste le seul vrai moyen de sortir.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            ovh::commands::ovh_create_app_url,
            ovh::commands::ovh_endpoints,
            ovh::commands::accounts_list,
            ovh::commands::accounts_add,
            ovh::commands::accounts_select,
            ovh::commands::accounts_remove,
            ovh::commands::accounts_rename,
            ovh::commands::ovh_set_application,
            ovh::commands::ovh_status,
            ovh::commands::ovh_status_local,
            ovh::commands::ovh_authorize,
            ovh::commands::ovh_confirm_authorization,
            ovh::commands::ovh_logout,
            ovh::commands::ovh_credential_state,
            ovh::commands::ovh_reset_application,
            ovh::hosting::commands::hostings_list,
            ovh::hosting::commands::hostings_fetch,
            ovh::hosting::commands::hosting_get,
            ovh::hosting::commands::hosting_offer_capabilities,
            ovh::hosting::commands::hosting_attached_domains,
            ovh::hosting::commands::hosting_attached_domain_create,
            ovh::hosting::commands::hosting_attached_domain_update,
            ovh::hosting::commands::hosting_attached_domain_delete,
            ovh::hosting::commands::hosting_users,
            ovh::hosting::commands::hosting_user_create,
            ovh::hosting::commands::hosting_user_update,
            ovh::hosting::commands::hosting_user_change_password,
            ovh::hosting::commands::hosting_user_delete,
            ovh::hosting::commands::hosting_databases,
            ovh::hosting::commands::hosting_database_dumps,
            ovh::hosting::commands::hosting_database_dump_create,
            ovh::hosting::commands::hosting_crons,
            ovh::hosting::commands::hosting_cron_create,
            ovh::hosting::commands::hosting_cron_delete,
            ovh::hosting::commands::hosting_env_vars,
            ovh::hosting::commands::hosting_env_var_create,
            ovh::hosting::commands::hosting_env_var_delete,
            ovh::hosting::commands::hosting_runtimes,
            ovh::hosting::commands::hosting_ssl,
            ovh::hosting::commands::hosting_tasks,
            ovh::me::commands::me_contact_get,
            ovh::me::commands::me_contacts_resolve,
            ovh::me::commands::me_contacts_list,
            ovh::me::commands::me_contact_update,
            ovh::domain::commands::domains_list,
            ovh::domain::commands::domains_fetch,
            ovh::domain::commands::domain_get,
            ovh::domain::commands::domain_update,
            ovh::domain::commands::domain_auth_info,
            ovh::domain::commands::domain_service_info,
            ovh::domain::commands::domain_set_renew,
            ovh::domain::commands::zones_list,
            ovh::domain::commands::zone_get,
            ovh::domain::commands::zone_status,
            ovh::domain::commands::zone_capabilities,
            ovh::domain::commands::zone_soa_get,
            ovh::domain::commands::zone_soa_set,
            ovh::domain::commands::zone_refresh,
            ovh::domain::commands::zone_export,
            ovh::domain::commands::zone_import,
            ovh::domain::commands::zone_dnssec_get,
            ovh::domain::commands::zone_dnssec_enable,
            ovh::domain::commands::zone_dnssec_disable,
            ovh::domain::commands::records_list_ids,
            ovh::domain::commands::records_fetch,
            ovh::domain::commands::record_get,
            ovh::domain::commands::record_create,
            ovh::domain::commands::record_update,
            ovh::domain::commands::record_delete,
            ovh::domain::commands::dynhost_logins,
            ovh::domain::commands::dynhost_login_create,
            ovh::domain::commands::dynhost_login_update,
            ovh::domain::commands::dynhost_login_change_password,
            ovh::domain::commands::dynhost_login_delete,
            ovh::domain::commands::dynhost_records,
            ovh::domain::commands::name_servers,
            ovh::domain::commands::name_server_status,
            ovh::domain::commands::name_servers_replace,
            ovh::domain::commands::glue_records,
            ovh::domain::commands::glue_record_create,
            ovh::domain::commands::glue_record_update,
            ovh::domain::commands::glue_record_delete,
            ovh::domain::commands::contacts_list,
            ovh::domain::commands::contact_get,
            ovh::domain::commands::contact_update,
            ovh::domain::commands::domain_change_contacts,
            ovh::domain::commands::domain_tasks,
            ovh::domain::commands::zone_tasks,
            ovh::domain::commands::domain_task_act,
            ovh::domain::commands::zone_task_act,
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application Tauri");
}

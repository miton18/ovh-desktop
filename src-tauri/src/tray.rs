use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Runtime};

use crate::menu::{handle_menu_event, show_main_window};

pub fn build<R: Runtime>(app: &AppHandle<R>) -> Result<(), Box<dyn std::error::Error>> {
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "show", "Afficher la fenêtre", true, None::<&str>)?,
            &MenuItem::with_id(app, "settings", "Préférences…", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?,
        ],
    )?;

    TrayIconBuilder::with_id("main")
        // L'icône du tray réutilise celle de la fenêtre (cf. `bundle.icon`).
        .icon(
            app.default_window_icon()
                .cloned()
                .ok_or("icône par défaut absente de tauri.conf.json")?,
        )
        .tooltip("O.V.H.")
        .menu(&menu)
        // Sur Windows/Linux le clic gauche doit rouvrir la fenêtre, pas le menu.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| handle_menu_event(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

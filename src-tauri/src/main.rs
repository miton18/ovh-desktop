// Empêche l'ouverture d'une console Windows en release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ovh_desktop_lib::run()
}

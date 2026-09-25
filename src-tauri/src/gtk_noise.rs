//! Filtrage des messages GLib bruyants, sous Linux.
//!
//! Trois messages connus polluent la sortie sans rien signaler d'actionnable :
//!
//! - deux viennent du tray — vérifié par expérience, en désactivant sa
//!   construction ils disparaissent — et relèvent de `tray-icon` et de la
//!   bibliothèque système, pas de nous ;
//! - le troisième vient de notre propre reconstruction du menu applicatif, à
//!   chaque changement du registre des comptes.
//!
//! Le filtre s'installe sur le **writer** de GLib, pas sur ses gestionnaires de
//! log. C'est le seul point de passage commun : les gestionnaires classiques
//! (`log_set_handler`, `log_set_default_handler`) ne captent que l'ancien chemin
//! `g_log`, et laissaient passer le message du menu, émis par GTK via le
//! journal structuré. Vérifié à l'exécution, pas déduit.
//!
//! Tout ce qui n'est pas connu comme inoffensif part dans nos logs applicatifs,
//! au bon niveau : un vrai `Gtk-CRITICAL` reste donc visible.

#[cfg(target_os = "linux")]
pub fn install_filter() {
    use glib::{LogLevel, LogWriterOutput};

    /// Le tray interroge le facteur d'échelle sur un objet qui n'est pas encore
    /// un widget GTK. Cosmétique, et hors de notre portée (upstream `tray-icon`).
    const TRAY_SCALE_FACTOR: &str = "gtk_widget_get_scale_factor";
    /// La bibliothèque système annonce sa propre dépréciation au chargement.
    const APPINDICATOR_DEPRECATED: &str = "libayatana-appindicator is deprecated";
    /// Reconstruire le menu laisse GTK avec l'accélérateur de l'ancien menu dans
    /// son groupe. Sans conséquence : le nouveau menu réinstalle le sien.
    const STALE_ACCELERATOR: &str = "installed in accel group";

    glib::log_set_writer_func(move |level, fields| {
        let mut domain = None;
        let mut message = None;
        for field in fields {
            match field.key() {
                "GLIB_DOMAIN" => domain = field.value_str(),
                "MESSAGE" => message = field.value_str(),
                _ => {}
            }
        }

        let text = message.unwrap_or_default();
        if text.contains(TRAY_SCALE_FACTOR)
            || text.contains(APPINDICATOR_DEPRECATED)
            || text.contains(STALE_ACCELERATOR)
        {
            // Conservé en `trace` : invisible par défaut, retrouvable au besoin.
            log::trace!("{}: {text}", domain.unwrap_or("glib"));
            return LogWriterOutput::Handled;
        }

        let domain = domain.unwrap_or("glib");
        match level {
            LogLevel::Error | LogLevel::Critical => log::error!("{domain}: {text}"),
            LogLevel::Warning => log::warn!("{domain}: {text}"),
            LogLevel::Message | LogLevel::Info => log::info!("{domain}: {text}"),
            LogLevel::Debug => log::debug!("{domain}: {text}"),
        }
        LogWriterOutput::Handled
    });
}

#[cfg(not(target_os = "linux"))]
pub fn install_filter() {}

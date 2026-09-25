//! Préférences non secrètes, persistées à côté de la configuration de l'app.
//!
//! L'endpoint choisi n'est pas un secret : il n'a rien à faire dans le trousseau
//! du système, qui coûte un aller-retour D-Bus et demande une session
//! déverrouillée. Un fichier dans le dossier de configuration suffit.

use std::path::PathBuf;

use tauri::{AppHandle, Manager, Runtime};

use super::endpoint::Endpoint;
use super::error::{OvhError, OvhResult};

const FILE: &str = "endpoint";

fn path<R: Runtime>(app: &AppHandle<R>) -> OvhResult<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| OvhError::Internal(format!("dossier de configuration: {e}")))?;
    Ok(dir.join(FILE))
}

/// Endpoint enregistré, ou celui par défaut.
///
/// Une valeur illisible ou inconnue n'est pas une erreur bloquante : on repart
/// du défaut plutôt que d'empêcher l'application de démarrer.
pub fn load_endpoint<R: Runtime>(app: &AppHandle<R>) -> Endpoint {
    let Ok(file) = path(app) else {
        return Endpoint::default();
    };
    match std::fs::read_to_string(&file) {
        Ok(raw) => Endpoint::from_id(raw.trim()).unwrap_or_else(|| {
            log::warn!(
                "endpoint enregistré inconnu ({:?}), retour au défaut",
                raw.trim()
            );
            Endpoint::default()
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Endpoint::default(),
        Err(e) => {
            log::warn!("lecture de l'endpoint impossible: {e}");
            Endpoint::default()
        }
    }
}

pub fn save_endpoint<R: Runtime>(app: &AppHandle<R>, endpoint: Endpoint) -> OvhResult<()> {
    let file = path(app)?;
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| OvhError::Internal(format!("création de {}: {e}", dir.display())))?;
    }
    std::fs::write(&file, endpoint.id())
        .map_err(|e| OvhError::Internal(format!("écriture de {}: {e}", file.display())))
}

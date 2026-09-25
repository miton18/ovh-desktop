//! Client OVHcloud : endpoints, credentials, signature, appels et modèles.

pub mod accounts;
pub mod auth;
pub mod client;
pub mod commands;
pub mod credentials;
pub mod domain;
pub mod embedded_app;
pub mod endpoint;
pub mod error;
pub mod hosting;
pub mod me;
pub mod models;
pub mod preferences;
mod signer;

pub use client::OvhClient;
pub use error::OvhError;

use error::OvhResult;

/// Exécute une opération bloquante hors du runtime async.
///
/// Le trousseau du système parle D-Bus (Linux) ou passe par des API système
/// synchrones (macOS, Windows) : l'appeler directement depuis une commande async
/// bloquerait un worker tokio.
pub(crate) async fn blocking<T, F>(f: F) -> OvhResult<T>
where
    F: FnOnce() -> OvhResult<T> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| OvhError::Keyring(format!("tâche interrompue: {e}")))?
}

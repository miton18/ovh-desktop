//! Erreurs propres au client OVH.

use serde::Serialize;

/// Corps d'erreur renvoyé par l'API OVHcloud.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct OvhApiError {
    /// Classe d'erreur OVH, ex. `Client::Unauthorized`, `Client::NotFound`.
    pub class: Option<String>,
    pub message: String,
}

#[derive(Debug, thiserror::Error)]
pub enum OvhError {
    #[error("aucune application OVH disponible : binaire compilé sans application embarquée et aucune fournie")]
    NoApplication,

    #[error("aucune credential enregistrée : valide l'accès à ton compte OVH")]
    NotConfigured,

    #[error("credential en attente de validation par l'utilisateur")]
    PendingValidation,

    #[error("credential refusée ou expirée (état: {0})")]
    CredentialUnusable(String),

    #[error("API OVH {status} [{class}]: {message}")]
    Api {
        status: u16,
        class: String,
        message: String,
    },

    #[error("trousseau du système: {0}")]
    Keyring(String),

    #[error("réseau: {0}")]
    Network(#[from] reqwest::Error),

    #[error("réponse illisible: {0}")]
    Decode(String),

    #[error("erreur interne: {0}")]
    Internal(String),
}

impl OvhError {
    /// Discriminant stable, exposé au frontend pour router l'affichage.
    pub fn kind(&self) -> &'static str {
        match self {
            OvhError::NoApplication => "noApplication",
            OvhError::NotConfigured => "notConfigured",
            OvhError::PendingValidation => "pendingValidation",
            OvhError::CredentialUnusable(_) => "credentialUnusable",
            OvhError::Api { status: 401, .. } => "unauthorized",
            OvhError::Api { status: 403, .. } => "forbidden",
            OvhError::Api { status: 404, .. } => "notFound",
            OvhError::Api { .. } => "api",
            OvhError::Keyring(_) => "keyring",
            OvhError::Network(_) => "network",
            OvhError::Decode(_) => "decode",
            OvhError::Internal(_) => "internal",
        }
    }
}

impl From<keyring::Error> for OvhError {
    fn from(e: keyring::Error) -> Self {
        match e {
            keyring::Error::NoEntry => OvhError::NotConfigured,
            other => OvhError::Keyring(other.to_string()),
        }
    }
}

impl Serialize for OvhError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("OvhError", 2)?;
        s.serialize_field("kind", self.kind())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

pub type OvhResult<T> = std::result::Result<T, OvhError>;

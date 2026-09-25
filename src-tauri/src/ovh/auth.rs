//! Obtention et vérification de la délégation d'accès (« consumer key »).
//!
//! Le protocole OVH sépare deux choses :
//! 1. l'**application** (`applicationKey` + `applicationSecret`), créée une fois
//!    par l'utilisateur sur <https://eu.api.ovh.com/createApp/> ;
//! 2. la **consumer key**, qui matérialise l'accord de l'utilisateur pour un
//!    ensemble de routes. On la demande par `POST /auth/credential`, puis
//!    l'utilisateur la valide dans son navigateur sur `validationUrl`.
//!
//! L'application ne contient aucun secret embarqué : une application desktop ne
//! peut pas garder un `applicationSecret` confidentiel — il serait extractible
//! du binaire par n'importe qui. C'est donc l'utilisateur qui fournit le sien.

use serde::{Deserialize, Serialize};

use super::client::OvhClient;
use super::credentials::Credentials;
use super::error::{OvhError, OvhResult};

/// Toutes les méthodes présentes dans `auth.HTTPMethodEnum`.
const ALL_METHODS: [&str; 5] = ["GET", "POST", "PUT", "DELETE", "PATCH"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessRule {
    pub method: String,
    pub path: String,
}

/// Droit sur l'intégralité de l'API EU : `/*` pour chaque méthode.
pub fn full_api_access_rules() -> Vec<AccessRule> {
    ALL_METHODS
        .iter()
        .map(|m| AccessRule {
            method: (*m).to_owned(),
            path: "/*".to_owned(),
        })
        .collect()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CredentialRequestBody {
    access_rules: Vec<AccessRule>,
    #[serde(skip_serializing_if = "Option::is_none")]
    redirection: Option<String>,
}

/// Réponse de `POST /auth/credential` (`auth.ApiCredentialRequest`).
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialRequest {
    pub consumer_key: String,
    pub state: CredentialState,
    pub validation_url: String,
}

/// `auth.CredentialStateEnum`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CredentialState {
    Expired,
    PendingValidation,
    Refused,
    Validated,
}

/// `auth.ApiCredential`, renvoyé par `GET /auth/currentCredential`.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiCredential {
    pub credential_id: i64,
    pub application_id: i64,
    pub status: CredentialState,
    pub creation: String,
    pub last_use: Option<String>,
    pub expiration: Option<String>,
    pub ovh_support: bool,
    pub rules: Vec<AccessRule>,
    pub allowed_i_ps: Option<Vec<String>>,
}

/// `auth.Details`, renvoyé par `GET /auth/details`.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthDetails {
    /// Identifiant client OVH, du type `ab12345-ovh`.
    pub account: String,
    pub method: String,
    pub user: Option<String>,
    pub description: Option<String>,
    pub identities: Vec<String>,
    pub roles: Option<Vec<String>>,
    /// `None` signifie « toutes les routes », ce qu'on demande ici.
    pub allowed_routes: Option<Vec<AccessRule>>,
}

/// Demande une délégation sur toute l'API. Non authentifié : seule la clé
/// d'application est nécessaire, la consumer key n'existe pas encore.
pub async fn request_full_api_credential(
    client: &OvhClient,
    creds: &Credentials,
    redirection: Option<String>,
) -> OvhResult<CredentialRequest> {
    let body = CredentialRequestBody {
        access_rules: full_api_access_rules(),
        redirection,
    };
    client
        .call_unauthenticated(
            creds,
            reqwest::Method::POST,
            "/auth/credential",
            Some(&body),
        )
        .await
}

pub async fn current_credential(
    client: &OvhClient,
    creds: &Credentials,
) -> OvhResult<ApiCredential> {
    client
        .call::<ApiCredential>(
            creds,
            reqwest::Method::GET,
            "/auth/currentCredential",
            None::<&()>,
        )
        .await
}

pub async fn details(client: &OvhClient, creds: &Credentials) -> OvhResult<AuthDetails> {
    client
        .call(creds, reqwest::Method::GET, "/auth/details", None::<&()>)
        .await
}

/// Invalide la consumer key côté OVH. Le nettoyage du trousseau est à la charge
/// de l'appelant : une erreur réseau ici ne doit pas empêcher d'oublier la clé.
pub async fn logout(client: &OvhClient, creds: &Credentials) -> OvhResult<()> {
    client
        .call::<serde_json::Value>(creds, reqwest::Method::POST, "/auth/logout", None::<&()>)
        .await?;
    Ok(())
}

/// Traduit un état non exploitable en erreur typée.
pub fn ensure_validated(state: CredentialState) -> OvhResult<()> {
    match state {
        CredentialState::Validated => Ok(()),
        CredentialState::PendingValidation => Err(OvhError::PendingValidation),
        CredentialState::Expired => Err(OvhError::CredentialUnusable("expired".into())),
        CredentialState::Refused => Err(OvhError::CredentialUnusable("refused".into())),
    }
}

//! Stockage des secrets, réparti en deux natures distinctes.
//!
//! - **L'application** (clé + secret) identifie le *logiciel*. Elle vaut pour un
//!   endpoint, pas pour un compte : tous les comptes d'une même racine la
//!   partagent. Rangée sous `app:<endpoint>`.
//! - **La consumer key** matérialise l'accord d'*un utilisateur*. Il y en a une
//!   par compte, et un client OVHcloud a souvent plusieurs NIC. Rangée sous
//!   `account:<id>`.
//!
//! Les deux vivent dans le magasin de secrets du système : `keyring` route vers
//! Keychain (macOS), Credential Manager (Windows) et le Secret Service —
//! gnome-keyring / KWallet — sur Linux. Sur Linux ce n'est pas une enclave
//! matérielle : c'est le trousseau de session, chiffré au repos et déverrouillé
//! à l'ouverture de session. C'est le meilleur magasin standard disponible.

use serde::{Deserialize, Serialize};

use super::embedded_app;
use super::endpoint::Endpoint;
use super::error::{OvhError, OvhResult};

/// Nom du service sous lequel les entrées sont rangées dans le trousseau.
const SERVICE: &str = "O.V.H.";

/// Application OVH : ce qui identifie le logiciel, pas l'utilisateur.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Application {
    pub key: String,
    pub secret: String,
}

/// Contenu de l'entrée `app:<endpoint>`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct StoredApplication {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    application: Option<Application>,
}

/// Contenu de l'entrée `account:<id>`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StoredAccount {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub consumer_key: Option<String>,
    /// La consumer key a-t-elle été validée par l'utilisateur dans son navigateur.
    ///
    /// Elle est enregistrée dès sa création pour que l'autorisation survive à un
    /// redémarrage, mais une clé non validée est **refusée par l'API** (403
    /// `Client::Forbidden`). La confondre avec une connexion active mène droit
    /// dans une impasse : ce drapeau existe pour ne pas commettre cette erreur.
    #[serde(default)]
    pub consumer_key_validated: bool,
}

/// Les trois clés du protocole OVH, prêtes à signer.
#[derive(Debug, Clone)]
pub struct Credentials {
    pub application_key: String,
    pub application_secret: String,
    pub consumer_key: Option<String>,
    pub consumer_key_validated: bool,
}

impl Credentials {
    /// Une signature est possible : la clé existe. Ne dit rien de sa validité.
    pub fn is_complete(&self) -> bool {
        self.consumer_key.is_some()
    }
}

/// D'où vient l'application utilisée — l'interface l'affiche dans les réglages.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ApplicationSource {
    /// Embarquée à la compilation.
    Embedded,
    /// Fournie par l'utilisateur, elle prime.
    UserSupplied,
    /// Ni l'une ni l'autre : rien ne peut être signé.
    Missing,
}

/// Ne jamais logger les credentials directement : ce Debug masque les secrets.
pub struct Redacted<'a>(pub &'a Credentials);

impl std::fmt::Debug for Redacted<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Credentials")
            .field("application_key", &self.0.application_key)
            .field("application_secret", &"<redacted>")
            .field(
                "consumer_key",
                &self.0.consumer_key.as_ref().map(|_| "<redacted>"),
            )
            .field("consumer_key_validated", &self.0.consumer_key_validated)
            .finish()
    }
}

fn entry(user: &str) -> OvhResult<keyring::Entry> {
    Ok(keyring::Entry::new(SERVICE, user)?)
}

fn read<T: for<'de> Deserialize<'de> + Default>(user: &str) -> OvhResult<T> {
    match entry(user)?.get_password() {
        Ok(raw) => serde_json::from_str(&raw)
            .map_err(|e| OvhError::Decode(format!("trousseau illisible ({user}): {e}"))),
        Err(keyring::Error::NoEntry) => Ok(T::default()),
        Err(e) => Err(e.into()),
    }
}

fn write<T: Serialize>(user: &str, value: &T) -> OvhResult<()> {
    let raw = serde_json::to_string(value)
        .map_err(|e| OvhError::Decode(format!("sérialisation: {e}")))?;
    entry(user)?.set_password(&raw)?;
    Ok(())
}

fn remove(user: &str) -> OvhResult<()> {
    match entry(user)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

fn app_key(endpoint: Endpoint) -> String {
    format!("app:{}", endpoint.id())
}

fn account_key(account_id: &str) -> String {
    format!("account:{account_id}")
}

// ===========================================================================
// L'application, par endpoint
// ===========================================================================

/// L'application embarquée, si elle existe ET si cet endpoint l'accepte.
///
/// Celle du binaire a été créée sur la racine EU : elle n'y est valable que là.
fn embedded_for(endpoint: Endpoint) -> Option<(&'static str, &'static str)> {
    if endpoint.accepts_embedded_application() {
        embedded_app::embedded()
    } else {
        None
    }
}

pub fn application_source(endpoint: Endpoint) -> OvhResult<ApplicationSource> {
    if read::<StoredApplication>(&app_key(endpoint))?
        .application
        .is_some()
    {
        return Ok(ApplicationSource::UserSupplied);
    }
    Ok(if embedded_for(endpoint).is_some() {
        ApplicationSource::Embedded
    } else {
        ApplicationSource::Missing
    })
}

/// Enregistre l'application fournie par l'utilisateur pour cet endpoint.
pub fn set_application(endpoint: Endpoint, key: String, secret: String) -> OvhResult<()> {
    write(
        &app_key(endpoint),
        &StoredApplication {
            application: Some(Application { key, secret }),
        },
    )
}

/// Retombe sur l'application embarquée pour cet endpoint.
pub fn clear_application(endpoint: Endpoint) -> OvhResult<()> {
    remove(&app_key(endpoint))
}

// ===========================================================================
// La délégation, par compte
// ===========================================================================

pub fn load_account(account_id: &str) -> OvhResult<StoredAccount> {
    read(&account_key(account_id))
}

/// Enregistre une consumer key **non validée**.
///
/// Elle est conservée pour que l'autorisation survive à un redémarrage, mais
/// reste inutilisable jusqu'à [`mark_validated`].
pub fn set_consumer_key(account_id: &str, consumer_key: String) -> OvhResult<()> {
    write(
        &account_key(account_id),
        &StoredAccount {
            consumer_key: Some(consumer_key),
            consumer_key_validated: false,
        },
    )
}

/// L'API a confirmé la délégation : le prochain démarrage pourra s'y fier sans
/// appel réseau.
pub fn mark_validated(account_id: &str) -> OvhResult<()> {
    let mut stored = load_account(account_id)?;
    if stored.consumer_key.is_none() {
        return Err(OvhError::NotConfigured);
    }
    stored.consumer_key_validated = true;
    write(&account_key(account_id), &stored)
}

/// Oublie la délégation de ce compte. L'application de l'endpoint est conservée.
pub fn forget_account(account_id: &str) -> OvhResult<()> {
    remove(&account_key(account_id))
}

// ===========================================================================
// Assemblage
// ===========================================================================

/// De quoi signer : l'application de l'endpoint, et la délégation du compte.
///
/// `account` à `None` donne des credentials sans consumer key — suffisant pour
/// `POST /auth/credential`, qui n'a besoin que de la clé d'application.
pub fn resolve(endpoint: Endpoint, account: Option<&str>) -> OvhResult<Credentials> {
    let (key, secret) = match read::<StoredApplication>(&app_key(endpoint))?.application {
        Some(app) => (app.key, app.secret),
        None => {
            let (k, s) = embedded_for(endpoint).ok_or(OvhError::NoApplication)?;
            (k.to_owned(), s.to_owned())
        }
    };

    let stored = match account {
        Some(id) => load_account(id)?,
        None => StoredAccount::default(),
    };

    Ok(Credentials {
        application_key: key,
        application_secret: secret,
        consumer_key: stored.consumer_key,
        consumer_key_validated: stored.consumer_key_validated,
    })
}

// ===========================================================================
// Migration depuis le stockage à compte unique
// ===========================================================================

/// Ancien format : une entrée par endpoint, contenant application ET clé.
#[derive(Debug, Clone, Default, Deserialize)]
struct LegacyStored {
    #[serde(default)]
    consumer_key: Option<String>,
    #[serde(default)]
    consumer_key_validated: bool,
    #[serde(default)]
    application: Option<Application>,
}

/// Ce qu'une entrée héritée contenait, une fois éclatée.
pub struct Migrated {
    pub endpoint: Endpoint,
    /// La délégation à reprendre, s'il y en avait une.
    pub account: Option<StoredAccount>,
}

/// Éclate l'entrée mono-compte d'un endpoint vers le nouveau rangement.
///
/// Sans elle, la première ouverture après la mise à jour perdrait silencieusement
/// une autorisation déjà accordée — et l'utilisateur devrait refaire le tour du
/// navigateur sans comprendre pourquoi.
pub fn migrate_legacy(endpoint: Endpoint) -> OvhResult<Option<Migrated>> {
    let legacy: LegacyStored = match entry(endpoint.id())?.get_password() {
        Ok(raw) => serde_json::from_str(&raw)
            .map_err(|e| OvhError::Decode(format!("entrée héritée illisible: {e}")))?,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(e) => return Err(e.into()),
    };

    if let Some(app) = legacy.application {
        set_application(endpoint, app.key, app.secret)?;
    }

    let account = legacy.consumer_key.map(|ck| StoredAccount {
        consumer_key: Some(ck),
        consumer_key_validated: legacy.consumer_key_validated,
    });

    // L'entrée héritée n'est supprimée qu'une fois son contenu recopié.
    remove(endpoint.id())?;
    log::info!(
        "credentials migrées depuis l'entrée héritée {}",
        endpoint.id()
    );

    Ok(Some(Migrated { endpoint, account }))
}

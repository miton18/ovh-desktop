//! Commandes Tauri : comptes, endpoints et parcours d'authentification.
//!
//! Le modèle tient en une phrase : **un compte, c'est un endpoint et une
//! délégation**. Un client OVHcloud peut avoir plusieurs NIC, et un NIC européen
//! n'existe pas sur la racine canadienne — les deux notions sont donc liées, pas
//! empilées.
//!
//! Parcours normal, vu de l'interface :
//!
//! 1. `ovh_status_local` au démarrage — sans réseau, décide de l'écran d'entrée ;
//! 2. `ovh_authorize` sur le compte actif — ouvre la page de validation OVH ;
//! 3. `ovh_confirm_authorization` — confirme et rattache le nichandle au compte.
//!
//! `accounts_add` crée un compte et le rend actif ; le parcours ci-dessus le
//! remplit ensuite.

use std::sync::RwLock;

use serde::Serialize;
use tauri::{AppHandle, Runtime, State};

use super::accounts::{self, Account, Registry};
use super::auth::{self, AuthDetails, CredentialRequest, CredentialState};
use super::credentials::{self, ApplicationSource, Credentials, Redacted};
use super::endpoint::Endpoint;
use super::error::{OvhError, OvhResult};
use super::{blocking, preferences, OvhClient};

/// Client et registre des comptes, partagés par toutes les commandes.
pub struct OvhState {
    pub client: OvhClient,
    pub accounts: RwLock<Registry>,
}

impl OvhState {
    pub fn active_account(&self) -> Option<Account> {
        self.accounts
            .read()
            .expect("registre empoisonné")
            .active_account()
            .cloned()
    }

    fn active_id(&self) -> Option<String> {
        self.active_account().map(|a| a.id)
    }

    fn snapshot(&self) -> Registry {
        self.accounts.read().expect("registre empoisonné").clone()
    }
}

/// Applique un changement au registre, le persiste, et remet le menu à jour.
///
/// Le menu liste les comptes : le laisser diverger du registre, c'est proposer
/// de basculer vers un compte qui n'existe plus.
async fn mutate_registry<R, F, T>(app: &AppHandle<R>, state: &OvhState, change: F) -> OvhResult<T>
where
    R: Runtime,
    F: FnOnce(&mut Registry) -> OvhResult<T>,
{
    let (result, snapshot) = {
        let mut registry = state.accounts.write().expect("registre empoisonné");
        let result = change(&mut registry)?;
        (result, registry.clone())
    };

    let handle = app.clone();
    let to_save = snapshot.clone();
    blocking(move || accounts::save(&handle, &to_save)).await?;

    crate::menu::refresh(app, &snapshot);
    Ok(result)
}

/// Nettoie tous les doublons du registre, sans réseau.
///
/// Deux entrées de même racine et même nichandle sont le même compte : il suffit
/// de le lire dans le registre, aucune authentification n'est nécessaire. Dans
/// chaque groupe on garde celle qui a une délégation validée — c'est la seule
/// qui fonctionne — puis, à défaut, celle qui en a une, puis la plus ancienne,
/// dont le libellé et la place dans le menu sont déjà connus de l'utilisateur.
pub async fn dedupe_accounts<R: Runtime>(app: &AppHandle<R>, state: &OvhState) {
    let groups = state
        .accounts
        .read()
        .expect("registre empoisonné")
        .duplicate_groups();

    for group in groups {
        let candidates = group.clone();
        let keep = blocking(move || {
            let mut best = candidates[0].clone();
            let mut best_score = -1i32;
            for account in &candidates {
                let stored = credentials::load_account(&account.id)?;
                let score = match (stored.consumer_key.is_some(), stored.consumer_key_validated) {
                    (true, true) => 2,
                    (true, false) => 1,
                    _ => 0,
                };
                if score > best_score {
                    best_score = score;
                    best = account.clone();
                }
            }
            Ok(best)
        })
        .await;

        match keep {
            Ok(keep) => absorb_duplicates(app, state, &keep.id).await,
            Err(e) => log::warn!("choix du compte à conserver impossible: {e}"),
        }
    }
}

/// Supprime les entrées qui font double emploi avec le compte indiqué.
///
/// Deux entrées de même racine et même nichandle sont le même compte OVHcloud :
/// l'utilisateur a autorisé deux fois. On garde la première, et on révoque
/// proprement les délégations des autres au lieu de les laisser traîner, actives,
/// dans son compte.
async fn absorb_duplicates<R: Runtime>(app: &AppHandle<R>, state: &OvhState, keep_id: &str) {
    let keep_id = keep_id.to_owned();
    let absorbed = match mutate_registry(app, state, move |registry| {
        Ok(registry.absorb_duplicates(&keep_id))
    })
    .await
    {
        Ok(absorbed) => absorbed,
        Err(e) => {
            log::warn!("déduplication des comptes impossible: {e}");
            return;
        }
    };

    for account in absorbed {
        log::info!(
            "compte en double absorbé: {} ({})",
            account.display_name(),
            account.endpoint.id()
        );
        let endpoint = account.endpoint;
        let id = account.id.clone();
        if let Ok(creds) = blocking(move || credentials::resolve(endpoint, Some(&id))).await {
            if creds.is_complete() {
                let previous = state.client.endpoint();
                state.client.set_endpoint(endpoint);
                if let Err(e) = auth::logout(&state.client, &creds).await {
                    log::warn!("révocation du doublon {} impossible: {e}", account.id);
                }
                state.client.set_endpoint(previous);
            }
        }
        let id = account.id.clone();
        if let Err(e) = blocking(move || credentials::forget_account(&id)).await {
            log::warn!("effacement du doublon {} impossible: {e}", account.id);
        }
    }
}

/// Aligne l'endpoint du client sur celui du compte actif.
fn follow_active_endpoint(state: &OvhState) {
    if let Some(account) = state.active_account() {
        if state.client.endpoint() != account.endpoint {
            state.client.set_endpoint(account.endpoint);
        }
    }
}

// ===========================================================================
// Endpoints
// ===========================================================================

/// Un endpoint proposé à l'interface.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointInfo {
    pub id: &'static str,
    pub label: &'static str,
    pub root: &'static str,
    /// Branches réellement servies : Kimsufi et So you Start s'arrêtent à `/1.0`.
    pub branches: Vec<&'static str>,
    /// `false` → il faut fournir sa propre application sur cet endpoint.
    pub accepts_embedded_application: bool,
    pub create_app_url: String,
}

fn endpoint_info(endpoint: Endpoint) -> EndpointInfo {
    EndpointInfo {
        id: endpoint.id(),
        label: endpoint.label(),
        root: endpoint.root(),
        branches: endpoint.branches().iter().map(|b| b.segment()).collect(),
        accepts_embedded_application: endpoint.accepts_embedded_application(),
        create_app_url: endpoint.create_app_url(),
    }
}

/// Les sept endpoints OVHcloud, avec ce que chacun permet.
#[tauri::command]
pub fn ovh_endpoints() -> Vec<EndpointInfo> {
    Endpoint::ALL.into_iter().map(endpoint_info).collect()
}

// ===========================================================================
// Comptes
// ===========================================================================

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInfo {
    pub id: String,
    pub label: String,
    /// Ce qu'il faut afficher : le libellé, sinon le nichandle, sinon un défaut.
    pub display_name: String,
    pub nichandle: Option<String>,
    pub endpoint: EndpointInfo,
    pub active: bool,
    /// Une délégation validée existe : ce compte est utilisable tel quel.
    pub ready: bool,
    /// Une délégation attend d'être validée par l'utilisateur.
    pub pending: bool,
}

fn describe(registry: &Registry, account: &Account) -> OvhResult<AccountInfo> {
    let stored = credentials::load_account(&account.id)?;
    let has_key = stored.consumer_key.is_some();
    Ok(AccountInfo {
        id: account.id.clone(),
        label: account.label.clone(),
        display_name: account.display_name(),
        nichandle: account.nichandle.clone(),
        endpoint: endpoint_info(account.endpoint),
        active: registry.active.as_deref() == Some(account.id.as_str()),
        ready: has_key && stored.consumer_key_validated,
        pending: has_key && !stored.consumer_key_validated,
    })
}

#[tauri::command]
pub async fn accounts_list(state: State<'_, OvhState>) -> OvhResult<Vec<AccountInfo>> {
    let registry = state.snapshot();
    blocking(move || {
        registry
            .accounts
            .iter()
            .map(|a| describe(&registry, a))
            .collect()
    })
    .await
}

/// Crée un compte et le rend actif. Il reste à l'autoriser.
#[tauri::command]
pub async fn accounts_add<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, OvhState>,
    endpoint_id: String,
    label: Option<String>,
) -> OvhResult<AccountInfo> {
    let endpoint = Endpoint::from_id(&endpoint_id)
        .ok_or_else(|| OvhError::Decode(format!("endpoint inconnu: {endpoint_id}")))?;

    // Un compte encore jamais autorisé sur cette racine est une coquille vide :
    // en créer une seconde est le chemin par lequel les doublons apparaissent.
    let account = mutate_registry(&app, &state, |registry| {
        if let Some(existing) = registry.unauthorized_on(endpoint) {
            let id = existing.id.clone();
            return registry.select(&id).cloned();
        }
        Ok(registry.add(endpoint, label.unwrap_or_default()))
    })
    .await?;

    state.client.set_endpoint(endpoint);
    let handle = app.clone();
    blocking(move || preferences::save_endpoint(&handle, endpoint)).await?;
    log::info!(
        "compte ajouté sur {} ({})",
        endpoint.label(),
        endpoint.root()
    );

    let registry = state.snapshot();
    blocking(move || describe(&registry, &account)).await
}

/// Bascule vers un autre compte, et donc vers son endpoint.
#[tauri::command]
pub async fn accounts_select<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, OvhState>,
    id: String,
) -> OvhResult<AccountInfo> {
    let account = mutate_registry(&app, &state, |registry| registry.select(&id).cloned()).await?;

    state.client.set_endpoint(account.endpoint);
    let handle = app.clone();
    let endpoint = account.endpoint;
    blocking(move || preferences::save_endpoint(&handle, endpoint)).await?;

    let registry = state.snapshot();
    blocking(move || describe(&registry, &account)).await
}

/// Supprime un compte : révoque la délégation puis oublie tout de lui.
///
/// L'oubli local a lieu même si la révocation réseau échoue — on ne garde pas une
/// clé qu'on a décidé d'oublier.
#[tauri::command]
pub async fn accounts_remove<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, OvhState>,
    id: String,
) -> OvhResult<Vec<AccountInfo>> {
    let account = state
        .accounts
        .read()
        .expect("registre empoisonné")
        .get(&id)
        .cloned()
        .ok_or_else(|| OvhError::Decode(format!("compte inconnu: {id}")))?;

    // Révocation côté OVH, sur l'endpoint du compte visé — pas forcément l'actif.
    let endpoint = account.endpoint;
    let for_revoke = id.clone();
    if let Ok(creds) = blocking(move || credentials::resolve(endpoint, Some(&for_revoke))).await {
        if creds.is_complete() {
            let previous = state.client.endpoint();
            state.client.set_endpoint(endpoint);
            if let Err(e) = auth::logout(&state.client, &creds).await {
                log::warn!("révocation impossible pour {id}: {e}");
            }
            state.client.set_endpoint(previous);
        }
    }

    let forget_id = id.clone();
    blocking(move || credentials::forget_account(&forget_id)).await?;

    mutate_registry(&app, &state, |registry| {
        registry.remove(&id);
        Ok(())
    })
    .await?;

    follow_active_endpoint(&state);

    let registry = state.snapshot();
    blocking(move || {
        registry
            .accounts
            .iter()
            .map(|a| describe(&registry, a))
            .collect()
    })
    .await
}

/// Renomme un compte. Un libellé vide fait retomber sur le nichandle.
#[tauri::command]
pub async fn accounts_rename<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, OvhState>,
    id: String,
    label: String,
) -> OvhResult<AccountInfo> {
    let account = mutate_registry(&app, &state, |registry| {
        let account = registry
            .accounts
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or_else(|| OvhError::Decode(format!("compte inconnu: {id}")))?;
        account.label = label;
        Ok(account.clone())
    })
    .await?;

    let registry = state.snapshot();
    blocking(move || describe(&registry, &account)).await
}

// ===========================================================================
// Application (clé + secret), par endpoint
// ===========================================================================

/// Page où créer une application, **pour l'endpoint courant** : une application
/// n'est valable que sur la racine qui l'a émise.
#[tauri::command]
pub fn ovh_create_app_url(state: State<'_, OvhState>) -> String {
    state.client.endpoint().create_app_url()
}

/// Surcharge l'application de l'endpoint courant. Les délégations de ses comptes
/// deviennent caduques : elles étaient liées à l'application précédente.
#[tauri::command]
pub async fn ovh_set_application(
    state: State<'_, OvhState>,
    application_key: String,
    application_secret: String,
) -> OvhResult<()> {
    let key = application_key.trim().to_owned();
    let secret = application_secret.trim().to_owned();
    if key.is_empty() || secret.is_empty() {
        return Err(OvhError::Decode("clé ou secret vide".into()));
    }
    let endpoint = state.client.endpoint();
    blocking(move || credentials::set_application(endpoint, key, secret)).await
}

#[tauri::command]
pub async fn ovh_reset_application(state: State<'_, OvhState>) -> OvhResult<()> {
    let endpoint = state.client.endpoint();
    blocking(move || credentials::clear_application(endpoint)).await
}

// ===========================================================================
// État
// ===========================================================================

/// État lisible **sans toucher au réseau** : uniquement le trousseau.
///
/// Sert à décider de l'écran d'entrée sans faire attendre l'utilisateur. Une
/// délégation enregistrée ne prouve pas qu'elle est valide — c'est `ovh_status`,
/// qui interroge l'API, qui tranche ensuite.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OvhLocalState {
    pub application: ApplicationSource,
    /// Une délégation **validée** est enregistrée : on peut appeler l'API.
    pub has_consumer_key: bool,
    /// Une délégation existe mais attend la validation de l'utilisateur.
    /// L'interface doit proposer de la reprendre, pas de tout recommencer.
    pub pending_consumer_key: bool,
    pub branch: String,
    pub endpoint: EndpointInfo,
    /// `None` quand aucun compte n'est enregistré.
    pub active_account_id: Option<String>,
    pub account_count: usize,
}

#[tauri::command]
pub async fn ovh_status_local<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, OvhState>,
) -> OvhResult<OvhLocalState> {
    // Premier appel du frontend, et il ne touche pas au réseau : le bon moment
    // pour nettoyer un registre qui contiendrait des doublons.
    dedupe_accounts(&app, &state).await;
    follow_active_endpoint(&state);

    let target = state.client.target();
    let endpoint = target.endpoint;
    let registry = state.snapshot();
    let active_id = registry.active.clone();

    let (application, stored) = blocking(move || {
        let source = credentials::application_source(endpoint)?;
        let stored = match &active_id {
            Some(id) => credentials::load_account(id)?,
            None => Default::default(),
        };
        Ok((source, stored))
    })
    .await?;

    let has_key = stored.consumer_key.is_some();
    Ok(OvhLocalState {
        application,
        has_consumer_key: has_key && stored.consumer_key_validated,
        pending_consumer_key: has_key && !stored.consumer_key_validated,
        branch: format!("/{}", target.branch.segment()),
        endpoint: endpoint_info(endpoint),
        active_account_id: registry.active.clone(),
        account_count: registry.accounts.len(),
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OvhStatus {
    pub application: ApplicationSource,
    pub has_consumer_key: bool,
    /// Identifiant client OVH, renseigné seulement si la délégation est active.
    pub account: Option<String>,
    /// `true` quand il n'y a plus rien à faire : on peut appeler l'API.
    pub ready: bool,
    pub branch: String,
    pub endpoint: EndpointInfo,
    pub active_account_id: Option<String>,
}

/// Credentials du compte actif.
async fn active_credentials(state: &OvhState) -> OvhResult<(Option<String>, Credentials)> {
    follow_active_endpoint(state);
    let endpoint = state.client.endpoint();
    let account_id = state.active_id();
    let for_resolve = account_id.clone();
    let creds = blocking(move || credentials::resolve(endpoint, for_resolve.as_deref())).await?;
    Ok((account_id, creds))
}

#[tauri::command]
pub async fn ovh_status<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, OvhState>,
) -> OvhResult<OvhStatus> {
    let target = state.client.target();
    let branch = format!("/{}", target.branch.segment());
    let endpoint = target.endpoint;
    let application = {
        let e = endpoint;
        blocking(move || credentials::application_source(e)).await?
    };

    let Some(account_id) = state.active_id() else {
        return Ok(OvhStatus {
            application,
            has_consumer_key: false,
            account: None,
            ready: false,
            branch,
            endpoint: endpoint_info(endpoint),
            active_account_id: None,
        });
    };

    let (_, creds) = active_credentials(&state).await?;
    log::debug!("credentials résolues: {:?}", Redacted(&creds));

    // On ne déduit pas l'état de la présence d'une clé : on demande à l'API.
    //
    // Une clé créée mais pas encore validée fait répondre **403
    // `Client::Forbidden`**, pas 401 : la traiter comme une erreur mettait
    // l'interface dans une impasse au lieu de renvoyer vers l'autorisation.
    let nichandle = if creds.is_complete() {
        match auth::details(&state.client, &creds).await {
            Ok(d) => Some(d.account),
            Err(OvhError::Api {
                status: 401 | 403, ..
            })
            | Err(OvhError::PendingValidation) => None,
            Err(e) => return Err(e),
        }
    } else {
        None
    };

    if let Some(nic) = nichandle.clone() {
        if !creds.consumer_key_validated {
            let id = account_id.clone();
            if let Err(e) = blocking(move || credentials::mark_validated(&id)).await {
                log::warn!("impossible de marquer la délégation comme validée: {e}");
            }
        }
        // Le nichandle nomme le compte dans le menu : on le retient. Et c'est
        // seulement maintenant qu'on peut reconnaître un doublon — avant, deux
        // comptes en attente d'autorisation sont indiscernables.
        let id = account_id.clone();
        let _ = mutate_registry(&app, &state, move |registry| {
            registry.set_nichandle(&id, nic);
            Ok(())
        })
        .await;
        absorb_duplicates(&app, &state, &account_id).await;
    }

    Ok(OvhStatus {
        application,
        has_consumer_key: creds.is_complete(),
        ready: nichandle.is_some(),
        account: nichandle,
        branch,
        endpoint: endpoint_info(endpoint),
        active_account_id: Some(account_id),
    })
}

// ===========================================================================
// Autorisation
// ===========================================================================

/// Demande une délégation sur toute l'API de l'endpoint, pour le compte actif,
/// et ouvre la page de validation.
///
/// Sans compte actif, un compte est créé sur l'endpoint courant : le parcours
/// « première ouverture » n'a pas à passer par la gestion des comptes.
#[tauri::command]
pub async fn ovh_authorize<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, OvhState>,
    open_browser: bool,
) -> OvhResult<CredentialRequest> {
    if state.active_id().is_none() {
        let endpoint = state.client.endpoint();
        mutate_registry(&app, &state, |registry| {
            registry.add(endpoint, String::new());
            Ok(())
        })
        .await?;
    }

    let (account_id, creds) = active_credentials(&state).await?;
    let account_id = account_id.ok_or(OvhError::NotConfigured)?;

    // La signature est refusée si l'horloge locale dérive : on se cale d'abord.
    if let Err(e) = state.client.sync_time().await {
        log::warn!("synchronisation de l'horloge impossible: {e}");
    }

    let request = auth::request_full_api_credential(&state.client, &creds, None).await?;

    let consumer_key = request.consumer_key.clone();
    blocking(move || credentials::set_consumer_key(&account_id, consumer_key)).await?;

    if open_browser {
        use tauri_plugin_opener::OpenerExt;
        if let Err(e) = app.opener().open_url(&request.validation_url, None::<&str>) {
            log::error!("ouverture de la page de validation impossible: {e}");
        }
    }

    Ok(request)
}

/// Vérifie que l'utilisateur a validé la délégation, et rattache le compte.
#[tauri::command]
pub async fn ovh_confirm_authorization<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, OvhState>,
) -> OvhResult<AuthDetails> {
    let (account_id, creds) = active_credentials(&state).await?;
    let account_id = account_id.ok_or(OvhError::NotConfigured)?;
    if !creds.is_complete() {
        return Err(OvhError::NotConfigured);
    }

    let credential = auth::current_credential(&state.client, &creds).await?;
    auth::ensure_validated(credential.status)?;
    let details = auth::details(&state.client, &creds).await?;

    let id = account_id.clone();
    blocking(move || credentials::mark_validated(&id)).await?;

    let nic = details.account.clone();
    let id = account_id.clone();
    mutate_registry(&app, &state, move |registry| {
        registry.set_nichandle(&id, nic);
        Ok(())
    })
    .await?;

    // L'autorisation vient d'aboutir : si ce compte existait déjà sous une autre
    // entrée, c'est maintenant qu'on peut le voir.
    absorb_duplicates(&app, &state, &account_id).await;

    Ok(details)
}

/// Oublie la délégation du compte actif, sans supprimer le compte.
#[tauri::command]
pub async fn ovh_logout(state: State<'_, OvhState>) -> OvhResult<()> {
    let (account_id, creds) = active_credentials(&state).await?;
    let Some(account_id) = account_id else {
        return Ok(());
    };
    if creds.is_complete() {
        if let Err(e) = auth::logout(&state.client, &creds).await {
            log::warn!("logout côté API impossible: {e}");
        }
    }
    blocking(move || credentials::forget_account(&account_id)).await
}

/// État brut de la délégation courante — utile pour diagnostiquer.
#[tauri::command]
pub async fn ovh_credential_state(state: State<'_, OvhState>) -> OvhResult<CredentialState> {
    let (_, creds) = active_credentials(&state).await?;
    if !creds.is_complete() {
        return Err(OvhError::NotConfigured);
    }
    Ok(auth::current_credential(&state.client, &creds)
        .await?
        .status)
}

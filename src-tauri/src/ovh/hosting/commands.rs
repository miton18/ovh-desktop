//! Commandes Tauri du périmètre hébergement web.
//!
//! Façades minces sur [`super::api`] : elles résolvent les credentials du compte
//! actif et délèguent. Aucune logique métier ici.

use tauri::State;

use super::api;
use crate::ovh::blocking;
use crate::ovh::commands::OvhState;
use crate::ovh::credentials::{self, Credentials};
use crate::ovh::error::{OvhError, OvhResult};
use crate::ovh::models::hosting::*;

async fn creds(state: &OvhState) -> OvhResult<Credentials> {
    let endpoint = state.client.endpoint();
    let account_id = state.active_account().map(|a| a.id);
    let creds = blocking(move || credentials::resolve(endpoint, account_id.as_deref())).await?;
    if !creds.is_complete() {
        return Err(OvhError::NotConfigured);
    }
    Ok(creds)
}

// ------------------------------------------------------------- hébergements

#[tauri::command]
pub async fn hostings_list(state: State<'_, OvhState>) -> OvhResult<Vec<String>> {
    api::list(&state.client, &creds(&state).await?).await
}

#[tauri::command]
pub async fn hostings_fetch(state: State<'_, OvhState>) -> OvhResult<Vec<HostingService>> {
    api::get_all(&state.client, &creds(&state).await?).await
}

#[tauri::command]
pub async fn hosting_get(
    state: State<'_, OvhState>,
    service_name: String,
) -> OvhResult<HostingService> {
    api::get(&state.client, &creds(&state).await?, &service_name).await
}

/// Ce que l'offre autorise, pour griser avec une raison plutôt que laisser
/// l'API refuser.
///
/// N'exige pas de délégation validée : la route est ouverte.
#[tauri::command]
pub async fn hosting_offer_capabilities(
    state: State<'_, OvhState>,
    offer: String,
) -> OvhResult<HostingCapabilities> {
    let endpoint = state.client.endpoint();
    let account_id = state.active_account().map(|a| a.id);
    let creds = blocking(move || credentials::resolve(endpoint, account_id.as_deref())).await?;
    api::offer_capabilities(&state.client, &creds, &offer).await
}

// --------------------------------------------------------------- multisites

#[tauri::command]
pub async fn hosting_attached_domains(
    state: State<'_, OvhState>,
    service_name: String,
) -> OvhResult<Vec<AttachedDomainDetail>> {
    api::attached_domains(&state.client, &creds(&state).await?, &service_name).await
}

/// Crée un multisite.
///
/// Avec `bypassDnsConfiguration` à `false`, **l'API écrit dans la zone DNS du
/// domaine** : l'interface doit l'avoir annoncé avant d'appeler.
#[tauri::command]
pub async fn hosting_attached_domain_create(
    state: State<'_, OvhState>,
    service_name: String,
    payload: AttachedDomain,
) -> OvhResult<HostingTask> {
    api::create_attached_domain(
        &state.client,
        &creds(&state).await?,
        &service_name,
        &payload,
    )
    .await
}

#[tauri::command]
pub async fn hosting_attached_domain_update(
    state: State<'_, OvhState>,
    service_name: String,
    domain: String,
    payload: AttachedDomain,
) -> OvhResult<()> {
    api::update_attached_domain(
        &state.client,
        &creds(&state).await?,
        &service_name,
        &domain,
        &payload,
    )
    .await
}

#[tauri::command]
pub async fn hosting_attached_domain_delete(
    state: State<'_, OvhState>,
    service_name: String,
    domain: String,
) -> OvhResult<HostingTask> {
    api::delete_attached_domain(&state.client, &creds(&state).await?, &service_name, &domain).await
}

// -------------------------------------------------------------- utilisateurs

#[tauri::command]
pub async fn hosting_users(
    state: State<'_, OvhState>,
    service_name: String,
) -> OvhResult<Vec<HostingUser>> {
    api::users(&state.client, &creds(&state).await?, &service_name).await
}

#[tauri::command]
pub async fn hosting_user_create(
    state: State<'_, OvhState>,
    service_name: String,
    payload: HostingUserCreate,
) -> OvhResult<HostingTask> {
    api::create_user(
        &state.client,
        &creds(&state).await?,
        &service_name,
        &payload,
    )
    .await
}

#[tauri::command]
pub async fn hosting_user_update(
    state: State<'_, OvhState>,
    service_name: String,
    login: String,
    payload: HostingUser,
) -> OvhResult<()> {
    api::update_user(
        &state.client,
        &creds(&state).await?,
        &service_name,
        &login,
        &payload,
    )
    .await
}

/// Le mot de passe n'est jamais relisible : il ne se change que par cette route.
#[tauri::command]
pub async fn hosting_user_change_password(
    state: State<'_, OvhState>,
    service_name: String,
    login: String,
    password: String,
) -> OvhResult<HostingTask> {
    api::change_user_password(
        &state.client,
        &creds(&state).await?,
        &service_name,
        &login,
        password,
    )
    .await
}

#[tauri::command]
pub async fn hosting_user_delete(
    state: State<'_, OvhState>,
    service_name: String,
    login: String,
) -> OvhResult<HostingTask> {
    api::delete_user(&state.client, &creds(&state).await?, &service_name, &login).await
}

// ---------------------------------------------------------- bases de données

#[tauri::command]
pub async fn hosting_databases(
    state: State<'_, OvhState>,
    service_name: String,
) -> OvhResult<Vec<Database>> {
    api::databases(&state.client, &creds(&state).await?, &service_name).await
}

#[tauri::command]
pub async fn hosting_database_dumps(
    state: State<'_, OvhState>,
    service_name: String,
    database: String,
) -> OvhResult<Vec<DatabaseDump>> {
    api::dumps(
        &state.client,
        &creds(&state).await?,
        &service_name,
        &database,
    )
    .await
}

#[tauri::command]
pub async fn hosting_database_dump_create(
    state: State<'_, OvhState>,
    service_name: String,
    database: String,
) -> OvhResult<HostingTask> {
    api::create_dump(
        &state.client,
        &creds(&state).await?,
        &service_name,
        &database,
    )
    .await
}

// ------------------------------------------------------- ce qui s'exécute

#[tauri::command]
pub async fn hosting_crons(
    state: State<'_, OvhState>,
    service_name: String,
) -> OvhResult<Vec<Cron>> {
    api::crons(&state.client, &creds(&state).await?, &service_name).await
}

#[tauri::command]
pub async fn hosting_cron_create(
    state: State<'_, OvhState>,
    service_name: String,
    payload: CronInput,
) -> OvhResult<HostingTask> {
    api::create_cron(
        &state.client,
        &creds(&state).await?,
        &service_name,
        &payload,
    )
    .await
}

#[tauri::command]
pub async fn hosting_cron_delete(
    state: State<'_, OvhState>,
    service_name: String,
    id: i64,
) -> OvhResult<HostingTask> {
    api::delete_cron(&state.client, &creds(&state).await?, &service_name, id).await
}

#[tauri::command]
pub async fn hosting_env_vars(
    state: State<'_, OvhState>,
    service_name: String,
) -> OvhResult<Vec<EnvVar>> {
    api::env_vars(&state.client, &creds(&state).await?, &service_name).await
}

#[tauri::command]
pub async fn hosting_env_var_create(
    state: State<'_, OvhState>,
    service_name: String,
    key: String,
    value: String,
    kind: EnvVarType,
) -> OvhResult<HostingTask> {
    api::create_env_var(
        &state.client,
        &creds(&state).await?,
        &service_name,
        key,
        value,
        kind,
    )
    .await
}

#[tauri::command]
pub async fn hosting_env_var_delete(
    state: State<'_, OvhState>,
    service_name: String,
    key: String,
) -> OvhResult<HostingTask> {
    api::delete_env_var(&state.client, &creds(&state).await?, &service_name, &key).await
}

#[tauri::command]
pub async fn hosting_runtimes(
    state: State<'_, OvhState>,
    service_name: String,
) -> OvhResult<Vec<Runtime>> {
    api::runtimes(&state.client, &creds(&state).await?, &service_name).await
}

// -------------------------------------------------------- certificat, tâches

#[tauri::command]
pub async fn hosting_ssl(
    state: State<'_, OvhState>,
    service_name: String,
) -> OvhResult<HostingSsl> {
    api::ssl(&state.client, &creds(&state).await?, &service_name).await
}

#[tauri::command]
pub async fn hosting_tasks(
    state: State<'_, OvhState>,
    service_name: String,
) -> OvhResult<Vec<HostingTask>> {
    api::tasks(&state.client, &creds(&state).await?, &service_name).await
}

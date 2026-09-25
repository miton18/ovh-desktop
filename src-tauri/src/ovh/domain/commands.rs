//! Commandes Tauri du périmètre domaines.
//!
//! Chacune est une façade mince sur [`super::api`] : elle résout les credentials
//! et délègue. Aucune logique métier ici — elle appartient soit à l'API, soit à
//! l'interface.

use tauri::State;

use super::api::{self, TaskAction};
use crate::ovh::blocking;
use crate::ovh::commands::OvhState;
use crate::ovh::credentials::{self, Credentials};
use crate::ovh::error::{OvhError, OvhResult};
use crate::ovh::models::common::{ChangeContact, RenewType, Service};
use crate::ovh::models::domain::*;

/// Credentials prêtes à signer, pour le **compte actif** et son endpoint.
///
/// Un compte porte sa propre délégation : basculer de compte change à la fois la
/// clé utilisée et la racine appelée.
async fn creds(state: &OvhState) -> OvhResult<Credentials> {
    let endpoint = state.client.endpoint();
    let account_id = state.active_account().map(|a| a.id);
    let creds = blocking(move || credentials::resolve(endpoint, account_id.as_deref())).await?;
    if !creds.is_complete() {
        return Err(OvhError::NotConfigured);
    }
    Ok(creds)
}

// ---------------------------------------------------------------- domaines

/// Les noms seuls — pour un premier affichage immédiat.
#[tauri::command]
pub async fn domains_list(state: State<'_, OvhState>) -> OvhResult<Vec<String>> {
    api::list_domains(&state.client, &creds(&state).await?).await
}

/// Les fiches complètes. Un appel par domaine côté API : à lancer après
/// `domains_list` si l'interface veut afficher la liste sans attendre.
#[tauri::command]
pub async fn domains_fetch(state: State<'_, OvhState>) -> OvhResult<Vec<DomainServiceWithIam>> {
    api::get_all_domains(&state.client, &creds(&state).await?).await
}

#[tauri::command]
pub async fn domain_get(
    state: State<'_, OvhState>,
    service_name: String,
) -> OvhResult<DomainServiceWithIam> {
    api::get_domain(&state.client, &creds(&state).await?, &service_name).await
}

#[tauri::command]
pub async fn domain_update(
    state: State<'_, OvhState>,
    service_name: String,
    name_server_type: Option<NameServerType>,
    transfer_lock_status: Option<LockStatus>,
) -> OvhResult<()> {
    api::update_domain(
        &state.client,
        &creds(&state).await?,
        &service_name,
        name_server_type,
        transfer_lock_status,
    )
    .await
}

/// Code de transfert. Jamais journalisé, jamais mis en cache.
#[tauri::command]
pub async fn domain_auth_info(
    state: State<'_, OvhState>,
    service_name: String,
) -> OvhResult<String> {
    api::get_auth_info(&state.client, &creds(&state).await?, &service_name).await
}

#[tauri::command]
pub async fn domain_service_info(
    state: State<'_, OvhState>,
    service_name: String,
) -> OvhResult<Service> {
    api::get_service_info(&state.client, &creds(&state).await?, &service_name).await
}

#[tauri::command]
pub async fn domain_set_renew(
    state: State<'_, OvhState>,
    service_name: String,
    renew: RenewType,
) -> OvhResult<()> {
    api::set_renew(&state.client, &creds(&state).await?, &service_name, renew).await
}

// -------------------------------------------------------------------- zones

#[tauri::command]
pub async fn zones_list(state: State<'_, OvhState>) -> OvhResult<Vec<String>> {
    api::list_zones(&state.client, &creds(&state).await?).await
}

#[tauri::command]
pub async fn zone_get(state: State<'_, OvhState>, zone: String) -> OvhResult<ZoneWithIam> {
    api::get_zone(&state.client, &creds(&state).await?, &zone).await
}

#[tauri::command]
pub async fn zone_status(state: State<'_, OvhState>, zone: String) -> OvhResult<ZoneStatus> {
    let status = api::get_zone_status(&state.client, &creds(&state).await?, &zone).await?;
    // `isDeployed` pilote toute la bannière de publication et le schéma n'en
    // donne aucune définition précise : le tracer évite de raisonner à l'aveugle
    // le jour où l'affichage ne correspond pas à ce qu'on attend.
    log::debug!(
        "zone {zone} : isDeployed={} erreurs={} avertissements={}",
        status.is_deployed,
        status.errors.as_ref().map_or(0, |e| e.len()),
        status.warnings.as_ref().map_or(0, |w| w.len())
    );
    Ok(status)
}

#[tauri::command]
pub async fn zone_capabilities(
    state: State<'_, OvhState>,
    zone: String,
) -> OvhResult<ZoneCapabilities> {
    api::get_zone_capabilities(&state.client, &creds(&state).await?, &zone).await
}

#[tauri::command]
pub async fn zone_soa_get(state: State<'_, OvhState>, zone: String) -> OvhResult<Soa> {
    api::get_soa(&state.client, &creds(&state).await?, &zone).await
}

#[tauri::command]
pub async fn zone_soa_set(state: State<'_, OvhState>, zone: String, soa: Soa) -> OvhResult<()> {
    api::set_soa(&state.client, &creds(&state).await?, &zone, &soa).await
}

/// Publie la zone. Sans cet appel, aucune modification n'est servie.
#[tauri::command]
pub async fn zone_refresh(state: State<'_, OvhState>, zone: String) -> OvhResult<()> {
    api::refresh_zone(&state.client, &creds(&state).await?, &zone).await
}

#[tauri::command]
pub async fn zone_export(state: State<'_, OvhState>, zone: String) -> OvhResult<String> {
    api::export_zone(&state.client, &creds(&state).await?, &zone).await
}

#[tauri::command]
pub async fn zone_import(
    state: State<'_, OvhState>,
    zone: String,
    zone_file: String,
) -> OvhResult<ZoneTask> {
    api::import_zone(&state.client, &creds(&state).await?, &zone, zone_file).await
}

#[tauri::command]
pub async fn zone_dnssec_get(state: State<'_, OvhState>, zone: String) -> OvhResult<ZoneDnssec> {
    api::get_dnssec(&state.client, &creds(&state).await?, &zone).await
}

/// À ne pas appeler si le statut est déjà transitoire (`*InProgress`).
#[tauri::command]
pub async fn zone_dnssec_enable(state: State<'_, OvhState>, zone: String) -> OvhResult<()> {
    api::enable_dnssec(&state.client, &creds(&state).await?, &zone).await
}

#[tauri::command]
pub async fn zone_dnssec_disable(state: State<'_, OvhState>, zone: String) -> OvhResult<()> {
    api::disable_dnssec(&state.client, &creds(&state).await?, &zone).await
}

// ----------------------------------------------------------- enregistrements

#[tauri::command]
pub async fn records_list_ids(
    state: State<'_, OvhState>,
    zone: String,
    filter: Option<RecordFilter>,
) -> OvhResult<Vec<i64>> {
    api::list_record_ids(
        &state.client,
        &creds(&state).await?,
        &zone,
        &filter.unwrap_or_default(),
    )
    .await
}

/// Les enregistrements complets. Les filtres réduisent réellement le nombre
/// d'appels : les passer plutôt que de filtrer côté interface.
#[tauri::command]
pub async fn records_fetch(
    state: State<'_, OvhState>,
    zone: String,
    filter: Option<RecordFilter>,
) -> OvhResult<Vec<Record>> {
    api::get_records(
        &state.client,
        &creds(&state).await?,
        &zone,
        &filter.unwrap_or_default(),
    )
    .await
}

#[tauri::command]
pub async fn record_get(state: State<'_, OvhState>, zone: String, id: i64) -> OvhResult<Record> {
    api::get_record(&state.client, &creds(&state).await?, &zone, id).await
}

#[tauri::command]
pub async fn record_create(
    state: State<'_, OvhState>,
    zone: String,
    record: RecordCreate,
) -> OvhResult<Record> {
    api::create_record(&state.client, &creds(&state).await?, &zone, &record).await
}

/// Le type ne se modifie pas : passer un A en CNAME impose suppression puis
/// création, avec un nouvel identifiant.
#[tauri::command]
pub async fn record_update(
    state: State<'_, OvhState>,
    zone: String,
    id: i64,
    record: RecordUpdate,
) -> OvhResult<()> {
    api::update_record(&state.client, &creds(&state).await?, &zone, id, &record).await
}

#[tauri::command]
pub async fn record_delete(state: State<'_, OvhState>, zone: String, id: i64) -> OvhResult<()> {
    api::delete_record(&state.client, &creds(&state).await?, &zone, id).await
}

// ----------------------------------------------------------------- DynHost

#[tauri::command]
pub async fn dynhost_logins(
    state: State<'_, OvhState>,
    zone: String,
) -> OvhResult<Vec<DynHostLogin>> {
    api::get_dynhost_logins(&state.client, &creds(&state).await?, &zone).await
}

#[tauri::command]
pub async fn dynhost_login_create(
    state: State<'_, OvhState>,
    zone: String,
    payload: DynHostLoginCreate,
) -> OvhResult<DynHostLogin> {
    api::create_dynhost_login(&state.client, &creds(&state).await?, &zone, &payload).await
}

#[tauri::command]
pub async fn dynhost_login_update(
    state: State<'_, OvhState>,
    zone: String,
    login: String,
    payload: DynHostLogin,
) -> OvhResult<()> {
    api::update_dynhost_login(
        &state.client,
        &creds(&state).await?,
        &zone,
        &login,
        &payload,
    )
    .await
}

#[tauri::command]
pub async fn dynhost_login_change_password(
    state: State<'_, OvhState>,
    zone: String,
    login: String,
    password: String,
) -> OvhResult<()> {
    api::change_dynhost_password(
        &state.client,
        &creds(&state).await?,
        &zone,
        &login,
        password,
    )
    .await
}

#[tauri::command]
pub async fn dynhost_login_delete(
    state: State<'_, OvhState>,
    zone: String,
    login: String,
) -> OvhResult<()> {
    api::delete_dynhost_login(&state.client, &creds(&state).await?, &zone, &login).await
}

/// Les enregistrements DynHost. Ils n'apparaissent pas dans `records_fetch` :
/// c'est un espace séparé de l'API.
#[tauri::command]
pub async fn dynhost_records(
    state: State<'_, OvhState>,
    zone: String,
) -> OvhResult<Vec<DynHostRecord>> {
    api::get_dynhost_records(&state.client, &creds(&state).await?, &zone).await
}

// ------------------------------------------------- serveurs DNS / glue records

#[tauri::command]
pub async fn name_servers(
    state: State<'_, OvhState>,
    service_name: String,
) -> OvhResult<Vec<FullNameServer>> {
    api::get_name_servers(&state.client, &creds(&state).await?, &service_name).await
}

#[tauri::command]
pub async fn name_server_status(
    state: State<'_, OvhState>,
    service_name: String,
    id: i64,
) -> OvhResult<NameServerStatus> {
    api::get_name_server_status(&state.client, &creds(&state).await?, &service_name, id).await
}

/// Remplace TOUTE la configuration DNS : un serveur absent de la liste est
/// supprimé. L'interface doit montrer l'avant/après avant de valider.
#[tauri::command]
pub async fn name_servers_replace(
    state: State<'_, OvhState>,
    service_name: String,
    name_servers: Vec<NameServerInput>,
) -> OvhResult<DomainTask> {
    api::replace_name_servers(
        &state.client,
        &creds(&state).await?,
        &service_name,
        name_servers,
    )
    .await
}

#[tauri::command]
pub async fn glue_records(
    state: State<'_, OvhState>,
    service_name: String,
) -> OvhResult<Vec<GlueRecord>> {
    api::get_glue_records(&state.client, &creds(&state).await?, &service_name).await
}

#[tauri::command]
pub async fn glue_record_create(
    state: State<'_, OvhState>,
    service_name: String,
    payload: GlueRecordCreate,
) -> OvhResult<DomainTask> {
    api::create_glue_record(
        &state.client,
        &creds(&state).await?,
        &service_name,
        &payload,
    )
    .await
}

#[tauri::command]
pub async fn glue_record_update(
    state: State<'_, OvhState>,
    service_name: String,
    host: String,
    ips: Vec<String>,
) -> OvhResult<DomainTask> {
    api::update_glue_record(
        &state.client,
        &creds(&state).await?,
        &service_name,
        &host,
        ips,
    )
    .await
}

#[tauri::command]
pub async fn glue_record_delete(
    state: State<'_, OvhState>,
    service_name: String,
    host: String,
) -> OvhResult<DomainTask> {
    api::delete_glue_record(&state.client, &creds(&state).await?, &service_name, &host).await
}

// ---------------------------------------------------------- contacts WHOIS

#[tauri::command]
pub async fn contacts_list(state: State<'_, OvhState>) -> OvhResult<Vec<Contact>> {
    api::get_contacts(&state.client, &creds(&state).await?).await
}

#[tauri::command]
pub async fn contact_get(state: State<'_, OvhState>, contact_id: i64) -> OvhResult<Contact> {
    api::get_contact(&state.client, &creds(&state).await?, contact_id).await
}

#[tauri::command]
pub async fn contact_update(
    state: State<'_, OvhState>,
    contact_id: i64,
    contact: Contact,
) -> OvhResult<Contact> {
    api::update_contact(&state.client, &creds(&state).await?, contact_id, &contact).await
}

/// Contacts admin, facturation et technique uniquement. Le propriétaire relève
/// d'une procédure de trade chez le registre.
#[tauri::command]
pub async fn domain_change_contacts(
    state: State<'_, OvhState>,
    service_name: String,
    payload: ChangeContact,
) -> OvhResult<Vec<i64>> {
    api::change_contacts(
        &state.client,
        &creds(&state).await?,
        &service_name,
        &payload,
    )
    .await
}

// ------------------------------------------------------------------- tâches

#[tauri::command]
pub async fn domain_tasks(
    state: State<'_, OvhState>,
    service_name: String,
) -> OvhResult<Vec<DomainTask>> {
    api::get_domain_tasks(&state.client, &creds(&state).await?, &service_name).await
}

#[tauri::command]
pub async fn zone_tasks(state: State<'_, OvhState>, zone: String) -> OvhResult<Vec<ZoneTask>> {
    api::get_zone_tasks(&state.client, &creds(&state).await?, &zone).await
}

/// À n'appeler que si le drapeau `can…` correspondant de la tâche est vrai.
#[tauri::command]
pub async fn domain_task_act(
    state: State<'_, OvhState>,
    service_name: String,
    id: i64,
    action: TaskAction,
) -> OvhResult<()> {
    api::act_on_domain_task(
        &state.client,
        &creds(&state).await?,
        &service_name,
        id,
        action,
    )
    .await
}

#[tauri::command]
pub async fn zone_task_act(
    state: State<'_, OvhState>,
    zone: String,
    id: i64,
    action: TaskAction,
) -> OvhResult<()> {
    api::act_on_zone_task(&state.client, &creds(&state).await?, &zone, id, action).await
}

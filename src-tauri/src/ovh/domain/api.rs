//! Appels à la section `/domain` de l'API OVHcloud.
//!
//! Les fonctions ici sont de simples traductions des routes ; la seule logique
//! qu'elles ajoutent est la résolution des listes d'identifiants en objets
//! (voir [`fetch_all`]), parce que l'API ne sait pas le faire.

use futures::stream::{self, StreamExt, TryStreamExt};
use reqwest::Method;

use crate::ovh::client::OvhClient;
use crate::ovh::credentials::Credentials;
use crate::ovh::error::OvhResult;
use crate::ovh::models::common::{ChangeContact, RenewType, Service};
use crate::ovh::models::domain::*;

/// Nombre d'appels de détail menés en parallèle.
///
/// L'API OVH ne documente pas de limite de débit ferme, mais elle répond 429
/// si on la sature. Huit requêtes concurrentes rendent une zone de 200
/// enregistrements en quelques secondes sans jamais l'atteindre.
const FAN_OUT: usize = 8;

/// Résout une liste d'identifiants en objets, avec un parallélisme borné.
///
/// Toutes les routes de liste de l'API renvoient `long[]` ou `string[]` : sans
/// ce fan-out, afficher une zone demanderait autant d'allers-retours séquentiels
/// qu'elle a d'enregistrements. L'ordre de la liste d'entrée est conservé.
async fn fetch_all<I, T, F, Fut>(ids: Vec<I>, fetch: F) -> OvhResult<Vec<T>>
where
    F: Fn(I) -> Fut,
    Fut: std::future::Future<Output = OvhResult<T>>,
{
    stream::iter(ids.into_iter().map(fetch))
        .buffered(FAN_OUT)
        .try_collect()
        .await
}

// ===========================================================================
// Le domaine
// ===========================================================================

pub async fn list_domains(client: &OvhClient, creds: &Credentials) -> OvhResult<Vec<String>> {
    client
        .call(creds, Method::GET, "/domain", None::<&()>)
        .await
}

pub async fn get_domain(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
) -> OvhResult<DomainServiceWithIam> {
    client
        .call(
            creds,
            Method::GET,
            &format!("/domain/{service_name}"),
            None::<&()>,
        )
        .await
}

/// Charge la fiche complète de chaque domaine du compte.
pub async fn get_all_domains(
    client: &OvhClient,
    creds: &Credentials,
) -> OvhResult<Vec<DomainServiceWithIam>> {
    let names = list_domains(client, creds).await?;
    fetch_all(names, |name| async move {
        get_domain(client, creds, &name).await
    })
    .await
}

/// `PUT /domain/{serviceName}` — seuls ces deux champs sont modifiables.
pub async fn update_domain(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
    name_server_type: Option<NameServerType>,
    transfer_lock_status: Option<LockStatus>,
) -> OvhResult<()> {
    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Body {
        #[serde(skip_serializing_if = "Option::is_none")]
        name_server_type: Option<NameServerType>,
        #[serde(skip_serializing_if = "Option::is_none")]
        transfer_lock_status: Option<LockStatus>,
    }
    client
        .call::<serde_json::Value>(
            creds,
            Method::PUT,
            &format!("/domain/{service_name}"),
            Some(&Body {
                name_server_type,
                transfer_lock_status,
            }),
        )
        .await?;
    Ok(())
}

/// Code d'autorisation de transfert (auth-info). L'API le renvoie en clair :
/// à ne jamais logger.
pub async fn get_auth_info(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
) -> OvhResult<String> {
    client
        .call(
            creds,
            Method::GET,
            &format!("/domain/{service_name}/authInfo"),
            None::<&()>,
        )
        .await
}

// ===========================================================================
// Facturation / renouvellement
// ===========================================================================

pub async fn get_service_info(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
) -> OvhResult<Service> {
    client
        .call(
            creds,
            Method::GET,
            &format!("/domain/{service_name}/serviceInfos"),
            None::<&()>,
        )
        .await
}

/// Met à jour le mode de renouvellement.
///
/// L'API accepte l'objet `services.Service` entier mais n'agit que sur `renew` :
/// on relit donc la fiche et on ne remplace que ce bloc, pour ne pas renvoyer
/// des champs en lecture seule désynchronisés.
pub async fn set_renew(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
    renew: RenewType,
) -> OvhResult<()> {
    let mut service = get_service_info(client, creds, service_name).await?;
    service.renew = Some(renew);
    client
        .call::<serde_json::Value>(
            creds,
            Method::PUT,
            &format!("/domain/{service_name}/serviceInfos"),
            Some(&service),
        )
        .await?;
    Ok(())
}

// ===========================================================================
// La zone DNS
// ===========================================================================

pub async fn list_zones(client: &OvhClient, creds: &Credentials) -> OvhResult<Vec<String>> {
    client
        .call(creds, Method::GET, "/domain/zone", None::<&()>)
        .await
}

pub async fn get_zone(
    client: &OvhClient,
    creds: &Credentials,
    zone: &str,
) -> OvhResult<ZoneWithIam> {
    client
        .call(
            creds,
            Method::GET,
            &format!("/domain/zone/{zone}"),
            None::<&()>,
        )
        .await
}

pub async fn get_zone_status(
    client: &OvhClient,
    creds: &Credentials,
    zone: &str,
) -> OvhResult<ZoneStatus> {
    client
        .call(
            creds,
            Method::GET,
            &format!("/domain/zone/{zone}/status"),
            None::<&()>,
        )
        .await
}

pub async fn get_zone_capabilities(
    client: &OvhClient,
    creds: &Credentials,
    zone: &str,
) -> OvhResult<ZoneCapabilities> {
    client
        .call(
            creds,
            Method::GET,
            &format!("/domain/zone/{zone}/capabilities"),
            None::<&()>,
        )
        .await
}

pub async fn get_soa(client: &OvhClient, creds: &Credentials, zone: &str) -> OvhResult<Soa> {
    client
        .call(
            creds,
            Method::GET,
            &format!("/domain/zone/{zone}/soa"),
            None::<&()>,
        )
        .await
}

pub async fn set_soa(
    client: &OvhClient,
    creds: &Credentials,
    zone: &str,
    soa: &Soa,
) -> OvhResult<()> {
    client
        .call::<serde_json::Value>(
            creds,
            Method::PUT,
            &format!("/domain/zone/{zone}/soa"),
            Some(soa),
        )
        .await?;
    Ok(())
}

/// Publie les modifications en attente. Sans cet appel, rien n'est servi.
pub async fn refresh_zone(client: &OvhClient, creds: &Credentials, zone: &str) -> OvhResult<()> {
    client
        .call::<serde_json::Value>(
            creds,
            Method::POST,
            &format!("/domain/zone/{zone}/refresh"),
            None::<&()>,
        )
        .await?;
    Ok(())
}

/// Export au format de fichier de zone BIND.
pub async fn export_zone(client: &OvhClient, creds: &Credentials, zone: &str) -> OvhResult<String> {
    client
        .call(
            creds,
            Method::GET,
            &format!("/domain/zone/{zone}/export"),
            None::<&()>,
        )
        .await
}

pub async fn import_zone(
    client: &OvhClient,
    creds: &Credentials,
    zone: &str,
    zone_file: String,
) -> OvhResult<ZoneTask> {
    client
        .call(
            creds,
            Method::POST,
            &format!("/domain/zone/{zone}/import"),
            Some(&ZoneImport { zone_file }),
        )
        .await
}

/// Statut DNSSEC de la zone. Deux de ses quatre valeurs sont transitoires.
pub async fn get_dnssec(
    client: &OvhClient,
    creds: &Credentials,
    zone: &str,
) -> OvhResult<ZoneDnssec> {
    client
        .call(
            creds,
            Method::GET,
            &format!("/domain/zone/{zone}/dnssec"),
            None::<&()>,
        )
        .await
}

/// Active DNSSEC. L'opération est longue côté registre : le statut passe par
/// `enableInProgress` avant d'arriver à `enabled`.
pub async fn enable_dnssec(client: &OvhClient, creds: &Credentials, zone: &str) -> OvhResult<()> {
    client
        .call::<serde_json::Value>(
            creds,
            Method::POST,
            &format!("/domain/zone/{zone}/dnssec"),
            None::<&()>,
        )
        .await?;
    Ok(())
}

pub async fn disable_dnssec(client: &OvhClient, creds: &Credentials, zone: &str) -> OvhResult<()> {
    client
        .call::<serde_json::Value>(
            creds,
            Method::DELETE,
            &format!("/domain/zone/{zone}/dnssec"),
            None::<&()>,
        )
        .await?;
    Ok(())
}

// ===========================================================================
// Les enregistrements
// ===========================================================================

/// Liste les identifiants, en appliquant les filtres côté serveur.
///
/// Les filtres ne sont pas cosmétiques : ils réduisent le nombre d'appels de
/// détail que [`get_records`] devra faire ensuite.
pub async fn list_record_ids(
    client: &OvhClient,
    creds: &Credentials,
    zone: &str,
    filter: &RecordFilter,
) -> OvhResult<Vec<i64>> {
    let mut query = Vec::new();
    if let Some(t) = &filter.field_type {
        query.push(format!("fieldType={}", t.as_wire()));
    }
    if let Some(sub) = &filter.sub_domain {
        query.push(format!("subDomain={}", urlencoding(sub)));
    }
    let path = if query.is_empty() {
        format!("/domain/zone/{zone}/record")
    } else {
        format!("/domain/zone/{zone}/record?{}", query.join("&"))
    };
    client.call(creds, Method::GET, &path, None::<&()>).await
}

/// Encodage minimal pour une valeur de query string.
///
/// La valeur entre aussi dans la signature : elle doit être identique dans l'URL
/// signée et dans l'URL envoyée, d'où un encodage fait une fois ici plutôt que
/// laissé à reqwest.
fn urlencoding(value: &str) -> String {
    value
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'*' => {
                (b as char).to_string()
            }
            other => format!("%{other:02X}"),
        })
        .collect()
}

pub async fn get_record(
    client: &OvhClient,
    creds: &Credentials,
    zone: &str,
    id: i64,
) -> OvhResult<Record> {
    client
        .call(
            creds,
            Method::GET,
            &format!("/domain/zone/{zone}/record/{id}"),
            None::<&()>,
        )
        .await
}

/// Les enregistrements complets d'une zone.
///
/// C'est ici que se paie le défaut de l'API : la liste ne rend que des
/// identifiants. Le fan-out borné rend l'attente supportable, mais l'appelant
/// doit rester prêt à afficher progressivement.
pub async fn get_records(
    client: &OvhClient,
    creds: &Credentials,
    zone: &str,
    filter: &RecordFilter,
) -> OvhResult<Vec<Record>> {
    let ids = list_record_ids(client, creds, zone, filter).await?;
    fetch_all(ids, |id| async move {
        get_record(client, creds, zone, id).await
    })
    .await
}

pub async fn create_record(
    client: &OvhClient,
    creds: &Credentials,
    zone: &str,
    record: &RecordCreate,
) -> OvhResult<Record> {
    client
        .call(
            creds,
            Method::POST,
            &format!("/domain/zone/{zone}/record"),
            Some(record),
        )
        .await
}

pub async fn update_record(
    client: &OvhClient,
    creds: &Credentials,
    zone: &str,
    id: i64,
    record: &RecordUpdate,
) -> OvhResult<()> {
    client
        .call::<serde_json::Value>(
            creds,
            Method::PUT,
            &format!("/domain/zone/{zone}/record/{id}"),
            Some(record),
        )
        .await?;
    Ok(())
}

pub async fn delete_record(
    client: &OvhClient,
    creds: &Credentials,
    zone: &str,
    id: i64,
) -> OvhResult<()> {
    client
        .call::<serde_json::Value>(
            creds,
            Method::DELETE,
            &format!("/domain/zone/{zone}/record/{id}"),
            None::<&()>,
        )
        .await?;
    Ok(())
}

// ===========================================================================
// DynHost
// ===========================================================================

pub async fn get_dynhost_logins(
    client: &OvhClient,
    creds: &Credentials,
    zone: &str,
) -> OvhResult<Vec<DynHostLogin>> {
    let logins: Vec<String> = client
        .call(
            creds,
            Method::GET,
            &format!("/domain/zone/{zone}/dynHost/login"),
            None::<&()>,
        )
        .await?;
    fetch_all(logins, |login| async move {
        client
            .call(
                creds,
                Method::GET,
                &format!("/domain/zone/{zone}/dynHost/login/{login}"),
                None::<&()>,
            )
            .await
    })
    .await
}

pub async fn create_dynhost_login(
    client: &OvhClient,
    creds: &Credentials,
    zone: &str,
    payload: &DynHostLoginCreate,
) -> OvhResult<DynHostLogin> {
    client
        .call(
            creds,
            Method::POST,
            &format!("/domain/zone/{zone}/dynHost/login"),
            Some(payload),
        )
        .await
}

pub async fn update_dynhost_login(
    client: &OvhClient,
    creds: &Credentials,
    zone: &str,
    login: &str,
    payload: &DynHostLogin,
) -> OvhResult<()> {
    client
        .call::<serde_json::Value>(
            creds,
            Method::PUT,
            &format!("/domain/zone/{zone}/dynHost/login/{login}"),
            Some(payload),
        )
        .await?;
    Ok(())
}

pub async fn change_dynhost_password(
    client: &OvhClient,
    creds: &Credentials,
    zone: &str,
    login: &str,
    password: String,
) -> OvhResult<()> {
    client
        .call::<serde_json::Value>(
            creds,
            Method::POST,
            &format!("/domain/zone/{zone}/dynHost/login/{login}/changePassword"),
            Some(&DynHostLoginChangePassword { password }),
        )
        .await?;
    Ok(())
}

pub async fn delete_dynhost_login(
    client: &OvhClient,
    creds: &Credentials,
    zone: &str,
    login: &str,
) -> OvhResult<()> {
    client
        .call::<serde_json::Value>(
            creds,
            Method::DELETE,
            &format!("/domain/zone/{zone}/dynHost/login/{login}"),
            None::<&()>,
        )
        .await?;
    Ok(())
}

pub async fn get_dynhost_records(
    client: &OvhClient,
    creds: &Credentials,
    zone: &str,
) -> OvhResult<Vec<DynHostRecord>> {
    let ids: Vec<i64> = client
        .call(
            creds,
            Method::GET,
            &format!("/domain/zone/{zone}/dynHost/record"),
            None::<&()>,
        )
        .await?;
    fetch_all(ids, |id| async move {
        client
            .call(
                creds,
                Method::GET,
                &format!("/domain/zone/{zone}/dynHost/record/{id}"),
                None::<&()>,
            )
            .await
    })
    .await
}

// ===========================================================================
// Serveurs DNS et glue records
// ===========================================================================

pub async fn get_name_servers(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
) -> OvhResult<Vec<FullNameServer>> {
    let ids: Vec<i64> = client
        .call(
            creds,
            Method::GET,
            &format!("/domain/{service_name}/nameServer"),
            None::<&()>,
        )
        .await?;
    fetch_all(ids, |id| async move {
        client
            .call(
                creds,
                Method::GET,
                &format!("/domain/{service_name}/nameServer/{id}"),
                None::<&()>,
            )
            .await
    })
    .await
}

pub async fn get_name_server_status(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
    id: i64,
) -> OvhResult<NameServerStatus> {
    client
        .call(
            creds,
            Method::GET,
            &format!("/domain/{service_name}/nameServer/{id}/status"),
            None::<&()>,
        )
        .await
}

/// Remplace l'intégralité de la configuration DNS du domaine.
///
/// Ce n'est pas un ajout : un serveur absent de `name_servers` est supprimé.
/// L'appelant doit donc envoyer la liste complète voulue.
pub async fn replace_name_servers(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
    name_servers: Vec<NameServerInput>,
) -> OvhResult<DomainTask> {
    client
        .call(
            creds,
            Method::POST,
            &format!("/domain/{service_name}/nameServers/update"),
            Some(&NameServerUpdate { name_servers }),
        )
        .await
}

pub async fn get_glue_records(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
) -> OvhResult<Vec<GlueRecord>> {
    let hosts: Vec<String> = client
        .call(
            creds,
            Method::GET,
            &format!("/domain/{service_name}/glueRecord"),
            None::<&()>,
        )
        .await?;
    fetch_all(hosts, |host| async move {
        client
            .call(
                creds,
                Method::GET,
                &format!("/domain/{service_name}/glueRecord/{host}"),
                None::<&()>,
            )
            .await
    })
    .await
}

pub async fn create_glue_record(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
    payload: &GlueRecordCreate,
) -> OvhResult<DomainTask> {
    client
        .call(
            creds,
            Method::POST,
            &format!("/domain/{service_name}/glueRecord"),
            Some(payload),
        )
        .await
}

pub async fn update_glue_record(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
    host: &str,
    ips: Vec<String>,
) -> OvhResult<DomainTask> {
    #[derive(serde::Serialize)]
    struct Body {
        ips: Vec<String>,
    }
    client
        .call(
            creds,
            Method::POST,
            &format!("/domain/{service_name}/glueRecord/{host}/update"),
            Some(&Body { ips }),
        )
        .await
}

pub async fn delete_glue_record(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
    host: &str,
) -> OvhResult<DomainTask> {
    client
        .call(
            creds,
            Method::DELETE,
            &format!("/domain/{service_name}/glueRecord/{host}"),
            None::<&()>,
        )
        .await
}

// ===========================================================================
// Contacts WHOIS
// ===========================================================================

pub async fn get_contacts(client: &OvhClient, creds: &Credentials) -> OvhResult<Vec<Contact>> {
    client
        .call(creds, Method::GET, "/domain/contact", None::<&()>)
        .await
}

pub async fn get_contact(
    client: &OvhClient,
    creds: &Credentials,
    contact_id: i64,
) -> OvhResult<Contact> {
    client
        .call(
            creds,
            Method::GET,
            &format!("/domain/contact/{contact_id}"),
            None::<&()>,
        )
        .await
}

pub async fn update_contact(
    client: &OvhClient,
    creds: &Credentials,
    contact_id: i64,
    contact: &Contact,
) -> OvhResult<Contact> {
    client
        .call(
            creds,
            Method::PUT,
            &format!("/domain/contact/{contact_id}"),
            Some(contact),
        )
        .await
}

/// Change les contacts administratif, de facturation et technique.
///
/// Le propriétaire (registrant) n'en fait pas partie : son changement relève
/// d'une procédure de trade chez le registre, hors de cette route.
pub async fn change_contacts(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
    payload: &ChangeContact,
) -> OvhResult<Vec<i64>> {
    client
        .call(
            creds,
            Method::POST,
            &format!("/domain/{service_name}/changeContact"),
            Some(payload),
        )
        .await
}

// ===========================================================================
// Tâches
// ===========================================================================

pub async fn get_domain_tasks(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
) -> OvhResult<Vec<DomainTask>> {
    let ids: Vec<i64> = client
        .call(
            creds,
            Method::GET,
            &format!("/domain/{service_name}/task"),
            None::<&()>,
        )
        .await?;
    fetch_all(ids, |id| async move {
        client
            .call(
                creds,
                Method::GET,
                &format!("/domain/{service_name}/task/{id}"),
                None::<&()>,
            )
            .await
    })
    .await
}

pub async fn get_zone_tasks(
    client: &OvhClient,
    creds: &Credentials,
    zone: &str,
) -> OvhResult<Vec<ZoneTask>> {
    let ids: Vec<i64> = client
        .call(
            creds,
            Method::GET,
            &format!("/domain/zone/{zone}/task"),
            None::<&()>,
        )
        .await?;
    fetch_all(ids, |id| async move {
        client
            .call(
                creds,
                Method::GET,
                &format!("/domain/zone/{zone}/task/{id}"),
                None::<&()>,
            )
            .await
    })
    .await
}

/// Action sur une tâche. À n'appeler que si le drapeau `can…` correspondant est
/// vrai : l'API refuse sinon.
#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskAction {
    Accelerate,
    Cancel,
    Relaunch,
}

impl TaskAction {
    fn segment(self) -> &'static str {
        match self {
            TaskAction::Accelerate => "accelerate",
            TaskAction::Cancel => "cancel",
            TaskAction::Relaunch => "relaunch",
        }
    }
}

pub async fn act_on_domain_task(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
    id: i64,
    action: TaskAction,
) -> OvhResult<()> {
    client
        .call::<serde_json::Value>(
            creds,
            Method::POST,
            &format!("/domain/{service_name}/task/{id}/{}", action.segment()),
            None::<&()>,
        )
        .await?;
    Ok(())
}

pub async fn act_on_zone_task(
    client: &OvhClient,
    creds: &Credentials,
    zone: &str,
    id: i64,
    action: TaskAction,
) -> OvhResult<()> {
    client
        .call::<serde_json::Value>(
            creds,
            Method::POST,
            &format!("/domain/zone/{zone}/task/{id}/{}", action.segment()),
            None::<&()>,
        )
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_values_are_percent_encoded() {
        assert_eq!(urlencoding("www"), "www");
        assert_eq!(urlencoding("*"), "*");
        assert_eq!(urlencoding("_dmarc.mail"), "_dmarc.mail");
        assert_eq!(urlencoding("a b"), "a%20b");
        assert_eq!(urlencoding("é"), "%C3%A9");
    }
}

//! Appels à la section `/hosting/web` de l'API OVHcloud.
//!
//! Mêmes défauts que la section domaine, mêmes remèdes : les listes ne rendent
//! que des identifiants, donc [`fetch_all`](crate::ovh::domain::api) — ici
//! réécrit localement pour ne pas croiser les deux sections — et les écritures
//! rendent des tâches.

use futures::stream::{self, StreamExt, TryStreamExt};
use reqwest::Method;
use serde::Serialize;

use crate::ovh::client::OvhClient;
use crate::ovh::credentials::Credentials;
use crate::ovh::error::OvhResult;
use crate::ovh::models::hosting::*;

/// Même borne que pour les domaines : au-delà, l'API répond 429.
const FAN_OUT: usize = 8;

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

fn encode(value: &str) -> String {
    value
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            other => format!("%{other:02X}"),
        })
        .collect()
}

// ------------------------------------------------------------- hébergements

pub async fn list(client: &OvhClient, creds: &Credentials) -> OvhResult<Vec<String>> {
    client
        .call(creds, Method::GET, "/hosting/web", None::<&()>)
        .await
}

pub async fn get(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
) -> OvhResult<HostingService> {
    client
        .call(
            creds,
            Method::GET,
            &format!("/hosting/web/{service_name}"),
            None::<&()>,
        )
        .await
}

pub async fn get_all(client: &OvhClient, creds: &Credentials) -> OvhResult<Vec<HostingService>> {
    let names = list(client, creds).await?;
    fetch_all(names, |name| async move { get(client, creds, &name).await }).await
}

/// Ce que l'offre autorise.
///
/// Route **non authentifiée** : seule la clé d'application est nécessaire, donc
/// les capacités sont lisibles même avant que l'utilisateur ait validé sa
/// délégation. Le paramètre attend une valeur de `OfferEnum` — les deux
/// énumérations de l'API sont identiques, `HostingService::offer` se passe tel
/// quel.
pub async fn offer_capabilities(
    client: &OvhClient,
    creds: &Credentials,
    offer: &str,
) -> OvhResult<HostingCapabilities> {
    client
        .call_unauthenticated(
            creds,
            Method::GET,
            &format!("/hosting/web/offerCapabilities?offer={}", encode(offer)),
            None::<&()>,
        )
        .await
}

// -------------------------------------------------------------- multisites

/// Les multisites, **avec leurs capacités**.
///
/// La lecture rend `PublicAttachedDomain`, pas le payload d'écriture : c'est là
/// que se trouvent `capabilities`, qui dit quelles actions l'API acceptera.
pub async fn attached_domains(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
) -> OvhResult<Vec<AttachedDomainDetail>> {
    let domains: Vec<String> = client
        .call(
            creds,
            Method::GET,
            &format!("/hosting/web/{service_name}/attachedDomain"),
            None::<&()>,
        )
        .await?;
    fetch_all(domains, |domain| async move {
        client
            .call(
                creds,
                Method::GET,
                &format!(
                    "/hosting/web/{service_name}/attachedDomain/{}",
                    encode(&domain)
                ),
                None::<&()>,
            )
            .await
    })
    .await
}

/// Crée un multisite.
///
/// Avec `bypass_dns_configuration` à `false` — le défaut de l'API —, cet appel
/// **écrit dans la zone DNS du domaine**, qui relève d'une autre section.
pub async fn create_attached_domain(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
    payload: &AttachedDomain,
) -> OvhResult<HostingTask> {
    client
        .call(
            creds,
            Method::POST,
            &format!("/hosting/web/{service_name}/attachedDomain"),
            Some(payload),
        )
        .await
}

pub async fn update_attached_domain(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
    domain: &str,
    payload: &AttachedDomain,
) -> OvhResult<()> {
    client
        .call::<serde_json::Value>(
            creds,
            Method::PUT,
            &format!(
                "/hosting/web/{service_name}/attachedDomain/{}",
                encode(domain)
            ),
            Some(payload),
        )
        .await?;
    Ok(())
}

pub async fn delete_attached_domain(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
    domain: &str,
) -> OvhResult<HostingTask> {
    client
        .call(
            creds,
            Method::DELETE,
            &format!(
                "/hosting/web/{service_name}/attachedDomain/{}",
                encode(domain)
            ),
            None::<&()>,
        )
        .await
}

// ------------------------------------------------------------ utilisateurs

pub async fn users(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
) -> OvhResult<Vec<HostingUser>> {
    let logins: Vec<String> = client
        .call(
            creds,
            Method::GET,
            &format!("/hosting/web/{service_name}/user"),
            None::<&()>,
        )
        .await?;
    fetch_all(logins, |login| async move {
        client
            .call(
                creds,
                Method::GET,
                &format!("/hosting/web/{service_name}/user/{}", encode(&login)),
                None::<&()>,
            )
            .await
    })
    .await
}

pub async fn create_user(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
    payload: &HostingUserCreate,
) -> OvhResult<HostingTask> {
    client
        .call(
            creds,
            Method::POST,
            &format!("/hosting/web/{service_name}/user"),
            Some(payload),
        )
        .await
}

pub async fn update_user(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
    login: &str,
    payload: &HostingUser,
) -> OvhResult<()> {
    client
        .call::<serde_json::Value>(
            creds,
            Method::PUT,
            &format!("/hosting/web/{service_name}/user/{}", encode(login)),
            Some(payload),
        )
        .await?;
    Ok(())
}

pub async fn change_user_password(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
    login: &str,
    password: String,
) -> OvhResult<HostingTask> {
    #[derive(Serialize)]
    struct Body {
        password: String,
    }
    client
        .call(
            creds,
            Method::POST,
            &format!(
                "/hosting/web/{service_name}/user/{}/changePassword",
                encode(login)
            ),
            Some(&Body { password }),
        )
        .await
}

pub async fn delete_user(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
    login: &str,
) -> OvhResult<HostingTask> {
    client
        .call(
            creds,
            Method::DELETE,
            &format!("/hosting/web/{service_name}/user/{}", encode(login)),
            None::<&()>,
        )
        .await
}

// --------------------------------------------------------- bases de données

pub async fn databases(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
) -> OvhResult<Vec<Database>> {
    let names: Vec<String> = client
        .call(
            creds,
            Method::GET,
            &format!("/hosting/web/{service_name}/database"),
            None::<&()>,
        )
        .await?;
    fetch_all(names, |name| async move {
        client
            .call(
                creds,
                Method::GET,
                &format!("/hosting/web/{service_name}/database/{}", encode(&name)),
                None::<&()>,
            )
            .await
    })
    .await
}

pub async fn dumps(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
    database: &str,
) -> OvhResult<Vec<DatabaseDump>> {
    let ids: Vec<i64> = client
        .call(
            creds,
            Method::GET,
            &format!(
                "/hosting/web/{service_name}/database/{}/dump",
                encode(database)
            ),
            None::<&()>,
        )
        .await?;
    fetch_all(ids, |id| async move {
        client
            .call(
                creds,
                Method::GET,
                &format!(
                    "/hosting/web/{service_name}/database/{}/dump/{id}",
                    encode(database)
                ),
                None::<&()>,
            )
            .await
    })
    .await
}

/// Demande une sauvegarde immédiate.
pub async fn create_dump(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
    database: &str,
) -> OvhResult<HostingTask> {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Body {
        send_email: bool,
    }
    client
        .call(
            creds,
            Method::POST,
            &format!(
                "/hosting/web/{service_name}/database/{}/dump",
                encode(database)
            ),
            Some(&Body { send_email: false }),
        )
        .await
}

// ----------------------------------------------------- ce qui s'exécute

pub async fn crons(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
) -> OvhResult<Vec<Cron>> {
    let ids: Vec<i64> = client
        .call(
            creds,
            Method::GET,
            &format!("/hosting/web/{service_name}/cron"),
            None::<&()>,
        )
        .await?;
    fetch_all(ids, |id| async move {
        client
            .call(
                creds,
                Method::GET,
                &format!("/hosting/web/{service_name}/cron/{id}"),
                None::<&()>,
            )
            .await
    })
    .await
}

pub async fn create_cron(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
    payload: &CronInput,
) -> OvhResult<HostingTask> {
    client
        .call(
            creds,
            Method::POST,
            &format!("/hosting/web/{service_name}/cron"),
            Some(payload),
        )
        .await
}

pub async fn delete_cron(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
    id: i64,
) -> OvhResult<HostingTask> {
    client
        .call(
            creds,
            Method::DELETE,
            &format!("/hosting/web/{service_name}/cron/{id}"),
            None::<&()>,
        )
        .await
}

pub async fn env_vars(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
) -> OvhResult<Vec<EnvVar>> {
    let keys: Vec<String> = client
        .call(
            creds,
            Method::GET,
            &format!("/hosting/web/{service_name}/envVar"),
            None::<&()>,
        )
        .await?;
    fetch_all(keys, |key| async move {
        client
            .call(
                creds,
                Method::GET,
                &format!("/hosting/web/{service_name}/envVar/{}", encode(&key)),
                None::<&()>,
            )
            .await
    })
    .await
}

pub async fn create_env_var(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
    key: String,
    value: String,
    kind: EnvVarType,
) -> OvhResult<HostingTask> {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Body {
        key: String,
        value: String,
        r#type: EnvVarType,
    }
    client
        .call(
            creds,
            Method::POST,
            &format!("/hosting/web/{service_name}/envVar"),
            Some(&Body {
                key,
                value,
                r#type: kind,
            }),
        )
        .await
}

pub async fn delete_env_var(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
    key: &str,
) -> OvhResult<HostingTask> {
    client
        .call(
            creds,
            Method::DELETE,
            &format!("/hosting/web/{service_name}/envVar/{}", encode(key)),
            None::<&()>,
        )
        .await
}

pub async fn runtimes(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
) -> OvhResult<Vec<Runtime>> {
    let ids: Vec<i64> = client
        .call(
            creds,
            Method::GET,
            &format!("/hosting/web/{service_name}/runtime"),
            None::<&()>,
        )
        .await?;
    fetch_all(ids, |id| async move {
        client
            .call(
                creds,
                Method::GET,
                &format!("/hosting/web/{service_name}/runtime/{id}"),
                None::<&()>,
            )
            .await
    })
    .await
}

// ------------------------------------------------------ certificat et tâches

pub async fn ssl(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
) -> OvhResult<HostingSsl> {
    client
        .call(
            creds,
            Method::GET,
            &format!("/hosting/web/{service_name}/ssl"),
            None::<&()>,
        )
        .await
}

pub async fn tasks(
    client: &OvhClient,
    creds: &Credentials,
    service_name: &str,
) -> OvhResult<Vec<HostingTask>> {
    let ids: Vec<i64> = client
        .call(
            creds,
            Method::GET,
            &format!("/hosting/web/{service_name}/tasks"),
            None::<&()>,
        )
        .await?;
    fetch_all(ids, |id| async move {
        client
            .call(
                creds,
                Method::GET,
                &format!("/hosting/web/{service_name}/tasks/{id}"),
                None::<&()>,
            )
            .await
    })
    .await
}

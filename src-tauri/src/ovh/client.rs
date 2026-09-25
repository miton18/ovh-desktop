//! Couche d'appel signé au-dessus de reqwest.

use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::RwLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::de::DeserializeOwned;
use serde::Serialize;

use super::credentials::Credentials;
use super::endpoint::{url_for, Branch, Endpoint};
use super::error::{OvhApiError, OvhError, OvhResult};
use super::signer::sign;

/// Racine et branche visées par le client.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Target {
    pub endpoint: Endpoint,
    pub branch: Branch,
}

pub struct OvhClient {
    http: reqwest::Client,
    /// Modifiable à chaud : changer d'endpoint ne doit pas demander un
    /// redémarrage, et le pool de connexions reqwest reste réutilisable.
    target: RwLock<Target>,
    /// Écart en secondes entre l'horloge locale et celle d'OVH.
    ///
    /// L'API rejette une signature dont le timestamp dérive de plus de quelques
    /// minutes. On mesure l'écart une fois via `GET /auth/time` plutôt que de
    /// faire confiance à l'horloge de la machine.
    time_delta: AtomicI64,
}

impl OvhClient {
    pub fn new(endpoint: Endpoint, user_agent: &str) -> OvhResult<Self> {
        Ok(Self {
            http: reqwest::Client::builder()
                .user_agent(user_agent)
                .timeout(Duration::from_secs(30))
                .connect_timeout(Duration::from_secs(5))
                .build()?,
            target: RwLock::new(Target {
                endpoint,
                branch: endpoint.default_branch(),
            }),
            time_delta: AtomicI64::new(0),
        })
    }

    pub fn target(&self) -> Target {
        *self.target.read().expect("target mutex empoisonné")
    }

    pub fn endpoint(&self) -> Endpoint {
        self.target().endpoint
    }

    pub fn branch(&self) -> Branch {
        self.target().branch
    }

    /// Bascule d'endpoint. La branche retombe sur celle que l'endpoint sert
    /// réellement, et l'écart d'horloge est remis à zéro : il a été mesuré sur
    /// un autre serveur, donc il ne vaut plus rien ici.
    pub fn set_endpoint(&self, endpoint: Endpoint) {
        *self.target.write().expect("target mutex empoisonné") = Target {
            endpoint,
            branch: endpoint.default_branch(),
        };
        self.time_delta.store(0, Ordering::Relaxed);
    }

    fn local_now() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0)
    }

    fn signing_timestamp(&self) -> i64 {
        Self::local_now() + self.time_delta.load(Ordering::Relaxed)
    }

    /// Interroge l'horloge d'OVH et mémorise l'écart. Route non authentifiée.
    pub async fn sync_time(&self) -> OvhResult<i64> {
        let target = self.target();
        let url = url_for(target.endpoint, target.branch, "/auth/time");
        let text = self.http.get(&url).send().await?.text().await?;
        let server: i64 = text
            .trim()
            .parse()
            .map_err(|_| OvhError::Decode(format!("/auth/time a renvoyé {text:?}")))?;
        let delta = server - Self::local_now();
        self.time_delta.store(delta, Ordering::Relaxed);
        Ok(delta)
    }

    /// Appel signé. `creds.consumer_key` doit être présent.
    pub async fn call<T: DeserializeOwned>(
        &self,
        creds: &Credentials,
        method: reqwest::Method,
        path: &str,
        body: Option<&impl Serialize>,
    ) -> OvhResult<T> {
        let consumer_key = creds
            .consumer_key
            .as_deref()
            .ok_or(OvhError::NotConfigured)?;
        let text = self
            .send(creds, Some(consumer_key), method, path, body)
            .await?;
        decode(&text)
    }

    /// Appel non signé : seules `/auth/credential` et `/auth/time` en ont besoin.
    pub async fn call_unauthenticated<T: DeserializeOwned>(
        &self,
        creds: &Credentials,
        method: reqwest::Method,
        path: &str,
        body: Option<&impl Serialize>,
    ) -> OvhResult<T> {
        let text = self.send(creds, None, method, path, body).await?;
        decode(&text)
    }

    async fn send(
        &self,
        creds: &Credentials,
        consumer_key: Option<&str>,
        method: reqwest::Method,
        path: &str,
        body: Option<&impl Serialize>,
    ) -> OvhResult<String> {
        let target = self.target();
        let url = url_for(target.endpoint, target.branch, path);

        // Sérialisé UNE fois : ces octets exacts sont signés puis envoyés.
        let body = match body {
            Some(b) => {
                serde_json::to_string(b).map_err(|e| OvhError::Decode(format!("corps: {e}")))?
            }
            None => String::new(),
        };

        let mut req = self
            .http
            .request(method.clone(), &url)
            .header("X-Ovh-Application", &creds.application_key);

        if !body.is_empty() {
            req = req.header(reqwest::header::CONTENT_TYPE, "application/json");
        }

        if let Some(ck) = consumer_key {
            let ts = self.signing_timestamp();
            let signature = sign(
                &creds.application_secret,
                ck,
                method.as_str(),
                &url,
                &body,
                ts,
            );
            req = req
                .header("X-Ovh-Consumer", ck)
                .header("X-Ovh-Timestamp", ts.to_string())
                .header("X-Ovh-Signature", signature);
        }

        let started = std::time::Instant::now();
        let res = req.body(body).send().await?;
        let status = res.status();
        let text = res.text().await?;

        // Une ligne par appel : la méthode, l'URL complète, le code et la durée.
        // C'est le minimum pour comprendre ce que fait vraiment l'application —
        // et c'est aussi l'URL exacte qui entre dans la signature.
        log::info!(
            "{} {} → {} en {} ms",
            method,
            url,
            status.as_u16(),
            started.elapsed().as_millis()
        );

        if status.is_success() {
            return Ok(text);
        }

        // OVH répond {"class":"Client::Forbidden","message":"..."} sur erreur.
        let (class, message) = match serde_json::from_str::<OvhApiError>(&text) {
            Ok(e) => (e.class.unwrap_or_else(|| "Unknown".into()), e.message),
            Err(_) => ("Unknown".into(), text),
        };
        Err(OvhError::Api {
            status: status.as_u16(),
            class,
            message,
        })
    }
}

/// `void` côté OVH = corps vide : `serde_json` refuse "" pour `()`.
fn decode<T: DeserializeOwned>(text: &str) -> OvhResult<T> {
    let text = if text.trim().is_empty() { "null" } else { text };
    serde_json::from_str(text).map_err(|e| OvhError::Decode(e.to_string()))
}

//! Registre des comptes OVHcloud connus de l'application.
//!
//! Un client OVHcloud a souvent plusieurs NIC — un personnel, un professionnel,
//! un par client s'il est prestataire. Et comme **chaque racine a son propre
//! compte** (un NIC européen n'existe pas sur la racine canadienne), un compte
//! est ici la paire *endpoint + délégation*.
//!
//! Ce registre ne contient **aucun secret** : les identifiants, l'endpoint, le
//! nichandle et le libellé. Les consumer keys vivent dans le trousseau du
//! système, une entrée par compte (voir [`super::credentials`]). D'où un simple
//! fichier JSON à côté de la configuration, plutôt qu'une entrée de trousseau de
//! plus à déverrouiller au démarrage.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

use super::endpoint::Endpoint;
use super::error::{OvhError, OvhResult};

const FILE: &str = "accounts.json";

/// Un compte, tel qu'on le connaît sans appeler l'API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub endpoint: Endpoint,
    /// Identifiant client OVHcloud (`ab12345-ovh`), renseigné après la première
    /// autorisation réussie. Absent tant que la délégation n'a pas abouti.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nichandle: Option<String>,
    /// Nom donné par l'utilisateur. Vide tant qu'il n'en a pas choisi un : c'est
    /// alors le nichandle qui sert d'étiquette.
    #[serde(default)]
    pub label: String,
}

impl Account {
    /// Ce qu'on affiche quand il faut nommer ce compte en une ligne.
    pub fn display_name(&self) -> String {
        if !self.label.trim().is_empty() {
            return self.label.trim().to_owned();
        }
        match &self.nichandle {
            Some(nic) => nic.clone(),
            // Un compte créé mais jamais autorisé n'a encore aucun nom propre.
            None => format!("Nouveau compte · {}", self.endpoint.label()),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Registry {
    /// Compte courant. `None` quand le registre est vide.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active: Option<String>,
    #[serde(default)]
    pub accounts: Vec<Account>,
}

impl Registry {
    pub fn get(&self, id: &str) -> Option<&Account> {
        self.accounts.iter().find(|a| a.id == id)
    }

    pub fn active_account(&self) -> Option<&Account> {
        self.active.as_deref().and_then(|id| self.get(id))
    }

    /// Ajoute un compte et le rend actif : on vient de le créer pour s'en servir.
    pub fn add(&mut self, endpoint: Endpoint, label: String) -> Account {
        let account = Account {
            id: new_id(endpoint),
            endpoint,
            nichandle: None,
            label,
        };
        self.accounts.push(account.clone());
        self.active = Some(account.id.clone());
        account
    }

    /// Retire un compte et, si c'était l'actif, bascule sur le premier restant.
    pub fn remove(&mut self, id: &str) -> Option<Account> {
        let index = self.accounts.iter().position(|a| a.id == id)?;
        let removed = self.accounts.remove(index);
        if self.active.as_deref() == Some(id) {
            self.active = self.accounts.first().map(|a| a.id.clone());
        }
        Some(removed)
    }

    pub fn select(&mut self, id: &str) -> OvhResult<&Account> {
        if self.get(id).is_none() {
            return Err(OvhError::Decode(format!("compte inconnu: {id}")));
        }
        self.active = Some(id.to_owned());
        Ok(self.get(id).expect("compte vérifié juste au-dessus"))
    }

    pub fn set_nichandle(&mut self, id: &str, nichandle: String) {
        if let Some(account) = self.accounts.iter_mut().find(|a| a.id == id) {
            account.nichandle = Some(nichandle);
        }
    }

    /// Un compte encore jamais autorisé sur cette racine.
    ///
    /// Tant que l'autorisation n'a pas abouti, un compte n'a pas de nichandle :
    /// impossible de le distinguer d'un autre. En réutiliser un au lieu d'en
    /// créer un second évite d'empiler des coquilles vides — c'est le chemin par
    /// lequel les doublons apparaissent, en cliquant deux fois sur « Créer ».
    pub fn unauthorized_on(&self, endpoint: Endpoint) -> Option<&Account> {
        self.accounts
            .iter()
            .find(|a| a.endpoint == endpoint && a.nichandle.is_none())
    }

    /// Les groupes d'entrées qui désignent le même compte OVHcloud.
    ///
    /// Même racine **et** même nichandle : c'est le même compte, autorisé deux
    /// fois. Purement local — aucun appel réseau n'est nécessaire pour le voir,
    /// ce qui permet de nettoyer dès le démarrage. Chaque groupe rendu compte au
    /// moins deux entrées, dans leur ordre de création.
    pub fn duplicate_groups(&self) -> Vec<Vec<Account>> {
        let mut groups: Vec<Vec<Account>> = Vec::new();
        for account in &self.accounts {
            let Some(nichandle) = account.nichandle.as_deref() else {
                continue;
            };
            match groups.iter_mut().find(|g| {
                g[0].endpoint == account.endpoint && g[0].nichandle.as_deref() == Some(nichandle)
            }) {
                Some(group) => group.push(account.clone()),
                None => groups.push(vec![account.clone()]),
            }
        }
        groups.retain(|g| g.len() > 1);
        groups
    }

    /// Fusionne dans `keep_id` les comptes qui désignent le même compte OVHcloud.
    ///
    /// Deux entrées ayant la même racine **et** le même nichandle sont le même
    /// compte : l'utilisateur a simplement autorisé deux fois. On garde celui
    /// indiqué, on récupère son libellé s'il n'en avait pas, et on rend les
    /// autres à l'appelant — à lui de révoquer leurs délégations et d'effacer
    /// leurs entrées de trousseau.
    pub fn absorb_duplicates(&mut self, keep_id: &str) -> Vec<Account> {
        let Some(keep) = self.get(keep_id).cloned() else {
            return Vec::new();
        };
        let Some(nichandle) = keep.nichandle.clone() else {
            // Sans nichandle, rien ne prouve que deux entrées sont le même compte.
            return Vec::new();
        };

        let (duplicates, kept): (Vec<Account>, Vec<Account>) =
            self.accounts.iter().cloned().partition(|a| {
                a.id != keep.id
                    && a.endpoint == keep.endpoint
                    && a.nichandle.as_deref() == Some(nichandle.as_str())
            });

        if duplicates.is_empty() {
            return Vec::new();
        }

        self.accounts = kept;

        // Un libellé donné à la main vaut mieux que pas de libellé : on le reprend.
        if keep.label.trim().is_empty() {
            if let Some(label) = duplicates
                .iter()
                .map(|d| d.label.trim())
                .find(|l| !l.is_empty())
                .map(str::to_owned)
            {
                if let Some(account) = self.accounts.iter_mut().find(|a| a.id == keep.id) {
                    account.label = label;
                }
            }
        }

        // Le survivant devient actif si l'actif vient d'être absorbé.
        let active_absorbed = self
            .active
            .as_deref()
            .is_some_and(|id| duplicates.iter().any(|d| d.id == id));
        if active_absorbed {
            self.active = Some(keep.id.clone());
        }

        duplicates
    }
}

/// Identifiant opaque. L'horodatage suffit : les comptes se créent à la main,
/// jamais deux dans la même nanoseconde.
fn new_id(endpoint: Endpoint) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{}-{nanos:x}", endpoint.id())
}

fn path<R: Runtime>(app: &AppHandle<R>) -> OvhResult<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| OvhError::Internal(format!("dossier de configuration: {e}")))?;
    Ok(dir.join(FILE))
}

/// Registre enregistré, ou vide.
///
/// Un fichier illisible n'empêche pas l'application de démarrer : on repart d'un
/// registre vide, ce qui renvoie vers l'écran de connexion — récupérable — au
/// lieu d'une erreur fatale.
pub fn load<R: Runtime>(app: &AppHandle<R>) -> Registry {
    let Ok(file) = path(app) else {
        return Registry::default();
    };
    match std::fs::read_to_string(&file) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_else(|e| {
            log::warn!("registre des comptes illisible ({e}), on repart à vide");
            Registry::default()
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Registry::default(),
        Err(e) => {
            log::warn!("lecture du registre des comptes impossible: {e}");
            Registry::default()
        }
    }
}

pub fn save<R: Runtime>(app: &AppHandle<R>, registry: &Registry) -> OvhResult<()> {
    let file = path(app)?;
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| OvhError::Internal(format!("création de {}: {e}", dir.display())))?;
    }
    let raw = serde_json::to_string_pretty(registry)
        .map_err(|e| OvhError::Decode(format!("sérialisation du registre: {e}")))?;
    std::fs::write(&file, raw)
        .map_err(|e| OvhError::Internal(format!("écriture de {}: {e}", file.display())))
}

/// Charge le registre et absorbe l'éventuel stockage mono-compte hérité.
///
/// Appelé une fois au démarrage : c'est le seul endroit où la migration peut se
/// faire avant que quoi que ce soit d'autre ne lise le trousseau.
pub fn bootstrap<R: Runtime>(app: &AppHandle<R>, endpoint: Endpoint) -> Registry {
    let mut registry = load(app);

    match super::credentials::migrate_legacy(endpoint) {
        Ok(Some(migrated)) => {
            if let Some(stored) = migrated.account {
                let account = registry.add(migrated.endpoint, String::new());
                if let Some(ck) = stored.consumer_key {
                    if let Err(e) = super::credentials::set_consumer_key(&account.id, ck) {
                        log::error!("reprise de la délégation héritée impossible: {e}");
                    } else if stored.consumer_key_validated {
                        let _ = super::credentials::mark_validated(&account.id);
                    }
                }
                log::info!("compte hérité repris sous l'identifiant {}", account.id);
            }
            if let Err(e) = save(app, &registry) {
                log::error!("enregistrement du registre migré impossible: {e}");
            }
        }
        Ok(None) => {}
        Err(e) => log::warn!("migration du stockage hérité impossible: {e}"),
    }

    registry
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removing_the_active_account_falls_back_to_another() {
        let mut r = Registry::default();
        let first = r.add(Endpoint::OvhEu, "Perso".into());
        let second = r.add(Endpoint::OvhCa, "Pro".into());
        assert_eq!(r.active.as_deref(), Some(second.id.as_str()));

        r.remove(&second.id);
        assert_eq!(r.active.as_deref(), Some(first.id.as_str()));

        r.remove(&first.id);
        assert_eq!(r.active, None);
        assert!(r.accounts.is_empty());
    }

    #[test]
    fn display_name_prefers_label_then_nichandle() {
        let mut r = Registry::default();
        let a = r.add(Endpoint::OvhEu, String::new());
        assert!(r
            .get(&a.id)
            .unwrap()
            .display_name()
            .starts_with("Nouveau compte"));

        r.set_nichandle(&a.id, "ab12345-ovh".into());
        assert_eq!(r.get(&a.id).unwrap().display_name(), "ab12345-ovh");

        r.accounts[0].label = "  Perso  ".into();
        assert_eq!(r.get(&a.id).unwrap().display_name(), "Perso");
    }

    #[test]
    fn duplicates_are_absorbed_by_endpoint_and_nichandle() {
        let mut r = Registry::default();
        let first = r.add(Endpoint::OvhEu, "Perso".into());
        r.set_nichandle(&first.id, "ab12345-ovh".into());
        let second = r.add(Endpoint::OvhEu, String::new());
        r.set_nichandle(&second.id, "ab12345-ovh".into());
        // Même nichandle sur une autre racine : ce n'est PAS le même compte.
        let elsewhere = r.add(Endpoint::OvhCa, String::new());
        r.set_nichandle(&elsewhere.id, "ab12345-ovh".into());

        let absorbed = r.absorb_duplicates(&first.id);
        assert_eq!(absorbed.len(), 1);
        assert_eq!(absorbed[0].id, second.id);
        assert_eq!(r.accounts.len(), 2);
        // L'actif n'était pas concerné : il ne bouge pas.
        assert_eq!(r.active.as_deref(), Some(elsewhere.id.as_str()));
        assert!(r.get(&elsewhere.id).is_some());
    }

    #[test]
    fn absorbing_the_active_account_moves_the_selection_to_the_survivor() {
        let mut r = Registry::default();
        let keep = r.add(Endpoint::OvhEu, String::new());
        r.set_nichandle(&keep.id, "ab12345-ovh".into());
        let dup = r.add(Endpoint::OvhEu, String::new());
        r.set_nichandle(&dup.id, "ab12345-ovh".into());
        // C'est le doublon qui est actif : c'est lui qu'on vient d'autoriser.
        assert_eq!(r.active.as_deref(), Some(dup.id.as_str()));

        r.absorb_duplicates(&keep.id);
        assert_eq!(r.active.as_deref(), Some(keep.id.as_str()));
    }

    #[test]
    fn duplicate_groups_are_found_without_any_network_call() {
        let mut r = Registry::default();
        let a = r.add(Endpoint::OvhEu, String::new());
        r.set_nichandle(&a.id, "ab12345-ovh".into());
        let b = r.add(Endpoint::OvhEu, String::new());
        r.set_nichandle(&b.id, "ab12345-ovh".into());
        let other = r.add(Endpoint::OvhEu, String::new());
        r.set_nichandle(&other.id, "zz99999-ovh".into());
        // Jamais autorisé : indiscernable, donc jamais regroupé.
        r.add(Endpoint::OvhEu, String::new());

        let groups = r.duplicate_groups();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].len(), 2);
        assert_eq!(groups[0][0].id, a.id);
        assert_eq!(groups[0][1].id, b.id);
        assert!(r.get(&other.id).is_some());
    }

    #[test]
    fn a_label_survives_the_account_that_carried_it() {
        let mut r = Registry::default();
        let keep = r.add(Endpoint::OvhEu, String::new());
        r.set_nichandle(&keep.id, "ab12345-ovh".into());
        let dup = r.add(Endpoint::OvhEu, "Facturation".into());
        r.set_nichandle(&dup.id, "ab12345-ovh".into());

        r.absorb_duplicates(&keep.id);
        assert_eq!(r.get(&keep.id).unwrap().label, "Facturation");
    }

    #[test]
    fn without_a_nichandle_nothing_is_absorbed() {
        let mut r = Registry::default();
        let a = r.add(Endpoint::OvhEu, String::new());
        r.add(Endpoint::OvhEu, String::new());
        assert!(r.absorb_duplicates(&a.id).is_empty());
        assert_eq!(r.accounts.len(), 2);
    }

    #[test]
    fn an_unauthorized_slot_is_reusable() {
        let mut r = Registry::default();
        let a = r.add(Endpoint::OvhEu, String::new());
        assert_eq!(
            r.unauthorized_on(Endpoint::OvhEu).map(|x| &x.id),
            Some(&a.id)
        );
        r.set_nichandle(&a.id, "ab12345-ovh".into());
        assert!(r.unauthorized_on(Endpoint::OvhEu).is_none());
        assert!(r.unauthorized_on(Endpoint::OvhCa).is_none());
    }

    #[test]
    fn selecting_an_unknown_account_is_refused() {
        let mut r = Registry::default();
        assert!(r.select("nope").is_err());
    }
}

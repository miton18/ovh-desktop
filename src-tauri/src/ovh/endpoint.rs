//! Endpoints de l'API OVHcloud.
//!
//! Il y en a **sept**, pas trois : les marques Kimsufi et So you Start ont leurs
//! propres racines, avec leurs propres comptes et leurs propres credentials.
//! La liste et les URLs sont celles du SDK officiel `python-ovh`, chacune
//! vérifiée par un appel réel à `/auth/time`.
//!
//! Deux contraintes mesurées, pas supposées :
//!
//! - **Kimsufi et So you Start ne servent que la branche `/1.0`** : `/v1` et
//!   `/v2` y répondent 404. D'où [`Endpoint::default_branch`], qui n'est pas la
//!   même partout.
//! - **Les credentials ne sont pas transférables d'un endpoint à l'autre.** Une
//!   consumer key EU n'a aucun sens sur CA. Le trousseau range donc une entrée
//!   par endpoint, et l'application embarquée dans le binaire — créée sur la
//!   racine EU — ne vaut que pour EU.

use serde::{Deserialize, Serialize};

/// Branche de l'API.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Branch {
    /// `/1.0` — branche historique, seule servie par Kimsufi et So you Start.
    Legacy,
    /// `/v1` — branche courante de la console, schéma identique à `/1.0`.
    #[default]
    V1,
    /// `/v2` — uniquement 18 sections, beaucoup encore en ALPHA.
    V2,
}

impl Branch {
    pub fn segment(self) -> &'static str {
        match self {
            Branch::Legacy => "1.0",
            Branch::V1 => "v1",
            Branch::V2 => "v2",
        }
    }
}

/// Une racine d'API OVHcloud, avec son compte et ses credentials propres.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum Endpoint {
    #[default]
    OvhEu,
    OvhCa,
    OvhUs,
    KimsufiEu,
    KimsufiCa,
    SoyoustartEu,
    SoyoustartCa,
}

impl Endpoint {
    pub const ALL: [Endpoint; 7] = [
        Endpoint::OvhEu,
        Endpoint::OvhCa,
        Endpoint::OvhUs,
        Endpoint::KimsufiEu,
        Endpoint::KimsufiCa,
        Endpoint::SoyoustartEu,
        Endpoint::SoyoustartCa,
    ];

    /// Identifiant stable, celui du SDK officiel. Sert de clé de trousseau et de
    /// valeur persistée : ne jamais le renommer.
    pub fn id(self) -> &'static str {
        match self {
            Endpoint::OvhEu => "ovh-eu",
            Endpoint::OvhCa => "ovh-ca",
            Endpoint::OvhUs => "ovh-us",
            Endpoint::KimsufiEu => "kimsufi-eu",
            Endpoint::KimsufiCa => "kimsufi-ca",
            Endpoint::SoyoustartEu => "soyoustart-eu",
            Endpoint::SoyoustartCa => "soyoustart-ca",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Endpoint::ALL.into_iter().find(|e| e.id() == id)
    }

    /// Libellé destiné à l'interface.
    pub fn label(self) -> &'static str {
        match self {
            Endpoint::OvhEu => "OVHcloud Europe",
            Endpoint::OvhCa => "OVHcloud Canada",
            Endpoint::OvhUs => "OVHcloud US",
            Endpoint::KimsufiEu => "Kimsufi Europe",
            Endpoint::KimsufiCa => "Kimsufi Canada",
            Endpoint::SoyoustartEu => "So you Start Europe",
            Endpoint::SoyoustartCa => "So you Start Canada",
        }
    }

    /// Racine HTTP, sans branche ni barre finale.
    pub fn root(self) -> &'static str {
        match self {
            Endpoint::OvhEu => "https://eu.api.ovh.com",
            Endpoint::OvhCa => "https://ca.api.ovh.com",
            Endpoint::OvhUs => "https://api.us.ovhcloud.com",
            Endpoint::KimsufiEu => "https://eu.api.kimsufi.com",
            Endpoint::KimsufiCa => "https://ca.api.kimsufi.com",
            Endpoint::SoyoustartEu => "https://eu.api.soyoustart.com",
            Endpoint::SoyoustartCa => "https://ca.api.soyoustart.com",
        }
    }

    /// Page où créer une application pour CET endpoint.
    ///
    /// Une application n'est valable que sur la racine où elle a été créée.
    pub fn create_app_url(self) -> String {
        format!("{}/createApp/", self.root())
    }

    /// Branches réellement servies par cet endpoint.
    ///
    /// Kimsufi et So you Start s'arrêtent à `/1.0` — vérifié : `/v1` y renvoie 404.
    pub fn branches(self) -> &'static [Branch] {
        match self {
            Endpoint::OvhEu | Endpoint::OvhCa | Endpoint::OvhUs => {
                &[Branch::V1, Branch::Legacy, Branch::V2]
            }
            Endpoint::KimsufiEu
            | Endpoint::KimsufiCa
            | Endpoint::SoyoustartEu
            | Endpoint::SoyoustartCa => &[Branch::Legacy],
        }
    }

    /// Branche à utiliser par défaut sur cet endpoint.
    pub fn default_branch(self) -> Branch {
        self.branches()[0]
    }

    /// L'application embarquée à la compilation a été créée sur la racine EU :
    /// elle n'est utilisable que là.
    pub fn accepts_embedded_application(self) -> bool {
        matches!(self, Endpoint::OvhEu)
    }
}

/// Construit l'URL absolue d'une route. `path` commence par `/`.
///
/// L'URL renvoyée est celle qui part sur le réseau **et** celle qui entre dans
/// la signature : les deux doivent être identiques au caractère près.
pub fn url_for(endpoint: Endpoint, branch: Branch, path: &str) -> String {
    format!("{}/{}{path}", endpoint.root(), branch.segment())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_round_trip() {
        for e in Endpoint::ALL {
            assert_eq!(Endpoint::from_id(e.id()), Some(e), "{}", e.id());
        }
        assert_eq!(Endpoint::from_id("nope"), None);
    }

    #[test]
    fn kimsufi_and_soyoustart_only_serve_the_legacy_branch() {
        for e in [
            Endpoint::KimsufiEu,
            Endpoint::KimsufiCa,
            Endpoint::SoyoustartEu,
            Endpoint::SoyoustartCa,
        ] {
            assert_eq!(e.branches(), &[Branch::Legacy], "{}", e.id());
            assert_eq!(e.default_branch(), Branch::Legacy);
        }
    }

    #[test]
    fn only_eu_accepts_the_embedded_application() {
        assert!(Endpoint::OvhEu.accepts_embedded_application());
        for e in Endpoint::ALL.into_iter().filter(|e| *e != Endpoint::OvhEu) {
            assert!(!e.accepts_embedded_application(), "{}", e.id());
        }
    }

    #[test]
    fn urls_are_built_without_double_slashes() {
        assert_eq!(
            url_for(Endpoint::OvhEu, Branch::V1, "/domain"),
            "https://eu.api.ovh.com/v1/domain"
        );
        assert_eq!(
            url_for(Endpoint::KimsufiCa, Branch::Legacy, "/me"),
            "https://ca.api.kimsufi.com/1.0/me"
        );
        assert_eq!(
            Endpoint::SoyoustartEu.create_app_url(),
            "https://eu.api.soyoustart.com/createApp/"
        );
    }
}

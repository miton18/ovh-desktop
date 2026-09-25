//! Types transverses : scalaires OVH, métadonnées IAM, informations de service.
//!
//! `iam.*` apparaît dans 65 des 88 sections de l'API et `services.Service` dans
//! 53 : ces types sont ici une fois pour toutes, pas dupliqués par section.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::ovh_enum;

// ---------------------------------------------------------------------------
// Scalaires
// ---------------------------------------------------------------------------

/// `date` — `2026-09-24`.
///
/// Les scalaires temporels et réseau restent des `String`. L'API mélange les
/// formats (`date`, `datetime`, `time`, `duration`) et une date inattendue ne
/// doit pas faire échouer la désérialisation de toute la réponse : la
/// conversion se fait au point d'usage, où l'on sait quoi faire d'un échec.
pub type OvhDate = String;
/// `datetime` — `2026-09-24T17:40:18+02:00`.
pub type OvhDateTime = String;
/// `ip`, `ipv4`, `ipv6` — adresse sans préfixe.
pub type IpAddr = String;
/// `ipBlock`, `ipv4Block`, `ipv6Block` — adresse avec masque CIDR.
pub type IpBlock = String;
/// `uuid`.
pub type Uuid = String;
/// `password` — l'API le marque comme tel : ne jamais logger, ne jamais afficher.
pub type Password = String;
/// `phoneNumber` / `internationalPhoneNumber` — format `+33.612345678`.
pub type PhoneNumber = String;
/// `nichandle.CountryEnum` — ISO 3166-1 alpha-2, plus la valeur `UNKNOWN`.
///
/// 250 valeurs : un enum Rust ne rendrait pas le code plus sûr, seulement plus
/// long. La liste de référence reste celle du schéma.
pub type CountryCode = String;

// ---------------------------------------------------------------------------
// IAM
// ---------------------------------------------------------------------------

ovh_enum! {
    /// `iam.ResourceMetadata.StateEnum`
    IamResourceState {
        Expired => "EXPIRED",
        InCreation => "IN_CREATION",
        Ok => "OK",
        Suspended => "SUSPENDED",
    }
}

/// `iam.ResourceMetadata` — métadonnées IAM embarquées dans les modèles de service.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IamResourceMetadata {
    /// Nom de ressource unique, utilisé dans les politiques IAM.
    pub urn: String,
    pub id: Uuid,
    pub display_name: Option<String>,
    pub state: Option<IamResourceState>,
    /// Les tags calculés en interne sont préfixés par `ovh:`.
    pub tags: Option<HashMap<String, String>>,
}

// ---------------------------------------------------------------------------
// Service (facturation, renouvellement, contacts)
// ---------------------------------------------------------------------------

ovh_enum! {
    /// `service.StateEnum`
    ServiceState {
        AutorenewInProgress => "autorenewInProgress",
        Expired => "expired",
        InCreation => "inCreation",
        Ok => "ok",
        PendingDebt => "pendingDebt",
        UnPaid => "unPaid",
    }
}

ovh_enum! {
    /// `service.RenewalTypeEnum`
    ///
    /// `automaticV2024` n'existe que dans une partie des sections : raison d'être
    /// de la variante `Other`.
    ServiceRenewalType {
        AutomaticForcedProduct => "automaticForcedProduct",
        AutomaticV2012 => "automaticV2012",
        AutomaticV2014 => "automaticV2014",
        AutomaticV2016 => "automaticV2016",
        AutomaticV2024 => "automaticV2024",
        Manual => "manual",
        OneShot => "oneShot",
        Option => "option",
    }
}

/// `service.RenewType` — seul bloc modifiable d'un `Service`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenewType {
    pub automatic: bool,
    pub delete_at_expiration: bool,
    pub forced: bool,
    pub manual_payment: Option<bool>,
    /// Période de renouvellement, en mois.
    pub period: Option<i64>,
}

/// `services.Service` — retourné par tous les `/…/serviceInfos`.
///
/// Attention : `PUT /…/serviceInfos` accepte l'objet entier mais seul `renew`
/// est modifiable ; tout le reste est en lecture seule côté API.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Service {
    pub service_id: i64,
    pub domain: String,
    pub status: ServiceState,
    pub creation: OvhDate,
    pub expiration: OvhDate,
    pub engaged_up_to: Option<OvhDate>,
    pub renewal_type: ServiceRenewalType,
    pub renew: Option<RenewType>,
    /// Périodes de renouvellement possibles, en mois.
    pub possible_renew_period: Option<Vec<i64>>,
    pub can_delete_at_expiration: bool,
    pub contact_admin: String,
    pub contact_billing: String,
    pub contact_tech: String,
}

/// `services.changeContact` — payload de `POST /…/changeContact`.
///
/// Ne permet PAS de changer le propriétaire (registrant) : celui-ci relève d'une
/// procédure de trade séparée chez le registre.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeContact {
    pub contact_admin: String,
    pub contact_billing: String,
    pub contact_tech: String,
}

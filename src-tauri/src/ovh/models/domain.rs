//! Modèles de la section `/domain` : noms de domaine, zones DNS, enregistrements,
//! DynHost, serveurs DNS et contacts WHOIS.
//!
//! Transcrit depuis `https://eu.api.ovh.com/v1/domain.json`.

use serde::{Deserialize, Serialize};

use super::common::{
    CountryCode, IamResourceMetadata, IpAddr, OvhDate, OvhDateTime, Password, PhoneNumber,
};
use super::ovh_enum;

// ===========================================================================
// 1. Le nom de domaine — GET /domain, GET|PUT /domain/{serviceName}
// ===========================================================================

ovh_enum! {
    /// `domain.DomainStateEnum` — état du nom de domaine chez le registre.
    DomainState {
        AutorenewInProgress => "autorenew_in_progress",
        AutorenewRegistryInProgress => "autorenew_registry_in_progress",
        Deleted => "deleted",
        Dispute => "dispute",
        Expired => "expired",
        Ok => "ok",
        OutgoingTransfer => "outgoing_transfer",
        PendingCreate => "pending_create",
        PendingDelete => "pending_delete",
        PendingIncomingTransfer => "pending_incoming_transfer",
        PendingInstallation => "pending_installation",
        RegistrySuspended => "registry_suspended",
        Restorable => "restorable",
        TechnicalSuspended => "technical_suspended",
    }
}

ovh_enum! {
    /// `domain.SuspensionStateEnum`
    SuspensionState {
        NotSuspended => "not_suspended",
        Suspended => "suspended",
    }
}

ovh_enum! {
    /// `domain.RenewalStateEnum` — distinct de `service.RenewalTypeEnum`.
    RenewalState {
        AutomaticRenew => "automatic_renew",
        CancellationComplete => "cancellation_complete",
        CancellationRequested => "cancellation_requested",
        ManualRenew => "manual_renew",
        Unpaid => "unpaid",
    }
}

ovh_enum! {
    /// `domain.LockStatusEnum` — verrou anti-transfert (registrar lock).
    LockStatus {
        Locked => "locked",
        Locking => "locking",
        Unavailable => "unavailable",
        Unlocked => "unlocked",
        Unlocking => "unlocking",
    }
}

ovh_enum! {
    /// `domain.DnssecStateEnum`
    DnssecState {
        Disabled => "disabled",
        Enabled => "enabled",
        NotSupported => "not_supported",
    }
}

ovh_enum! {
    /// `domain.OfferEnum`
    DomainOffer {
        Diamond => "diamond",
        Gold => "gold",
        Platinum => "platinum",
    }
}

ovh_enum! {
    /// `domain.ParentServiceTypeEnum` — le domaine appartient à un pack AllDom.
    ParentServiceType {
        AllDom => "/allDom",
    }
}

/// `domain.ParentService`
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParentService {
    pub name: String,
    pub r#type: ParentServiceType,
}

/// `domain.ContactSummary` — un contact vu depuis le domaine.
///
/// Ne contient que l'identifiant : les données personnelles se lisent et se
/// modifient via `/me/contact/{id}`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactSummary {
    pub id: String,
}

/// `domain.DomainService` — la fiche d'un nom de domaine.
///
/// Sur `PUT /domain/{serviceName}`, seuls `name_server_type` et
/// `transfer_lock_status` sont modifiables.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainService {
    pub domain: String,
    pub service_id: i64,
    pub state: DomainState,
    pub suspension_state: SuspensionState,
    pub renewal_state: RenewalState,
    pub expiration_date: OvhDateTime,
    /// Date de renouvellement attendue — pertinente si le renouvellement est automatique.
    pub renewal_date: OvhDateTime,
    pub last_update: OvhDateTime,
    pub offer: DomainOffer,
    pub parent_service: Option<ParentService>,

    // Contacts (identifiants ; données dans /me/contact)
    pub contact_owner: ContactSummary,
    pub contact_admin: ContactSummary,
    pub contact_billing: ContactSummary,
    pub contact_tech: ContactSummary,
    /// Identifiant du contact propriétaire (registrant).
    pub whois_owner: String,

    // DNS / DNSSEC
    pub name_server_type: NameServerType,
    pub name_servers: Vec<NameServer>,
    pub dnssec_state: DnssecState,
    pub dnssec_supported: bool,

    // Verrou de transfert
    pub transfer_lock_status: LockStatus,

    // Capacités du registre — pilotent ce que l'interface doit proposer ou griser
    pub glue_record_ipv6_supported: bool,
    pub glue_record_multi_ip_supported: bool,
    pub host_supported: bool,
    /// Le registre supporte-t-il l'obfuscation des données WHOIS.
    pub owo_supported: bool,
}

/// `domain.DomainServiceWithIAM` — identique, plus les métadonnées IAM.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainServiceWithIam {
    #[serde(flatten)]
    pub service: DomainService,
    pub iam: Option<IamResourceMetadata>,
}

// ===========================================================================
// 2. La zone DNS — GET /domain/zone, GET /domain/zone/{zoneName}
// ===========================================================================

/// `domain.Zone`
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Zone {
    pub name: String,
    /// Serveurs DNS qui hébergent la zone.
    pub name_servers: Vec<String>,
    pub dnssec_activated: bool,
    pub dnssec_supported: bool,
    pub has_dns_anycast: bool,
    pub last_update: Option<OvhDateTime>,
}

/// `domain.ZoneWithIAM`
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoneWithIam {
    #[serde(flatten)]
    pub zone: Zone,
    pub iam: Option<IamResourceMetadata>,
}

ovh_enum! {
    /// `domain.DnssecStatusEnum` — statut DNSSEC de la ZONE.
    ///
    /// À ne pas confondre avec [`DnssecState`], qui décrit le DNSSEC du domaine
    /// chez le registre : celui-ci a deux états transitoires, pendant lesquels
    /// l'interface doit désactiver l'action au lieu de la proposer à nouveau.
    DnssecStatus {
        Disabled => "disabled",
        Enabled => "enabled",
        EnableInProgress => "enableInProgress",
        DisableInProgress => "disableInProgress",
    }
}

/// `domain.zone.Dnssec` — `GET /domain/zone/{zoneName}/dnssec`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoneDnssec {
    pub status: DnssecStatus,
}

/// `domain.zone.Capabilities` — `GET /domain/zone/{zoneName}/capabilities`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoneCapabilities {
    pub dyn_host: bool,
}

/// `domain.zone.Status` — état de déploiement de la zone.
///
/// La zone se modifie en mémoire puis se déploie : `is_deployed == false`
/// signifie qu'il reste des changements non appliqués (`POST …/refresh`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoneStatus {
    pub is_deployed: bool,
    pub errors: Option<Vec<String>>,
    pub warnings: Option<Vec<String>>,
}

/// `domain.zone.Soa` — enregistrement SOA, entièrement modifiable.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Soa {
    /// Serveur d'autorité primaire.
    pub server: String,
    /// Adresse e-mail de l'administrateur DNS.
    pub email: String,
    pub serial: i64,
    /// Intervalle, en secondes, entre deux vérifications par les serveurs secondaires.
    pub refresh: i64,
    /// Délai avant qu'un secondaire cesse de répondre après échec des transferts.
    pub expire: i64,
    /// TTL des réponses négatives (NXDOMAIN).
    pub nx_domain_ttl: i64,
    pub ttl: i64,
}

/// `domain.zone.Import` — payload de `POST /domain/zone/{zoneName}/import`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoneImport {
    /// Contenu du fichier de zone, au format BIND.
    pub zone_file: String,
}

/// `domain.zone.ZoneRestorePoint` — `GET …/history/{creationDate}`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoneRestorePoint {
    pub creation_date: OvhDateTime,
    pub zone_file_url: String,
}

// ===========================================================================
// 3. Les enregistrements — CRUD sur /domain/zone/{zoneName}/record
// ===========================================================================

ovh_enum! {
    /// `domain.zone.RecordTypeEnum`
    ///
    /// `DKIM`, `DMARC` et `SPF` sont des types de confort OVH : ils produisent
    /// des enregistrements TXT, avec une saisie assistée côté console.
    RecordType {
        A => "A",
        Aaaa => "AAAA",
        Caa => "CAA",
        Cname => "CNAME",
        Dkim => "DKIM",
        Dmarc => "DMARC",
        Dname => "DNAME",
        Https => "HTTPS",
        Loc => "LOC",
        Mx => "MX",
        Naptr => "NAPTR",
        Ns => "NS",
        Ptr => "PTR",
        Rp => "RP",
        Spf => "SPF",
        Srv => "SRV",
        Sshfp => "SSHFP",
        Svcb => "SVCB",
        Tlsa => "TLSA",
        Txt => "TXT",
    }
}

/// `domain.zone.Record` — un enregistrement tel que lu.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub id: i64,
    pub zone: String,
    pub field_type: RecordType,
    /// Vide ou absent pour la racine de la zone.
    pub sub_domain: Option<String>,
    pub target: String,
    pub ttl: Option<i64>,
}

/// `domain.zone.RecordCreate` — `POST /domain/zone/{zoneName}/record`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordCreate {
    pub field_type: RecordType,
    pub target: String,
    pub sub_domain: Option<String>,
    pub ttl: i64,
}

/// `domain.zone.RecordUpdate` — `PUT /domain/zone/{zoneName}/record/{id}`.
///
/// Le type ne se modifie pas : changer un A en CNAME demande une suppression
/// puis une création.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordUpdate {
    pub target: String,
    pub sub_domain: Option<String>,
    pub ttl: Option<i64>,
}

/// Filtres de `GET /domain/zone/{zoneName}/record` (query string).
///
/// `field_type` filtre en `like`, `sub_domain` en `ilike`. La route ne renvoie
/// que des identifiants : la liste affichable demande un GET par enregistrement.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordFilter {
    pub field_type: Option<RecordType>,
    pub sub_domain: Option<String>,
}

// ===========================================================================
// 4. DynHost — /domain/zone/{zoneName}/dynHost
// ===========================================================================

/// `domain.zone.dynHost.Login` — identifiant autorisé à mettre à jour une IP.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynHostLogin {
    /// Login complet, de la forme `<zone>-<suffixe>`.
    pub login: String,
    pub zone: String,
    /// Sous-domaine que ce login peut mettre à jour ; `*` pour toute la zone.
    pub sub_domain: String,
}

/// `domain.zone.dynHost.LoginCreate` — `POST …/dynHost/login`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynHostLoginCreate {
    /// Suffixe concaténé au nom de zone pour former le login.
    pub login_suffix: String,
    pub password: Password,
    /// Sous-domaine autorisé ; `*` pour toute la zone.
    pub sub_domain: String,
}

/// `domain.zone.dynHost.LoginChangePassword` — `POST …/changePassword`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynHostLoginChangePassword {
    pub password: Password,
}

/// `domain.zone.dynHost.Record` — l'enregistrement A piloté par un login DynHost.
///
/// Distinct d'un [`Record`] : il vit dans un espace séparé de l'API et n'est pas
/// listé par `/record`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynHostRecord {
    pub id: i64,
    pub zone: String,
    pub sub_domain: Option<String>,
    pub ip: IpAddr,
    pub ttl: Option<i64>,
}

// ===========================================================================
// 5. Serveurs DNS et glue records — /domain/{serviceName}/nameServer
// ===========================================================================

ovh_enum! {
    /// `domain.nameServer.NameServerTypeEnum` — qui héberge le DNS du domaine.
    NameServerType {
        Anycast => "anycast",
        Dedicated => "dedicated",
        Empty => "empty",
        External => "external",
        Hold => "hold",
        Hosted => "hosted",
        Hosting => "hosting",
        Mixed => "mixed",
        Parking => "parking",
    }
}

ovh_enum! {
    /// `domain.nameServer.NameServerStateEnum`
    NameServerState {
        Ok => "ok",
        Ko => "ko",
    }
}

/// `domain.nameServer.NameServer` — serveur DNS tel qu'exposé dans la fiche domaine.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NameServer {
    pub id: i64,
    pub name_server: String,
    pub name_server_type: NameServerType,
    pub ipv4: Option<IpAddr>,
    pub ipv6: Option<IpAddr>,
}

/// `domain.nameServer.FullNameServer` — `GET …/nameServer/{id}`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FullNameServer {
    pub id: i64,
    pub host: String,
    pub ip: Option<IpAddr>,
    pub is_used: bool,
    pub to_delete: bool,
}

/// `domain.nameServer.NameServerStatus` — `GET …/nameServer/{id}/status`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NameServerStatus {
    pub state: NameServerState,
    pub r#type: NameServerType,
    pub used_since: Option<OvhDateTime>,
}

/// `domain.nameServer.NameServerInput` — un serveur dans un payload d'écriture.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NameServerInput {
    pub host: String,
    /// Requis seulement pour un serveur situé dans la zone qu'il sert (glue).
    pub ip: Option<IpAddr>,
}

/// `domain.nameServer.CreatePayload` — `POST …/nameServer` (ajout).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NameServerCreate {
    pub name_server: Vec<NameServerInput>,
}

/// `domain.nameServer.UpdatePayload` — `POST …/nameServers/update`.
///
/// Remplace l'ensemble des serveurs : la liste envoyée devient la liste complète.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NameServerUpdate {
    pub name_servers: Vec<NameServerInput>,
}

/// `domain.glueRecord.GlueRecord` — serveur DNS déclaré chez le registre.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlueRecord {
    pub host: String,
    pub ips: Vec<IpAddr>,
}

/// `domain.glueRecord.CreatePayload` — `POST …/glueRecord`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlueRecordCreate {
    pub host: String,
    pub ips: Vec<IpAddr>,
}

// ===========================================================================
// 6. Contacts WHOIS — /domain/contact et /me/contact
// ===========================================================================

ovh_enum! {
    /// `nichandle.GenderEnum`
    Gender {
        Female => "female",
        Male => "male",
    }
}

ovh_enum! {
    /// `nichandle.LegalFormEnum`
    LegalForm {
        Administration => "administration",
        Association => "association",
        Corporation => "corporation",
        Individual => "individual",
        Other_ => "other",
        PersonalCorporation => "personalcorporation",
    }
}

ovh_enum! {
    /// `nichandle.LanguageEnum`
    Language {
        CsCz => "cs_CZ", DeDe => "de_DE", EnAu => "en_AU", EnCa => "en_CA",
        EnGb => "en_GB", EnIe => "en_IE", EnUs => "en_US", EsEs => "es_ES",
        FiFi => "fi_FI", FrCa => "fr_CA", FrFr => "fr_FR", FrMa => "fr_MA",
        FrSn => "fr_SN", FrTn => "fr_TN", ItIt => "it_IT", LtLt => "lt_LT",
        NlNl => "nl_NL", PlPl => "pl_PL", PtPt => "pt_PT",
    }
}

/// `domain.ContactAddress`
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactAddress {
    pub line1: Option<String>,
    pub line2: Option<String>,
    pub line3: Option<String>,
    pub zip: Option<String>,
    pub city: Option<String>,
    pub province: Option<String>,
    pub country: Option<CountryCode>,
    pub other_details: Option<String>,
}

/// `domain.Contact` — les données personnelles d'un contact WHOIS.
///
/// Tout est optionnel sauf `id` : les registres exigent des champs différents
/// selon l'extension et la forme juridique. Les champs sont regroupés ci-dessous
/// par usage, parce qu'aucune interface ne doit les présenter à plat.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Contact {
    pub id: i64,

    // --- Identité
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub gender: Option<Gender>,
    pub language: Option<Language>,
    pub email: Option<String>,
    pub phone: Option<PhoneNumber>,
    pub cell_phone: Option<PhoneNumber>,
    pub fax: Option<String>,
    pub website: Option<String>,
    pub address: Option<ContactAddress>,

    // --- Naissance (exigé par certains registres, dont .fr pour un particulier)
    pub birth_day: Option<OvhDate>,
    pub birth_city: Option<String>,
    pub birth_zip: Option<String>,
    pub birth_country: Option<CountryCode>,
    pub nationality: Option<CountryCode>,

    // --- Forme juridique et identifiants d'entreprise
    pub legal_form: Option<LegalForm>,
    /// Catégorie de `legal_form`, imposée par certains registres.
    pub legal_form_category: Option<String>,
    pub organisation_name: Option<String>,
    pub enterprise_id: Option<String>,
    pub vat: Option<String>,
    pub insee: Option<String>,
    pub national_identification_number: Option<String>,
    pub company_national_identification_number: Option<String>,

    // --- Accréditation d'avocat (extensions type .avocat)
    pub accreditation_id: Option<String>,
    pub accreditation_organism: Option<String>,
    pub accreditation_country: Option<CountryCode>,
    pub accreditation_year: Option<i64>,

    // --- Champs imposés par les extensions réservées (.bank, .edu, .gouv…)
    pub organisation_type: Option<String>,
    pub organisation_type_other: Option<String>,
    pub organisation_role: Option<String>,
    pub organisation_role_other: Option<String>,
    pub organisation_funding: Option<String>,
    pub organisation_funding_other: Option<String>,
    pub organisation_staff_status: Option<String>,
    pub organisation_staff_status_other: Option<String>,
    pub organisation_accountable: Option<String>,
    pub role_in_organisation: Option<String>,
    pub registrant_document_type: Option<String>,
    pub registrant_document_type_other: Option<String>,
    pub trademark_id: Option<String>,
}

// ===========================================================================
// 7. Tâches — les écritures DNS et registre sont asynchrones
// ===========================================================================

ovh_enum! {
    /// `domain.OperationStatusEnum` et `domain.TaskStatusEnum` (mêmes valeurs).
    TaskStatus {
        Cancelled => "cancelled",
        Doing => "doing",
        Done => "done",
        Error => "error",
        Problem => "problem",
        Todo => "todo",
    }
}

ovh_enum! {
    /// `domain.OperationTypeEnum`
    TaskType {
        AllDom => "alldom",
        Domain => "domain",
    }
}

ovh_enum! {
    /// `domain.TaskFunctionEnum` — opérations asynchrones sur une zone DNS.
    ZoneTaskFunction {
        DnsAnycastActivate => "DnsAnycastActivate",
        DnsAnycastDeactivate => "DnsAnycastDeactivate",
        DnssecDisable => "DnssecDisable",
        DnssecEnable => "DnssecEnable",
        DnssecResigning => "DnssecResigning",
        DnssecRollKsk => "DnssecRollKsk",
        DnssecRollZsk => "DnssecRollZsk",
        ZoneCheck => "ZoneCheck",
        ZoneCreate => "ZoneCreate",
        ZoneCut => "ZoneCut",
        ZoneDelete => "ZoneDelete",
        ZoneImport => "ZoneImport",
        ZoneRefresh => "ZoneRefresh",
        ZoneRestore => "ZoneRestore",
    }
}

/// `domain.Task` — opération sur le nom de domaine (registre).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainTask {
    pub id: i64,
    pub function: String,
    pub status: TaskStatus,
    pub r#type: TaskType,
    pub domain: Option<String>,
    pub comment: Option<String>,
    pub creation_date: OvhDateTime,
    pub last_update: OvhDateTime,
    pub todo_date: OvhDateTime,
    pub done_date: Option<OvhDateTime>,
    pub can_accelerate: bool,
    pub can_cancel: bool,
    pub can_relaunch: bool,
}

/// `domain.zone.Task` — opération sur la zone DNS.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoneTask {
    pub id: i64,
    pub function: ZoneTaskFunction,
    pub status: TaskStatus,
    pub comment: Option<String>,
    pub creation_date: OvhDateTime,
    pub last_update: Option<OvhDateTime>,
    pub todo_date: OvhDateTime,
    pub done_date: Option<OvhDateTime>,
    pub can_accelerate: bool,
    pub can_cancel: bool,
    pub can_relaunch: bool,
}

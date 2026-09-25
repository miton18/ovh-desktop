//! Modèles de la section `/hosting/web` : hébergement web mutualisé.
//!
//! Transcrit depuis `https://eu.api.ovh.com/v1/hosting/web.json`.
//!
//! On construit sur la branche **v1** et pas sur `/webhosting` en v2 : celle-ci
//! n'expose que 15 opérations, dont 3 en production, et ignore entièrement les
//! bases de données, les utilisateurs, les crons, les runtimes et les variables
//! d'environnement. Son modèle est meilleur, sa couverture est inutilisable.

use serde::{Deserialize, Serialize};

use super::common::{IpAddr, OvhDateTime};
use super::ovh_enum;

/// `complexType.UnitAndValue<double>` — une valeur **et son unité**.
///
/// Les quotas n'en sont jamais des nombres nus, et l'unité n'est pas la même
/// partout : calculer un pourcentage sans la regarder donne une jauge fausse.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitAndValue {
    pub unit: String,
    pub value: f64,
}

// ===========================================================================
// L'hébergement
// ===========================================================================

ovh_enum! {
    /// `hosting.web.StateEnum`
    ///
    /// Les graphies `bloqued` et `hardBloqued` sont dans l'API, à côté de
    /// `blocked` et `hardBlocked` : ce n'est pas une faute de transcription, il
    /// faut traiter les deux.
    HostingState {
        Active => "active",
        Maintenance => "maintenance",
        Blocked => "blocked",
        Bloqued => "bloqued",
        HardBlocked => "hardBlocked",
        HardBloqued => "hardBloqued",
    }
}

ovh_enum! {
    /// `hosting.web.PhpVersionStateEnum`
    PhpVersionState {
        Beta => "beta",
        Deprecated => "deprecated",
        Security => "security",
        Stable => "stable",
        Testing => "testing",
        EndOfLife => "end-of-life",
    }
}

ovh_enum! {
    /// `hosting.web.ResourceEnum`
    HostingResource {
        Shared => "shared",
        Cloud => "cloud",
        Dedicated => "dedicated",
        BestEffort => "bestEffort",
    }
}

/// `hosting.web.PhpVersion` — une version disponible, et l'avis de l'API dessus.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhpVersion {
    pub version: String,
    pub support: PhpVersionState,
}

/// `hosting.web.Address`
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Address {
    pub url: Option<String>,
    pub port: Option<i64>,
}

/// `hosting.web.ServiceAccess` — où se connecter.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceAccess {
    pub ftp: Address,
    pub http: Address,
    pub ssh: Address,
}

/// `hosting.web.CountriesIp` — l'IP servie selon le pays choisi.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CountryIp {
    pub country: String,
    pub ip: Option<IpAddr>,
    pub ipv6: Option<IpAddr>,
}

/// `hosting.web.Service` — la fiche de l'hébergement.
///
/// `display_name` prime sur `offer` pour titrer : `offer` compte 88 valeurs dont
/// des codes historiques (`start1m`, `deproxxl2012`, `hostingAtScaleX128`) qu'on
/// ne peut ni traduire ni tabuler.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostingService {
    pub service_name: String,
    pub display_name: Option<String>,
    pub offer: String,
    pub state: HostingState,
    pub resource_type: HostingResource,
    pub primary_login: String,
    pub home: String,
    pub default_attached_domain: Option<String>,

    // Quotas — jamais des nombres nus.
    pub quota_size: UnitAndValue,
    pub quota_used: Option<UnitAndValue>,
    pub traffic_quota_size: Option<UnitAndValue>,
    pub traffic_quota_used: Option<UnitAndValue>,

    // Infrastructure
    pub cluster: String,
    pub datacenter: String,
    pub filer: Option<String>,
    pub hosting_ip: Option<IpAddr>,
    pub hosting_ipv6: Option<IpAddr>,
    pub cluster_ip: Option<IpAddr>,
    pub cluster_ipv6: Option<IpAddr>,
    pub countries_ip: Option<Vec<CountryIp>>,
    pub operating_system: String,
    pub php_versions: Vec<PhpVersion>,
    pub last_ovh_config_scan: Option<OvhDateTime>,

    // Capacités : décident de ce que l'interface a le droit de proposer.
    pub has_cdn: Option<bool>,
    pub has_hosted_ssl: Option<bool>,
    #[serde(rename = "multipleSSL")]
    pub multiple_ssl: bool,
    pub boost_offer: Option<String>,
    pub recommended_offer: Option<String>,
    pub service_management_access: ServiceAccess,
    pub updates: Vec<String>,
    pub token: Option<String>,
}

// ===========================================================================
// Capacités de l'offre
// ===========================================================================

/// `hosting.web.DiskType`
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskType {
    pub r#type: String,
    pub unit: String,
    pub value: f64,
}

/// `hosting.web.CronLanguageAvailable`
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronLanguages {
    pub php: Vec<String>,
    pub nodejs: Vec<String>,
    pub python: Vec<String>,
    pub ruby: Vec<String>,
}

/// `hosting.web.database.CreationDatabaseCapabilities`
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseCreationCapability {
    pub available: i64,
    pub engines: Vec<String>,
    pub isolation: String,
    pub quota: UnitAndValue,
    pub r#type: String,
}

/// `hosting.web.CreationEmailCapabilities`
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailCreationCapability {
    pub available: i64,
    pub quota: UnitAndValue,
}

/// `hosting.web.Capabilities` — ce que l'offre autorise, avant d'essayer.
///
/// C'est la réponse à « pourquoi l'API refuse-t-elle ceci ? » **avant** qu'elle
/// refuse : l'offre `domainpack`, celle fournie avec un nom de domaine, annonce
/// `env_vars: 0`, `runtimes: 0`, `extra_users: 0`, `crontab: false`,
/// `ssh: false`. Seules les offres Cloud Web autorisent les variables
/// d'environnement et les runtimes — vérifié sur l'API.
///
/// Les compteurs valent `0` pour « interdit », et un très grand nombre
/// (1 000 000) pour « sans limite pratique ». `-1` signifie illimité sur
/// `sites_recommended`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostingCapabilities {
    pub attached_domains: i64,
    pub extra_users: i64,
    pub env_vars: i64,
    pub runtimes: i64,
    pub database_engines: i64,
    pub sites_recommended: Option<i64>,

    pub crontab: bool,
    pub ssh: bool,
    pub files_browser: bool,
    pub module_one_click: bool,

    pub disk: Option<DiskType>,
    pub traffic: Option<UnitAndValue>,
    pub languages: Option<CronLanguages>,
    pub databases: Option<Vec<DatabaseCreationCapability>>,
    pub private_databases: Option<Vec<DatabaseCreationCapability>>,
    pub emails: Option<EmailCreationCapability>,
    pub highlight: Option<String>,
}

impl HostingCapabilities {
    /// Un compteur à zéro veut dire « cette offre ne le permet pas ».
    pub fn allows(count: i64) -> bool {
        count > 0
    }
}

// ===========================================================================
// Multisites
// ===========================================================================

ovh_enum! {
    /// `hosting.web.attachedDomain.FirewallEnum` et `CdnEnum` — mêmes valeurs.
    AttachedDomainToggle {
        Active => "active",
        None_ => "none",
    }
}

/// Une action réellement disponible sur un multisite.
///
/// `hosting.web.attachedDomain.Capabilities` — l'API liste, pour **chaque**
/// multisite, les actions qu'elle accepte. C'est la réponse à « pourquoi ce
/// bouton répond 400 » avant qu'il réponde : sur une offre d'entrée de gamme,
/// l'entrée `DELETE` est simplement absente, et l'API refuse la suppression avec
/// `can't delete domain of start hosting`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachedDomainCapability {
    pub key: String,
    /// `GET`, `POST`, `PUT` ou `DELETE`.
    pub method: String,
    pub href: String,
    pub description: String,
}

ovh_enum! {
    /// `hosting.web.attachedDomain.StatusEnum`
    AttachedDomainStatus {
        Created => "created",
        Creating => "creating",
        Deleting => "deleting",
        Updating => "updating",
    }
}

/// `hosting.web.attachedDomain.PublicAttachedDomain` — le multisite **tel qu'il
/// est lu**.
///
/// À ne pas confondre avec [`AttachedDomain`], qui est le payload d'écriture :
/// celui-ci porte en plus `capabilities`, `status`, `task_id`, `is_flushable` et
/// `vcs_status`, et ses champs obligatoires ne sont pas nullables.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachedDomainDetail {
    pub domain: String,
    pub path: String,
    pub ssl: Option<bool>,
    pub runtime_id: Option<i64>,
    pub firewall: AttachedDomainToggle,
    pub cdn: AttachedDomainToggle,
    pub own_log: Option<String>,
    pub ip_location: Option<String>,
    pub status: AttachedDomainStatus,
    pub is_flushable: bool,
    pub task_id: Option<i64>,
    #[serde(default)]
    pub vcs_status: Option<String>,
    /// Les actions que l'API accepte sur ce multisite, et elles seules.
    #[serde(default)]
    pub capabilities: Vec<AttachedDomainCapability>,
}

impl AttachedDomainDetail {
    /// La méthode figure-t-elle dans les capacités annoncées.
    pub fn allows(&self, method: &str) -> bool {
        self.capabilities
            .iter()
            .any(|c| c.method.eq_ignore_ascii_case(method))
    }

    /// `false` sur les offres qui interdisent de détacher un domaine.
    pub fn can_delete(&self) -> bool {
        self.allows("DELETE")
    }
}

/// `hosting.web.AttachedDomain` — le payload d'**écriture**.
///
/// Tous les champs sont modifiables **et** nullables, `domain` et `path`
/// compris : l'API ne porte aucune obligation, c'est au formulaire de les poser.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachedDomain {
    pub domain: Option<String>,
    pub path: Option<String>,
    pub ssl: Option<bool>,
    pub runtime_id: Option<i64>,
    pub firewall: Option<AttachedDomainToggle>,
    pub cdn: Option<AttachedDomainToggle>,
    pub own_log: Option<String>,
    /// 14 pays. Change l'IP servie pour ce domaine.
    pub ip_location: Option<String>,
    /// À `false` — le défaut — **l'API modifie la zone DNS du domaine**.
    #[serde(rename = "bypassDNSConfiguration")]
    pub bypass_dns_configuration: Option<bool>,
}

// ===========================================================================
// Utilisateurs FTP / SSH
// ===========================================================================

ovh_enum! {
    /// `hosting.web.user.StateEnum` — le compte est-il ouvert.
    UserState {
        Rw => "rw",
        Off => "off",
    }
}

ovh_enum! {
    /// `hosting.web.user.SshStateEnum` — notion distincte de [`UserState`].
    UserSshState {
        Active => "active",
        SftpOnly => "sftponly",
        None_ => "none",
    }
}

/// `hosting.web.user.Credentials`
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserCredentials {
    pub url: Option<String>,
    pub port: Option<i64>,
}

/// `hosting.web.user.ServiceCredentials`
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserServiceCredentials {
    pub ftp: UserCredentials,
    pub ssh: UserCredentials,
}

/// `hosting.web.user` — le mot de passe n'y figure pas : il n'est jamais relisible.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostingUser {
    pub login: String,
    pub home: String,
    pub state: UserState,
    pub ssh_state: UserSshState,
    pub is_primary_account: bool,
    pub service_management_credentials: UserServiceCredentials,
}

/// Payload de `POST …/user`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostingUserCreate {
    /// Suffixe concaténé au login principal, comme pour DynHost.
    pub login: String,
    pub password: String,
    pub home: String,
    pub ssh_state: UserSshState,
    pub state: UserState,
}

// ===========================================================================
// Bases de données
// ===========================================================================

ovh_enum! {
    /// `hosting.web.database.StateEnum` — santé de la base.
    DatabaseState {
        Ok => "ok",
        ReadOnly => "readonly",
        Close => "close",
    }
}

ovh_enum! {
    /// `hosting.web.database.StatusEnum` — opération en cours, distincte de l'état.
    DatabaseStatus {
        Created => "created",
        Creating => "creating",
        Deleting => "deleting",
        Checking => "checking",
        Dumping => "dumping",
        Importing => "importing",
        Optimizing => "optimizing",
        Restoring => "restoring",
        Updating => "updating",
        Locked => "locked",
    }
}

ovh_enum! {
    /// `hosting.web.database.SupportedVersionEnum` — l'avis de l'API sur la version.
    DatabaseVersionSupport {
        Stable => "stable",
        Beta => "beta",
        Deprecated => "deprecated",
    }
}

ovh_enum! {
    /// `hosting.web.database.DatabaseTypeEnum`
    DatabaseEngine {
        MySql => "mysql",
        MariaDb => "mariadb",
        PostgreSql => "postgresql",
        MongoDb => "mongodb",
        Redis => "redis",
    }
}

/// `hosting.web.database`
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Database {
    pub name: String,
    pub r#type: DatabaseEngine,
    pub version: String,
    /// `deprecated` mérite un avertissement visible, pas une colonne de tableau.
    pub version_support: DatabaseVersionSupport,
    pub database_service_deprecated: bool,
    pub state: DatabaseState,
    pub status: DatabaseStatus,
    pub quota_size: UnitAndValue,
    pub quota_used: UnitAndValue,
    pub server: Option<String>,
    pub port: i64,
    pub user: String,
    #[serde(rename = "guiURL")]
    pub gui_url: Option<String>,
    pub dumps: i64,
    pub mode: String,
    pub database_type: Option<String>,
    pub sqlperso_id: Option<i64>,
    pub last_check: Option<OvhDateTime>,
    pub task_id: Option<i64>,
}

ovh_enum! {
    /// `hosting.web.database.dump.DateEnum`
    DumpKind {
        Now => "now",
        Daily => "daily.1",
        Weekly => "weekly.1",
    }
}

ovh_enum! {
    /// `hosting.web.database.dump.StatusEnum`
    DumpStatus {
        Created => "created",
        Creating => "creating",
        Deleting => "deleting",
    }
}

/// `hosting.web.database.dump`
///
/// `deletion_date` est une **date de péremption automatique** : elle doit se voir.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseDump {
    pub id: i64,
    pub r#type: DumpKind,
    pub status: DumpStatus,
    pub creation_date: OvhDateTime,
    pub deletion_date: OvhDateTime,
    pub url: Option<String>,
    pub task_id: Option<i64>,
}

// ===========================================================================
// Ce qui s'exécute
// ===========================================================================

ovh_enum! {
    /// `hosting.web.cron.StatusEnum`
    CronStatus {
        Enabled => "enabled",
        Disabled => "disabled",
        Suspended => "suspended",
    }
}

ovh_enum! {
    /// `hosting.web.cron.StateEnum` — opération en cours sur le cron.
    CronState {
        Created => "created",
        Creating => "creating",
        Deleting => "deleting",
        Updating => "updating",
    }
}

/// `hosting.web.Cron`
///
/// `frequency` est une chaîne crontab brute : l'API ne la valide pas pour nous.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cron {
    pub id: i64,
    pub command: String,
    pub frequency: String,
    /// 27 valeurs, avec sa propre orthographe des versions (`php8.0`).
    pub language: String,
    pub description: Option<String>,
    /// Destinataire de `stderr`.
    pub email: Option<String>,
    pub status: CronStatus,
    pub state: CronState,
}

/// Payload de création et de modification d'un cron.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronInput {
    pub command: String,
    pub frequency: String,
    pub language: String,
    pub description: Option<String>,
    pub email: Option<String>,
    pub status: CronStatus,
}

ovh_enum! {
    /// `hosting.web.envVar.TypeEnum`
    EnvVarType {
        String_ => "string",
        Integer => "integer",
        Password => "password",
    }
}

ovh_enum! {
    /// `hosting.web.envVar.StatusEnum`
    EnvVarStatus {
        Created => "created",
        Creating => "creating",
        Deleting => "deleting",
        Updating => "updating",
    }
}

/// `hosting.web.EnvVar`
///
/// `value` est typée `password` par l'API **quel que soit** `type` : elle ne
/// s'affiche jamais en clair.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvVar {
    pub key: String,
    pub value: String,
    pub r#type: EnvVarType,
    pub status: EnvVarStatus,
    pub task_id: Option<i64>,
}

ovh_enum! {
    /// `hosting.web.runtime.TypeEnum` — encore une orthographe des versions.
    RuntimeType {
        PhpFpm80 => "phpfpm-8.0",
        PhpFpm74 => "phpfpm-7.4",
        PhpFpm73 => "phpfpm-7.3",
        PhpFpm72 => "phpfpm-7.2",
        PhpFpm71 => "phpfpm-7.1",
        PhpFpm70 => "phpfpm-7.0",
        PhpFpm56 => "phpfpm-5.6",
        NodeJs14 => "nodejs-14",
        NodeJs12 => "nodejs-12",
        NodeJs10 => "nodejs-10",
        Python3 => "python-3",
        Python2 => "python-2",
        Ruby26 => "ruby-2.6",
    }
}

ovh_enum! {
    /// `hosting.web.runtime.EnvEnum`
    RuntimeEnv {
        Production => "production",
        Development => "development",
    }
}

ovh_enum! {
    /// `hosting.web.runtime.StateEnum`
    RuntimeState {
        Created => "created",
        Creating => "creating",
        Deleting => "deleting",
        Updating => "updating",
    }
}

/// `hosting.web.runtime` — référencé par `AttachedDomain.runtime_id`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Runtime {
    pub id: i64,
    pub name: Option<String>,
    pub r#type: RuntimeType,
    pub app_env: RuntimeEnv,
    pub public_dir: Option<String>,
    pub app_bootstrap: Option<String>,
    pub is_default: bool,
    pub is_deletable: bool,
    pub status: RuntimeState,
    pub creation_date: OvhDateTime,
    pub last_update: OvhDateTime,
    pub task_id: Option<i64>,
}

// ===========================================================================
// Certificat et tâches
// ===========================================================================

ovh_enum! {
    /// `hosting.web.hostedssl.StatusEnum`
    SslStatus {
        Created => "created",
        Creating => "creating",
        Deleting => "deleting",
        Importing => "importing",
        Regenerating => "regenerating",
    }
}

/// `hosting.web.SSL`
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostingSsl {
    pub provider: String,
    pub r#type: String,
    pub status: SslStatus,
    pub regenerable: bool,
    pub is_reportable: bool,
    pub task_id: Option<i64>,
}

ovh_enum! {
    /// `hosting.web.task.StatusEnum`
    HostingTaskStatus {
        Init => "init",
        Todo => "todo",
        Doing => "doing",
        Done => "done",
        Cancelled => "cancelled",
    }
}

/// `hosting.web.task` — et `hosting.web.PublicTask`, qui a exactement la même
/// structure sous un autre nom. Un seul type suffit.
///
/// Pas de `canAccelerate` ni `canCancel`, contrairement aux tâches de domaine :
/// **une tâche d'hébergement ne s'annule pas**, donc aucun bouton dessus.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostingTask {
    pub id: i64,
    /// Près de 190 valeurs, de la forme `objet/action` — à grouper par préfixe.
    pub function: String,
    pub status: HostingTaskStatus,
    pub object_type: Option<String>,
    pub object_id: Option<String>,
    pub start_date: OvhDateTime,
    pub last_update: Option<OvhDateTime>,
    pub done_date: Option<OvhDateTime>,
}

impl HostingTask {
    /// `true` quand la tâche n'évoluera plus.
    pub fn is_terminal(&self) -> bool {
        matches!(
            self.status,
            HostingTaskStatus::Done | HostingTaskStatus::Cancelled
        )
    }
}

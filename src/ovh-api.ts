/**
 * Contrat front↔back du client OVHcloud.
 *
 * Ce fichier est le seul endroit où le frontend connaît les noms des commandes
 * Tauri. Les types reflètent `src-tauri/src/ovh/models/` au champ près : ils
 * sont sérialisés en `camelCase`, et `Option<T>` côté Rust devient `T | null`.
 *
 * Les enums OVH sont typés `string` volontairement, pas en unions fermées : le
 * backend conserve les valeurs inconnues (variante `Other`) parce que l'API en
 * ajoute sans préavis. Les valeurs connues sont listées dans les constantes
 * `KNOWN_*` ci-dessous, à utiliser pour les menus et les libellés — jamais pour
 * rejeter une valeur reçue.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// ───────────────────────────────────────────────────────────── erreurs

/** Toute erreur remontée par ces commandes a cette forme. */
export type OvhErrorPayload = {
  kind:
    | "noApplication"
    | "notConfigured"
    | "pendingValidation"
    | "credentialUnusable"
    | "unauthorized"
    | "forbidden"
    | "notFound"
    | "api"
    | "keyring"
    | "network"
    | "decode";
  message: string;
};

export function isOvhError(e: unknown): e is OvhErrorPayload {
  return typeof e === "object" && e !== null && "kind" in e && "message" in e;
}

/**
 * Actions du menu applicatif relayées par le backend (`menu.rs`).
 *
 * Le menu existe déjà côté Rust : c'est par là que passent les réglages, ce qui
 * évite d'ajouter à l'écran de connexion des commandes que la maquette n'a pas.
 * Identifiant émis aujourd'hui : `settings` (Fichier → Préférences…).
 */
export function onMenuAction(cb: (action: string) => void): Promise<UnlistenFn> {
  return listen<string>("menu-action", (e) => cb(e.payload));
}

// ───────────────────────────────────────────────────── authentification

export type ApplicationSource = "embedded" | "userSupplied" | "missing";

/**
 * Une racine d'API OVHcloud. Il y en a **sept**, pas trois.
 *
 * Deux conséquences que l'interface doit rendre visibles :
 * - `branches` ne contient que `["1.0"]` pour Kimsufi et So you Start, qui ne
 *   servent pas les branches `/v1` et `/v2` ;
 * - `acceptsEmbeddedApplication` est faux partout sauf sur la racine EU : ailleurs,
 *   l'utilisateur doit fournir sa propre application.
 */
export type EndpointInfo = {
  id: string;
  label: string;
  root: string;
  branches: string[];
  acceptsEmbeddedApplication: boolean;
  createAppUrl: string;
};

export type OvhStatus = {
  application: ApplicationSource;
  hasConsumerKey: boolean;
  account: string | null;
  /** `true` quand il n'y a plus rien à faire : l'API est appelable. */
  ready: boolean;
  branch: string;
  endpoint: EndpointInfo;
  activeAccountId: string | null;
};

export type CredentialState = "expired" | "pendingValidation" | "refused" | "validated";

export type AccessRule = { method: string; path: string };

export type CredentialRequest = {
  consumerKey: string;
  state: CredentialState;
  /** Page à ouvrir pour que l'utilisateur accorde l'accès. */
  validationUrl: string;
};

export type AuthDetails = {
  /** Identifiant client OVH, du type `ab12345-ovh`. */
  account: string;
  method: string;
  user: string | null;
  description: string | null;
  identities: string[];
  roles: string[] | null;
  /** `null` signifie « toutes les routes ». */
  allowedRoutes: AccessRule[] | null;
};

/**
 * État lisible sans réseau : uniquement le trousseau.
 *
 * Sert à choisir l'écran d'entrée sans faire attendre l'utilisateur. Une
 * délégation enregistrée ne prouve pas qu'elle est valide : seul `status()`,
 * qui interroge l'API, peut le dire.
 */
export type LocalState = {
  application: ApplicationSource;
  /** Compte actif, ou `null` quand aucun compte n'est enregistré. */
  activeAccountId: string | null;
  accountCount: number;
  /** Une délégation **validée** est enregistrée : l'API est appelable. */
  hasConsumerKey: boolean;
  /**
   * Une délégation existe mais attend encore la validation de l'utilisateur
   * dans son navigateur. L'API la refuse (403) : proposer de la reprendre, pas
   * de tout recommencer, et surtout ne pas la prendre pour une connexion.
   */
  pendingConsumerKey: boolean;
  branch: string;
  endpoint: EndpointInfo;
};

export const auth = {
  status: () => invoke<OvhStatus>("ovh_status"),
  statusLocal: () => invoke<LocalState>("ovh_status_local"),
  /** Demande la délégation et ouvre la page de validation OVH. */
  authorize: (openBrowser = true) =>
    invoke<CredentialRequest>("ovh_authorize", { openBrowser }),
  /** À appeler après que l'utilisateur a validé la page. */
  confirm: () => invoke<AuthDetails>("ovh_confirm_authorization"),
  credentialState: () => invoke<CredentialState>("ovh_credential_state"),
  logout: () => invoke<void>("ovh_logout"),
  /** Surcharge l'application embarquée. Invalide la délégation en cours. */
  setApplication: (applicationKey: string, applicationSecret: string) =>
    invoke<void>("ovh_set_application", { applicationKey, applicationSecret }),
  resetApplication: () => invoke<void>("ovh_reset_application"),
  /** Page de création d'application, pour l'endpoint courant. */
  createAppUrl: () => invoke<string>("ovh_create_app_url"),
  endpoints: () => invoke<EndpointInfo[]>("ovh_endpoints"),
};

// ───────────────────────────────────────────────────────────── comptes

/**
 * Un compte = **un endpoint et une délégation**.
 *
 * Un client OVHcloud a souvent plusieurs NIC, et un NIC européen n'existe pas
 * sur la racine canadienne : les deux notions sont liées, pas empilées. Changer
 * de compte change donc aussi la racine appelée.
 */
export type AccountInfo = {
  id: string;
  /** Nom donné par l'utilisateur. Vide tant qu'il n'en a pas choisi un. */
  label: string;
  /** Ce qu'il faut afficher : le libellé, sinon le nichandle, sinon un défaut. */
  displayName: string;
  nichandle: string | null;
  endpoint: EndpointInfo;
  active: boolean;
  /** Délégation validée : ce compte est utilisable tel quel. */
  ready: boolean;
  /** Délégation en attente de validation dans le navigateur. */
  pending: boolean;
};

export const accounts = {
  list: () => invoke<AccountInfo[]>("accounts_list"),
  /** Crée un compte sur cet endpoint et le rend actif. Reste à l'autoriser. */
  add: (endpointId: string, label?: string) =>
    invoke<AccountInfo>("accounts_add", { endpointId, label: label ?? null }),
  /** Bascule vers ce compte, et donc vers sa racine. */
  select: (id: string) => invoke<AccountInfo>("accounts_select", { id }),
  /** Révoque la délégation puis oublie le compte. Rend la liste restante. */
  remove: (id: string) => invoke<AccountInfo[]>("accounts_remove", { id }),
  /** Un libellé vide fait retomber sur le nichandle. */
  rename: (id: string, label: string) =>
    invoke<AccountInfo>("accounts_rename", { id, label }),
};

/**
 * Le compte actif a changé depuis le menu applicatif — l'interface doit se
 * recharger, les données affichées appartiennent à un autre compte.
 */
export function onAccountChanged(cb: (accountId: string) => void): Promise<UnlistenFn> {
  return listen<string>("account-changed", (e) => cb(e.payload));
}

// ────────────────────────────────────────────────── types transverses

/** `date` — `2026-09-25`. */
export type OvhDate = string;
/** `datetime` — `2026-09-25T17:40:18+02:00`. */
export type OvhDateTime = string;

export type IamResourceMetadata = {
  urn: string;
  id: string;
  displayName: string | null;
  state: string | null;
  tags: Record<string, string> | null;
};

export type RenewType = {
  automatic: boolean;
  deleteAtExpiration: boolean;
  forced: boolean;
  manualPayment: boolean | null;
  /** Période de renouvellement, en mois. */
  period: number | null;
};

export type Service = {
  serviceId: number;
  domain: string;
  status: string;
  creation: OvhDate;
  expiration: OvhDate;
  engagedUpTo: OvhDate | null;
  renewalType: string;
  /** Seul bloc modifiable de l'objet. */
  renew: RenewType | null;
  possibleRenewPeriod: number[] | null;
  canDeleteAtExpiration: boolean;
  contactAdmin: string;
  contactBilling: string;
  contactTech: string;
};

/** Ne change PAS le propriétaire : procédure de trade chez le registre. */
export type ChangeContact = {
  contactAdmin: string;
  contactBilling: string;
  contactTech: string;
};

// ─────────────────────────────────────────────────────────── domaines

export type ContactSummary = { id: string };

export type ParentService = { name: string; type: string };

export type NameServer = {
  id: number;
  nameServer: string;
  nameServerType: string;
  ipv4: string | null;
  ipv6: string | null;
};

export type DomainService = {
  domain: string;
  serviceId: number;
  state: string;
  suspensionState: string;
  renewalState: string;
  expirationDate: OvhDateTime;
  renewalDate: OvhDateTime;
  lastUpdate: OvhDateTime;
  offer: string;
  parentService: ParentService | null;

  contactOwner: ContactSummary;
  contactAdmin: ContactSummary;
  contactBilling: ContactSummary;
  contactTech: ContactSummary;
  whoisOwner: string;

  nameServerType: string;
  nameServers: NameServer[];
  dnssecState: string;
  dnssecSupported: boolean;
  transferLockStatus: string;

  /** Capacités du registre : pilotent ce que l'interface propose ou grise. */
  glueRecordIpv6Supported: boolean;
  glueRecordMultiIpSupported: boolean;
  hostSupported: boolean;
  owoSupported: boolean;
};

export type DomainServiceWithIam = DomainService & {
  iam: IamResourceMetadata | null;
};

// ─────────────────────────────────────────────────────── zone DNS

export type Zone = {
  name: string;
  nameServers: string[];
  dnssecActivated: boolean;
  dnssecSupported: boolean;
  hasDnsAnycast: boolean;
  lastUpdate: OvhDateTime | null;
};

export type ZoneWithIam = Zone & { iam: IamResourceMetadata | null };

export type ZoneCapabilities = { dynHost: boolean };

/**
 * `isDeployed === false` : des modifications attendent une publication
 * (`domain.zoneRefresh`). C'est l'objet qui pilote l'état « brouillon ».
 */
export type ZoneStatus = {
  isDeployed: boolean;
  errors: string[] | null;
  warnings: string[] | null;
};

/**
 * Statut DNSSEC de la ZONE — quatre valeurs, dont deux transitoires.
 *
 * Distinct de `DomainService.dnssecState`, qui décrit le DNSSEC du domaine chez
 * le registre. Pendant `enableInProgress` / `disableInProgress`, l'action doit
 * être désactivée, pas reproposée.
 */
export type ZoneDnssec = {
  status: string;
};

export const KNOWN_DNSSEC_STATUSES = [
  "disabled", "enabled", "enableInProgress", "disableInProgress",
] as const;

/** `true` pendant qu'une bascule DNSSEC est en cours côté registre. */
export function isDnssecTransitioning(status: string): boolean {
  return status === "enableInProgress" || status === "disableInProgress";
}

/** Sept champs, tous modifiables. Les durées sont en secondes. */
export type Soa = {
  server: string;
  email: string;
  serial: number;
  refresh: number;
  expire: number;
  nxDomainTtl: number;
  ttl: number;
};

// ──────────────────────────────────────────────── enregistrements

export type Record_ = {
  id: number;
  zone: string;
  fieldType: string;
  /** Vide ou `null` pour la racine de la zone. */
  subDomain: string | null;
  target: string;
  ttl: number | null;
};

export type RecordCreate = {
  fieldType: string;
  target: string;
  subDomain: string | null;
  ttl: number;
};

/** Pas de `fieldType` : le type d'un enregistrement ne se modifie pas. */
export type RecordUpdate = {
  target: string;
  subDomain: string | null;
  ttl: number | null;
};

/** Filtres appliqués par le serveur : ils réduisent le nombre d'appels. */
export type RecordFilter = {
  fieldType?: string | null;
  subDomain?: string | null;
};

// ────────────────────────────────────────────────────────── DynHost

export type DynHostLogin = {
  /** Login complet, de la forme `<zone>-<suffixe>`. */
  login: string;
  zone: string;
  /** Sous-domaine autorisé ; `*` pour toute la zone. */
  subDomain: string;
};

export type DynHostLoginCreate = {
  /** Suffixe concaténé au nom de zone pour former le login. */
  loginSuffix: string;
  password: string;
  subDomain: string;
};

/** Absent de `recordsFetch` : DynHost est un espace séparé de l'API. */
export type DynHostRecord = {
  id: number;
  zone: string;
  subDomain: string | null;
  ip: string;
  ttl: number | null;
};

// ──────────────────────────────────────── serveurs DNS / glue records

export type FullNameServer = {
  id: number;
  host: string;
  ip: string | null;
  isUsed: boolean;
  /** Suppression demandée, pas encore effective chez le registre. */
  toDelete: boolean;
};

export type NameServerStatus = {
  state: string;
  type: string;
  usedSince: OvhDateTime | null;
};

export type NameServerInput = {
  host: string;
  /** Requis seulement pour un serveur situé dans la zone qu'il sert. */
  ip: string | null;
};

export type GlueRecord = { host: string; ips: string[] };
export type GlueRecordCreate = { host: string; ips: string[] };

// ──────────────────────────────────────── contacts du compte (/me)

export type MeContactAddress = {
  line1: string;
  line2: string | null;
  line3: string | null;
  zip: string;
  city: string;
  province: string | null;
  country: string;
  otherDetails: string | null;
};

/**
 * La fiche d'un contact du compte.
 *
 * **C'est ici que vivent les données personnelles**, pas dans la section
 * `/domain` : un domaine ne porte que des identifiants numériques pour ses
 * quatre contacts, et le schéma de l'API le dit explicitement — « contact data
 * can be edited via /me/contact/<ID> ». Contrairement à `Contact` (section
 * domaine), l'essentiel n'est pas nullable : de quoi afficher un nom lisible.
 */
export type MeContact = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  language: string;
  legalForm: string;
  address: MeContactAddress;

  organisationName: string | null;
  organisationType: string | null;
  gender: string | null;
  phone: string | null;
  cellPhone: string | null;
  fax: string | null;
  spareEmail: string | null;

  birthDay: OvhDate | null;
  birthCity: string | null;
  birthZip: string | null;
  birthCountry: string | null;
  nationality: string | null;

  vat: string | null;
  nationalIdentificationNumber: string | null;
  companyNationalIdentificationNumber: string | null;
};

/** Nom lisible d'un contact : l'organisation prime sur la personne. */
export function contactDisplayName(contact: MeContact): string {
  const org = contact.organisationName?.trim();
  if (org) return org;
  const name = `${contact.firstName.trim()} ${contact.lastName.trim()}`.trim();
  return name || contact.email;
}

export const me = {
  contactsList: () => invoke<number[]>("me_contacts_list"),
  contactGet: (contactId: number) => invoke<MeContact>("me_contact_get", { contactId }),
  /**
   * Résout plusieurs contacts en un seul appel, parallélisé côté Rust.
   *
   * Les identifiants introuvables — contact d'un autre compte, contact
   * supprimé — sont simplement absents du résultat : l'affichage des autres ne
   * doit pas en dépendre.
   */
  contactsResolve: (contactIds: number[]) =>
    invoke<MeContact[]>("me_contacts_resolve", { contactIds }),
  contactUpdate: (contactId: number, contact: MeContact) =>
    invoke<MeContact>("me_contact_update", { contactId, contact }),
};

// ─────────────────────────────────────────────────── contacts WHOIS

export type ContactAddress = {
  line1: string | null;
  line2: string | null;
  line3: string | null;
  zip: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  otherDetails: string | null;
};

/**
 * 41 champs, tous optionnels sauf `id`. L'obligation réelle dépend de
 * l'extension et de la forme juridique : à présenter par groupes, jamais à plat.
 */
export type Contact = {
  id: number;

  firstName: string | null;
  lastName: string | null;
  gender: string | null;
  language: string | null;
  email: string | null;
  phone: string | null;
  cellPhone: string | null;
  fax: string | null;
  website: string | null;
  address: ContactAddress | null;

  birthDay: OvhDate | null;
  birthCity: string | null;
  birthZip: string | null;
  birthCountry: string | null;
  nationality: string | null;

  legalForm: string | null;
  legalFormCategory: string | null;
  organisationName: string | null;
  enterpriseId: string | null;
  vat: string | null;
  insee: string | null;
  nationalIdentificationNumber: string | null;
  companyNationalIdentificationNumber: string | null;

  accreditationId: string | null;
  accreditationOrganism: string | null;
  accreditationCountry: string | null;
  accreditationYear: number | null;

  organisationType: string | null;
  organisationTypeOther: string | null;
  organisationRole: string | null;
  organisationRoleOther: string | null;
  organisationFunding: string | null;
  organisationFundingOther: string | null;
  organisationStaffStatus: string | null;
  organisationStaffStatusOther: string | null;
  organisationAccountable: string | null;
  roleInOrganisation: string | null;
  registrantDocumentType: string | null;
  registrantDocumentTypeOther: string | null;
  trademarkId: string | null;
};

// ─────────────────────────────────────────────────────────── tâches

export type DomainTask = {
  id: number;
  function: string;
  status: string;
  type: string;
  domain: string | null;
  comment: string | null;
  creationDate: OvhDateTime;
  lastUpdate: OvhDateTime;
  todoDate: OvhDateTime;
  doneDate: OvhDateTime | null;
  canAccelerate: boolean;
  canCancel: boolean;
  canRelaunch: boolean;
};

export type ZoneTask = {
  id: number;
  function: string;
  status: string;
  comment: string | null;
  creationDate: OvhDateTime;
  lastUpdate: OvhDateTime | null;
  todoDate: OvhDateTime;
  doneDate: OvhDateTime | null;
  canAccelerate: boolean;
  canCancel: boolean;
  canRelaunch: boolean;
};

/** À n'envoyer que si le drapeau `can…` correspondant est vrai. */
export type TaskAction = "accelerate" | "cancel" | "relaunch";

// ───────────────────────────────────────── valeurs connues des enums

/** Pour les menus et les libellés. Jamais pour rejeter une valeur reçue. */
export const KNOWN_RECORD_TYPES = [
  "A", "AAAA", "CAA", "CNAME", "DKIM", "DMARC", "DNAME", "HTTPS", "LOC", "MX",
  "NAPTR", "NS", "PTR", "RP", "SPF", "SRV", "SSHFP", "SVCB", "TLSA", "TXT",
] as const;

export const KNOWN_DOMAIN_STATES = [
  "ok", "pending_create", "pending_installation", "pending_incoming_transfer",
  "outgoing_transfer", "autorenew_in_progress", "autorenew_registry_in_progress",
  "pending_delete", "expired", "restorable", "dispute", "registry_suspended",
  "technical_suspended", "deleted",
] as const;

export const KNOWN_NAME_SERVER_TYPES = [
  "hosted", "anycast", "external", "dedicated", "hosting", "mixed", "parking",
  "hold", "empty",
] as const;

export const KNOWN_LOCK_STATUSES = [
  "locked", "unlocked", "locking", "unlocking", "unavailable",
] as const;

export const KNOWN_TASK_STATUSES = [
  "todo", "doing", "done", "error", "problem", "cancelled",
] as const;

/** Un état de tâche qui n'évoluera plus. */
export function isTerminalTaskStatus(status: string): boolean {
  return status === "done" || status === "error" || status === "cancelled";
}

// ───────────────────────────────────────────────── commandes domaines

export const domain = {
  // Domaines
  /** Les noms seuls — affichage immédiat. */
  list: () => invoke<string[]>("domains_list"),
  /** Les fiches complètes : un appel par domaine côté API. */
  fetch: () => invoke<DomainServiceWithIam[]>("domains_fetch"),
  get: (serviceName: string) =>
    invoke<DomainServiceWithIam>("domain_get", { serviceName }),
  /** Seuls ces deux champs sont modifiables sur un domaine. */
  update: (
    serviceName: string,
    changes: { nameServerType?: string; transferLockStatus?: string },
  ) => invoke<void>("domain_update", { serviceName, ...changes }),
  /** Code de transfert. À ne jamais journaliser ni mettre en cache. */
  authInfo: (serviceName: string) =>
    invoke<string>("domain_auth_info", { serviceName }),

  // Facturation
  serviceInfo: (serviceName: string) =>
    invoke<Service>("domain_service_info", { serviceName }),
  setRenew: (serviceName: string, renew: RenewType) =>
    invoke<void>("domain_set_renew", { serviceName, renew }),

  // Zones
  zonesList: () => invoke<string[]>("zones_list"),
  zoneGet: (zone: string) => invoke<ZoneWithIam>("zone_get", { zone }),
  zoneStatus: (zone: string) => invoke<ZoneStatus>("zone_status", { zone }),
  zoneCapabilities: (zone: string) =>
    invoke<ZoneCapabilities>("zone_capabilities", { zone }),
  soaGet: (zone: string) => invoke<Soa>("zone_soa_get", { zone }),
  soaSet: (zone: string, soa: Soa) => invoke<void>("zone_soa_set", { zone, soa }),
  dnssecGet: (zone: string) => invoke<ZoneDnssec>("zone_dnssec_get", { zone }),
  /** Long côté registre : le statut passe par `enableInProgress`. */
  dnssecEnable: (zone: string) => invoke<void>("zone_dnssec_enable", { zone }),
  dnssecDisable: (zone: string) => invoke<void>("zone_dnssec_disable", { zone }),
  /** Publie la zone. Sans cet appel, aucune modification n'est servie. */
  zoneRefresh: (zone: string) => invoke<void>("zone_refresh", { zone }),
  zoneExport: (zone: string) => invoke<string>("zone_export", { zone }),
  zoneImport: (zone: string, zoneFile: string) =>
    invoke<ZoneTask>("zone_import", { zone, zoneFile }),

  // Enregistrements
  recordIds: (zone: string, filter?: RecordFilter) =>
    invoke<number[]>("records_list_ids", { zone, filter: filter ?? null }),
  recordsFetch: (zone: string, filter?: RecordFilter) =>
    invoke<Record_[]>("records_fetch", { zone, filter: filter ?? null }),
  recordGet: (zone: string, id: number) =>
    invoke<Record_>("record_get", { zone, id }),
  recordCreate: (zone: string, record: RecordCreate) =>
    invoke<Record_>("record_create", { zone, record }),
  recordUpdate: (zone: string, id: number, record: RecordUpdate) =>
    invoke<void>("record_update", { zone, id, record }),
  recordDelete: (zone: string, id: number) =>
    invoke<void>("record_delete", { zone, id }),

  // DynHost
  dynhostLogins: (zone: string) =>
    invoke<DynHostLogin[]>("dynhost_logins", { zone }),
  dynhostLoginCreate: (zone: string, payload: DynHostLoginCreate) =>
    invoke<DynHostLogin>("dynhost_login_create", { zone, payload }),
  dynhostLoginUpdate: (zone: string, login: string, payload: DynHostLogin) =>
    invoke<void>("dynhost_login_update", { zone, login, payload }),
  dynhostLoginChangePassword: (zone: string, login: string, password: string) =>
    invoke<void>("dynhost_login_change_password", { zone, login, password }),
  dynhostLoginDelete: (zone: string, login: string) =>
    invoke<void>("dynhost_login_delete", { zone, login }),
  dynhostRecords: (zone: string) =>
    invoke<DynHostRecord[]>("dynhost_records", { zone }),

  // Serveurs DNS
  nameServers: (serviceName: string) =>
    invoke<FullNameServer[]>("name_servers", { serviceName }),
  nameServerStatus: (serviceName: string, id: number) =>
    invoke<NameServerStatus>("name_server_status", { serviceName, id }),
  /** Remplace TOUTE la liste : un serveur omis est un serveur supprimé. */
  nameServersReplace: (serviceName: string, nameServers: NameServerInput[]) =>
    invoke<DomainTask>("name_servers_replace", { serviceName, nameServers }),

  // Glue records
  glueRecords: (serviceName: string) =>
    invoke<GlueRecord[]>("glue_records", { serviceName }),
  glueRecordCreate: (serviceName: string, payload: GlueRecordCreate) =>
    invoke<DomainTask>("glue_record_create", { serviceName, payload }),
  glueRecordUpdate: (serviceName: string, host: string, ips: string[]) =>
    invoke<DomainTask>("glue_record_update", { serviceName, host, ips }),
  glueRecordDelete: (serviceName: string, host: string) =>
    invoke<DomainTask>("glue_record_delete", { serviceName, host }),

  // Contacts WHOIS
  contactsList: () => invoke<Contact[]>("contacts_list"),
  contactGet: (contactId: number) =>
    invoke<Contact>("contact_get", { contactId }),
  contactUpdate: (contactId: number, contact: Contact) =>
    invoke<Contact>("contact_update", { contactId, contact }),
  /** Admin, facturation et technique seulement — pas le propriétaire. */
  changeContacts: (serviceName: string, payload: ChangeContact) =>
    invoke<number[]>("domain_change_contacts", { serviceName, payload }),

  // Tâches
  domainTasks: (serviceName: string) =>
    invoke<DomainTask[]>("domain_tasks", { serviceName }),
  zoneTasks: (zone: string) => invoke<ZoneTask[]>("zone_tasks", { zone }),
  domainTaskAct: (serviceName: string, id: number, action: TaskAction) =>
    invoke<void>("domain_task_act", { serviceName, id, action }),
  zoneTaskAct: (zone: string, id: number, action: TaskAction) =>
    invoke<void>("zone_task_act", { zone, id, action }),
};

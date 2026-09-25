/**
 * Couche de données de la console.
 *
 * C'est le **seul** module de `src/ui/` qui parle à `../ovh-api.ts` : les vues
 * n'appellent jamais `domain.*` ni `auth.*` directement. En échange, elle prend
 * en charge ce qu'une vue n'a pas à savoir faire :
 *
 * - le **cache** par domaine, pour ne pas refaire 200 requêtes à chaque clic ;
 * - l'**affichage progressif** : les noms d'abord, les fiches ensuite
 *   (`GET /domain/zone/{zone}/record` ne renvoie que des identifiants, une liste
 *   affichable coûte un appel par enregistrement) ;
 * - la **tolérance aux pannes partielles** : une zone illisible ne doit pas
 *   vider tout l'écran, l'échec est rangé dans `partialErrors` et affiché à sa
 *   place ;
 * - un **mode « données d'exemple »**, désactivé par défaut, qui permet de
 *   travailler l'écran 03 sans compte OVH connecté.
 */

import {
  domain as api,
  hosting as hostingApi,
  isOvhError,
  type ChangeContact,
  type Contact,
  type DomainServiceWithIam,
  type DomainTask,
  type DynHostLogin,
  type DynHostLoginCreate,
  type DynHostRecord,
  type FullNameServer,
  type GlueRecord,
  type GlueRecordCreate,
  type NameServerInput,
  type Record_,
  type RecordCreate,
  type RecordUpdate,
  type RenewType,
  type Service,
  type Soa,
  type TaskAction,
  type ZoneCapabilities,
  type ZoneDnssec,
  type ZoneStatus,
  type ZoneTask,
  type ZoneWithIam,
  me as meApi,
  contactDisplayName,
  type MeContact,
  type AttachedDomain,
  type Cron,
  type CronInput,
  type Database,
  type DatabaseDump,
  type EnvVar,
  type HostingService,
  type HostingCapabilities,
  type HostingSsl,
  type HostingTask,
  type HostingUser,
  type HostingUserCreate,
  type Runtime,
} from "../ovh-api";
import type { IconName } from "./icons";
import {
  domainStateLabel,
  hostingStatePresentation,
  isHealthyDomainState,
  renewalStateLabel,
} from "./labels";
import * as sample from "./sample";

// ===========================================================================
// Mode de fonctionnement
// ===========================================================================

export type DataMode = "live" | "sample";

const MODE_KEY = "ovh.dataMode";

let mode: DataMode = readMode();

function readMode(): DataMode {
  try {
    return localStorage.getItem(MODE_KEY) === "sample" ? "sample" : "live";
  } catch {
    // Stockage indisponible (webview verrouillé) : le mode normal reste le défaut.
    return "live";
  }
}

/** Le mode courant. `live` par défaut : le chemin normal est le vrai appel. */
export function dataMode(): DataMode {
  return mode;
}

/**
 * Bascule entre appels réels et données d'exemple. Le choix est mémorisé pour
 * survivre à un rechargement du webview, et vide tous les caches.
 */
export function setDataMode(next: DataMode): void {
  if (next === mode) return;
  mode = next;
  invalidateAll();
  try {
    localStorage.setItem(MODE_KEY, next);
  } catch {
    // Sans persistance, le mode vit le temps de la session : acceptable.
  }
}

// ===========================================================================
// Erreurs
// ===========================================================================

export type FailureInfo = {
  kind: string;
  message: string;
  /**
   * L'erreur veut dire « il manque une autorisation », pas « quelque chose a
   * cassé » : l'appelant doit renvoyer l'utilisateur vers l'écran 02 Connexion.
   */
  needsAuth: boolean;
};

/** Normalise n'importe quoi de jeté en quelque chose d'affichable. */
export function describeFailure(e: unknown): FailureInfo {
  if (isOvhError(e)) {
    return {
      kind: e.kind,
      message: e.message,
      needsAuth:
        e.kind === "notConfigured" ||
        e.kind === "pendingValidation" ||
        e.kind === "noApplication" ||
        e.kind === "credentialUnusable" ||
        e.kind === "unauthorized",
    };
  }
  if (e instanceof Error) return { kind: "unknown", message: e.message, needsAuth: false };
  return { kind: "unknown", message: String(e), needsAuth: false };
}

// ===========================================================================
// Catalogue de produits
// ===========================================================================

export type SectionId = "domains" | "dedicated" | "vps" | "hosting" | "email";

export type ProductSection = {
  id: SectionId;
  label: string;
  icon: IconName;
  count: number;
  /** `false` pour une famille qui n'existe qu'en données d'exemple. */
  live: boolean;
};

export type ProductSummary = {
  id: string;
  /** Ligne secondaire du sélecteur : offre, extension, renouvellement… */
  offer: string;
  status: string;
  /** `false` fait apparaître l'étiquette d'alerte dans le sélecteur. */
  ok: boolean;
};

export type ProductAction = { label: string; icon: IconName };

export type ProductTable = { title: string; cols: string[]; rows: string[][] };

export type ProductDetail = {
  id: string;
  offer: string;
  status: string;
  ok: boolean;
  infos: { k: string; v: string }[];
  table: ProductTable | null;
  primary: ProductAction | null;
  secondary: ProductAction[];
};

/**
 * Tout ce que l'écran 03 affiche d'un domaine, agrégé.
 *
 * Les champs qui valent `null` n'ont pas pu être chargés : la raison est dans
 * `partialErrors`. La vue montre alors ce qu'elle a, pas une page vide.
 */
export type DomainBundle = {
  name: string;
  service: DomainServiceWithIam;
  serviceInfo: Service | null;
  zone: ZoneWithIam | null;
  zoneStatus: ZoneStatus | null;
  zoneCapabilities: ZoneCapabilities | null;
  /**
   * Statut DNSSEC **de la zone** — celui que `dnssecEnable`/`dnssecDisable`
   * font bouger, et le seul qui passe par les deux états transitoires.
   */
  zoneDnssec: ZoneDnssec | null;
  soa: Soa | null;
  records: Record_[];
  dynHostLogins: DynHostLogin[];
  /** Second jeu d'enregistrements, absent de `records`. */
  dynHostRecords: DynHostRecord[];
  nameServers: FullNameServer[];
  glueRecords: GlueRecord[];
  /** Les contacts du compte, pour mettre un nom sur les identifiants du domaine. */
  contacts: Contact[];
  domainTasks: DomainTask[];
  zoneTasks: ZoneTask[];
  partialErrors: { part: string; message: string }[];
};

export type AccountIdentity = {
  account: string;
  displayName: string;
  initials: string;
};

// ===========================================================================
// Caches
// ===========================================================================

let domainNamesCache: string[] | null = null;
let domainServicesCache: Map<string, DomainServiceWithIam> | null = null;
let contactsCache: Contact[] | null = null;
/**
 * Fiches `/me/contact`, par identifiant.
 *
 * Un domaine ne porte que des identifiants numériques pour ses quatre contacts
 * — le schéma de l'API renvoie explicitement vers `/me/contact/<ID>` pour les
 * données. Sans cette résolution, la carte « Propriétaire » affiche un nombre.
 */
let meContactsCache = new Map<number, MeContact>();
const bundleCache = new Map<string, DomainBundle>();

export function invalidateDomain(name: string): void {
  bundleCache.delete(name);
}

export function invalidateAll(): void {
  domainNamesCache = null;
  domainServicesCache = null;
  contactsCache = null;
  meContactsCache = new Map();
  bundleCache.clear();
  invalidateHostingCaches();
}

// ===========================================================================
// Compte
// ===========================================================================

/**
 * Le compte affiché dans la barre latérale.
 *
 * L'identifiant vient de l'écran de connexion (`ovh_status`) : `data.ts` ne le
 * redemande pas, il lui est passé.
 *
 * Aucun nom lisible n'est deviné. Le carnet `/me/contact` n'est pas la fiche du
 * titulaire : y prendre le premier contact nommé afficherait le nom de quelqu'un
 * d'autre. Tant que l'identité du compte n'est pas exposée, l'identifiant OVH
 * est ce qu'on affiche — il est exact.
 */
export async function getAccount(account: string | null): Promise<AccountIdentity> {
  if (mode === "sample") {
    return {
      account: sample.SAMPLE_ACCOUNT.account,
      displayName: sample.SAMPLE_ACCOUNT.displayName,
      initials: initials(sample.SAMPLE_ACCOUNT.displayName),
    };
  }

  const id = account ?? "—";
  return { account: id, displayName: id, initials: initials(id) };
}

/**
 * Résout les identifiants de contact en fiches lisibles, en un seul appel.
 *
 * Ceux qui manquent au cache sont demandés ensemble ; les introuvables — contact
 * d'un autre compte, contact supprimé — sont simplement absents, et l'affichage
 * retombe alors sur l'identifiant brut plutôt que sur du vide.
 */
async function resolveMeContacts(ids: string[]): Promise<void> {
  if (dataMode() === "sample") return;
  const missing = ids
    .map((id) => Number(id))
    .filter((n) => Number.isFinite(n) && !meContactsCache.has(n));
  if (missing.length === 0) return;
  try {
    for (const contact of await meApi.contactsResolve(missing)) {
      meContactsCache.set(contact.id, contact);
    }
  } catch {
    // Confort d'affichage : son échec ne doit pas casser la fiche du domaine.
  }
}

/** Nom lisible d'un contact du domaine, ou `null` s'il reste inconnu. */
export function meContactName(contactId: string): string | null {
  const n = Number(contactId);
  if (!Number.isFinite(n)) return null;
  const found = meContactsCache.get(n);
  return found ? contactDisplayName(found) : null;
}

export function meContact(contactId: string): MeContact | null {
  const n = Number(contactId);
  if (!Number.isFinite(n)) return null;
  return meContactsCache.get(n) ?? null;
}

function nameOf(c: Contact): string | null {
  const parts = [c.firstName, c.lastName].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  return c.organisationName ?? null;
}

function initials(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ===========================================================================
// Sections
// ===========================================================================

/**
 * Les familles de produits de la barre latérale.
 *
 * Deux familles sont branchées sur l'API : `/domain` et `/hosting/web`. Les
 * autres familles de la maquette n'apparaissent qu'en mode « données
 * d'exemple », marquées `live: false`.
 *
 * L'hébergement n'apparaît qu'une fois su qu'il y en a — et son échec de
 * lecture ne fait pas tomber la barre latérale : une délégation sans droit sur
 * `/hosting/web` doit laisser les domaines accessibles.
 */
export async function listSections(): Promise<ProductSection[]> {
  const domains = await listDomainNames();
  const sections: ProductSection[] = [
    {
      id: "domains",
      label: "Domaines",
      icon: "globe-simple",
      count: domains.length,
      live: true,
    },
  ];

  let hostings: string[] = [];
  try {
    hostings = await listHostingNames();
  } catch {
    // Pas de droit, ou pas d'hébergement : dans les deux cas la famille n'a
    // rien à montrer, et l'écran des domaines doit rester utilisable.
    hostings = [];
  }
  if (hostings.length > 0) {
    sections.push({
      id: "hosting",
      label: "Hébergements web",
      icon: "browsers",
      count: hostings.length,
      live: true,
    });
  }

  if (mode === "sample") {
    for (const s of sample.sampleOtherSections()) {
      sections.push({ ...s, live: false });
    }
  }
  return sections;
}

// ===========================================================================
// Liste de produits
// ===========================================================================

/**
 * Les produits d'une famille.
 *
 * Pour les domaines, deux temps : la liste des noms revient tout de suite
 * (`domains_list`), et `onEnrich` est rappelé avec les lignes complètes dès que
 * les fiches arrivent (`domains_fetch`, un appel par domaine côté API). La vue
 * affiche donc les noms sans attendre.
 */
export async function listProducts(
  section: SectionId,
  onEnrich?: (products: ProductSummary[]) => void,
): Promise<ProductSummary[]> {
  if (section === "hosting") return listHostingProducts(onEnrich);
  if (section !== "domains") {
    return mode === "sample" ? sample.sampleOtherProducts(section) : [];
  }

  const names = await listDomainNames();

  // En mode exemple, tout est déjà en mémoire : pas d'enrichissement différé, et
  // surtout pas d'appel à `domains_fetch`, qui irait taper la vraie API.
  if (mode === "sample") {
    return names.map((name) => domainSummary(sample.sampleDomainService(name)));
  }

  const known = domainServicesCache;

  const build = (): ProductSummary[] =>
    names.map((name) => {
      const svc = known?.get(name);
      return svc ? domainSummary(svc) : { id: name, offer: "…", status: "", ok: true };
    });

  const immediate = build();

  // Enrichissement en tâche de fond : on ne bloque pas l'affichage pour lui.
  if (onEnrich && (!known || names.some((n) => !known.has(n)))) {
    void loadDomainServices()
      .then(() => onEnrich(build()))
      .catch(() => {
        // La liste des noms suffit à naviguer : un échec ici n'est pas bloquant.
      });
  }

  return immediate;
}

function domainSummary(svc: DomainServiceWithIam): ProductSummary {
  const dot = svc.domain.indexOf(".");
  const extension = dot >= 0 ? svc.domain.slice(dot) : svc.domain;
  return {
    id: svc.domain,
    offer: `${extension} · ${renewalStateLabel(svc.renewalState)}`,
    status: domainStateLabel(svc.state),
    ok: isHealthyDomainState(svc.state) && svc.suspensionState === "not_suspended",
  };
}

/** Le détail d'un produit d'une famille autre que les domaines. */
export async function getProduct(
  section: SectionId,
  id: string,
): Promise<ProductDetail | null> {
  // Domaines et hébergements ont chacun leur page complète : cette vue
  // générique ne sert qu'aux familles qui n'en ont pas encore.
  if (section === "domains" || section === "hosting") return null;
  return mode === "sample" ? sample.sampleOtherProduct(section, id) : null;
}

// ===========================================================================
// Domaines — lecture
// ===========================================================================

export async function listDomainNames(options: { force?: boolean } = {}): Promise<
  string[]
> {
  if (mode === "sample") return sample.sampleDomainNames();
  if (domainNamesCache && !options.force) return domainNamesCache;
  domainNamesCache = await api.list();
  return domainNamesCache;
}

async function loadDomainServices(): Promise<Map<string, DomainServiceWithIam>> {
  if (domainServicesCache) return domainServicesCache;
  const list = await api.fetch();
  domainServicesCache = new Map(list.map((s) => [s.domain, s]));
  return domainServicesCache;
}

async function loadContacts(): Promise<Contact[]> {
  if (mode === "sample") return sample.sampleContacts();
  if (contactsCache) return contactsCache;
  try {
    contactsCache = await api.contactsList();
  } catch {
    // Les contacts ne sont qu'un confort d'affichage : sans eux on montre les
    // identifiants bruts, ce qui reste exact.
    contactsCache = [];
  }
  return contactsCache;
}

/**
 * Charge tout ce dont la page domaine a besoin, en parallèle.
 *
 * `Promise.allSettled` plutôt que `all` : chaque partie échoue pour elle seule.
 * Seule la fiche du domaine est obligatoire — sans elle il n'y a pas de page.
 */
export async function loadDomainBundle(
  name: string,
  options: { force?: boolean } = {},
): Promise<DomainBundle> {
  if (mode === "sample") {
    const bundle = sample.sampleDomainBundle(name);
    bundleCache.set(name, bundle);
    return bundle;
  }

  const cached = bundleCache.get(name);
  if (cached && !options.force) return cached;

  const service = await api.get(name);

  const errors: { part: string; message: string }[] = [];
  const settled = await Promise.allSettled([
    api.serviceInfo(name),
    api.zoneGet(name),
    api.zoneStatus(name),
    api.zoneCapabilities(name),
    api.dnssecGet(name),
    api.soaGet(name),
    api.recordsFetch(name),
    api.dynhostLogins(name),
    api.dynhostRecords(name),
    api.nameServers(name),
    api.glueRecords(name),
    api.domainTasks(name),
    api.zoneTasks(name),
    loadContacts(),
  ] as const);

  /** Récupère une valeur, ou `fallback` en notant pourquoi ça a échoué. */
  function pick<T>(index: number, part: string, fallback: T): T {
    const r = settled[index];
    if (r.status === "fulfilled") return r.value as T;
    errors.push({ part, message: describeFailure(r.reason).message });
    return fallback;
  }

  const bundle: DomainBundle = {
    name,
    service,
    serviceInfo: pick<Service | null>(0, "facturation", null),
    zone: pick<ZoneWithIam | null>(1, "zone DNS", null),
    zoneStatus: pick<ZoneStatus | null>(2, "état de la zone", null),
    zoneCapabilities: pick<ZoneCapabilities | null>(3, "capacités de la zone", null),
    zoneDnssec: pick<ZoneDnssec | null>(4, "DNSSEC", null),
    soa: pick<Soa | null>(5, "SOA", null),
    records: pick<Record_[]>(6, "enregistrements", []),
    dynHostLogins: pick<DynHostLogin[]>(7, "identifiants DynHost", []),
    dynHostRecords: pick<DynHostRecord[]>(8, "enregistrements DynHost", []),
    nameServers: pick<FullNameServer[]>(9, "serveurs DNS", []),
    glueRecords: pick<GlueRecord[]>(10, "glue records", []),
    domainTasks: pick<DomainTask[]>(11, "opérations du domaine", []),
    zoneTasks: pick<ZoneTask[]>(12, "opérations de la zone", []),
    contacts: pick<Contact[]>(13, "contacts", []),
    partialErrors: errors,
  };

  // Les quatre contacts du domaine ne sont que des identifiants : on résout
  // leurs fiches avant de rendre la main, pour que l'interface n'ait jamais à
  // afficher un nombre à la place d'un nom.
  await resolveMeContacts([
    bundle.service.contactOwner.id,
    bundle.service.contactAdmin.id,
    bundle.service.contactBilling.id,
    bundle.service.contactTech.id,
  ]);

  bundleCache.set(name, bundle);
  return bundle;
}

/** Relit le seul état de déploiement — appelé après une publication. */
export async function refreshZoneStatus(name: string): Promise<ZoneStatus | null> {
  if (mode === "sample") {
    const status = sample.sampleDomainBundle(name).zoneStatus;
    patchBundle(name, { zoneStatus: status });
    return status;
  }
  try {
    const status = await api.zoneStatus(name);
    patchBundle(name, { zoneStatus: status });
    return status;
  } catch {
    return null;
  }
}

/**
 * Relit le seul statut DNSSEC de la zone.
 *
 * Appelé pendant qu'une bascule court : `enableInProgress` peut durer plusieurs
 * minutes chez le registre, et l'API n'émet rien. Une relecture ciblée coûte un
 * appel, là où recharger le domaine en coûte quatorze.
 */
export async function refreshZoneDnssec(name: string): Promise<ZoneDnssec | null> {
  if (mode === "sample") {
    const zoneDnssec = sample.sampleDomainBundle(name).zoneDnssec;
    patchBundle(name, { zoneDnssec });
    return zoneDnssec;
  }
  try {
    const zoneDnssec = await api.dnssecGet(name);
    patchBundle(name, { zoneDnssec });
    return zoneDnssec;
  } catch {
    return null;
  }
}

/** Relit les deux listes de tâches — appelé pendant le suivi d'une opération. */
export async function refreshTasks(
  name: string,
): Promise<{ domainTasks: DomainTask[]; zoneTasks: ZoneTask[] }> {
  if (mode === "sample") {
    const b = sample.sampleDomainBundle(name);
    const next = { domainTasks: b.domainTasks, zoneTasks: b.zoneTasks };
    patchBundle(name, next);
    return next;
  }
  const [d, z] = await Promise.allSettled([api.domainTasks(name), api.zoneTasks(name)]);
  const next = {
    domainTasks: d.status === "fulfilled" ? d.value : (bundleCache.get(name)?.domainTasks ?? []),
    zoneTasks: z.status === "fulfilled" ? z.value : (bundleCache.get(name)?.zoneTasks ?? []),
  };
  patchBundle(name, next);
  return next;
}

/** Relit la fiche du domaine seule — après un changement de verrou par exemple. */
export async function refreshDomainService(
  name: string,
): Promise<DomainServiceWithIam | null> {
  if (mode === "sample") {
    const service = sample.sampleDomainBundle(name).service;
    patchBundle(name, { service });
    return service;
  }
  try {
    const service = await api.get(name);
    patchBundle(name, { service });
    domainServicesCache?.set(name, service);
    return service;
  } catch {
    return null;
  }
}

function patchBundle(name: string, patch: Partial<DomainBundle>): void {
  const cached = bundleCache.get(name);
  if (cached) bundleCache.set(name, { ...cached, ...patch });
}

// ===========================================================================
// Domaines — écriture
// ===========================================================================

/**
 * Une modification en attente de publication.
 *
 * Le brouillon est tenu côté interface, pas côté API. Raison : l'API applique
 * une écriture d'enregistrement immédiatement — mais ne la sert qu'après
 * `zoneRefresh`. Accumuler d'abord puis tout envoyer d'un coup évite de laisser
 * la zone dans un état intermédiaire que l'utilisateur n'a pas demandé, et rend
 * « Tout annuler » possible, ce qu'aucun appel API ne permettrait.
 */
export type ZoneEdit =
  | { op: "create"; record: RecordCreate }
  | { op: "update"; id: number; record: RecordUpdate }
  | { op: "delete"; id: number };

export type ZonePublishResult = {
  /** Nombre de modifications passées. */
  applied: number;
  /**
   * Celles qui ont échoué, avec leur rang dans `edits` et la raison : rien
   * n'est avalé en silence, et l'appelant sait lesquelles garder au brouillon.
   */
  failed: { index: number; edit: ZoneEdit; message: string }[];
  /** La zone a-t-elle bien été publiée après les écritures. */
  refreshed: boolean;
  refreshError: string | null;
};

/**
 * Envoie le brouillon puis publie la zone.
 *
 * Les écritures partent en série : l'API renvoie des erreurs par enregistrement
 * (cible invalide, conflit CNAME…) et il faut pouvoir dire lesquelles. La
 * publication a lieu même si certaines ont échoué, pour ne pas laisser les
 * réussies non servies — et le rapport dit exactement ce qui s'est passé.
 */
/**
 * Écrit un enregistrement **et publie la zone**.
 *
 * Les deux vont ensemble parce que rien dans l'API ne permet de savoir qu'une
 * publication reste due : `isDeployed` décrit la santé de la zone, pas un état
 * de brouillon, et ni `lastUpdate` ni le serial SOA ne sont exploitables sans
 * mémoriser une valeur de référence. Plutôt que de retenir cet état — qui se
 * perdrait au premier redémarrage et laisserait un enregistrement écrit mais
 * jamais servi — on publie systématiquement, comme le fait DNSControl.
 *
 * Le rafraîchissement est une tâche asynchrone : elle apparaît dans l'onglet
 * Opérations, et son échec est signalé sans annuler l'écriture, qui a bien eu
 * lieu.
 */
export async function applyRecordEdit(zone: string, edit: ZoneEdit): Promise<void> {
  if (mode === "sample") {
    if (edit.op === "create") sample.sampleCreateRecord(zone, edit.record);
    else if (edit.op === "update") sample.sampleUpdateRecord(zone, edit.id, edit.record);
    else sample.sampleDeleteRecord(zone, edit.id);
  } else if (edit.op === "create") {
    await api.recordCreate(zone, edit.record);
  } else if (edit.op === "update") {
    await api.recordUpdate(zone, edit.id, edit.record);
  } else {
    await api.recordDelete(zone, edit.id);
  }

  try {
    if (mode === "sample") sample.sampleRefreshZone(zone);
    else await api.zoneRefresh(zone);
  } catch (e) {
    // L'écriture est faite : on ne la rejoue pas. On dit seulement que la zone
    // n'a pas été publiée, pour que « Publier la zone » reste une porte de sortie.
    invalidateDomain(zone);
    throw new ZonePublishPending(describeFailure(e).message);
  }

  invalidateDomain(zone);
}

/**
 * L'enregistrement est écrit, mais la publication de la zone a échoué.
 *
 * Distinct d'un échec d'écriture : il ne faut surtout pas laisser croire que la
 * modification est perdue, ni inviter à la refaire.
 */
export class ZonePublishPending extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "ZonePublishPending";
  }
}

export async function publishZoneEdits(
  zone: string,
  edits: ZoneEdit[],
): Promise<ZonePublishResult> {
  const failed: { index: number; edit: ZoneEdit; message: string }[] = [];
  let applied = 0;

  for (const [index, edit] of edits.entries()) {
    try {
      if (mode === "sample") {
        if (edit.op === "create") sample.sampleCreateRecord(zone, edit.record);
        else if (edit.op === "update") sample.sampleUpdateRecord(zone, edit.id, edit.record);
        else sample.sampleDeleteRecord(zone, edit.id);
      } else if (edit.op === "create") {
        await api.recordCreate(zone, edit.record);
      } else if (edit.op === "update") {
        await api.recordUpdate(zone, edit.id, edit.record);
      } else {
        await api.recordDelete(zone, edit.id);
      }
      applied += 1;
    } catch (e) {
      failed.push({ index, edit, message: describeFailure(e).message });
    }
  }

  let refreshed = false;
  let refreshError: string | null = null;
  if (applied > 0 || edits.length === 0) {
    try {
      if (mode === "sample") sample.sampleRefreshZone(zone);
      else await api.zoneRefresh(zone);
      refreshed = true;
    } catch (e) {
      refreshError = describeFailure(e).message;
    }
  }

  invalidateDomain(zone);
  return { applied, failed, refreshed, refreshError };
}

/**
 * Remplace **toute** la liste des serveurs DNS. Un serveur omis est un serveur
 * supprimé : l'appelant doit avoir montré le avant/après.
 */
export async function replaceNameServers(
  serviceName: string,
  nameServers: NameServerInput[],
): Promise<DomainTask> {
  const task =
    mode === "sample"
      ? sample.sampleReplaceNameServers(serviceName, nameServers)
      : await api.nameServersReplace(serviceName, nameServers);
  invalidateDomain(serviceName);
  return task;
}

export async function createDynHostLogin(
  zone: string,
  payload: DynHostLoginCreate,
): Promise<DynHostLogin> {
  const created =
    mode === "sample"
      ? sample.sampleCreateDynHostLogin(zone, payload)
      : await api.dynhostLoginCreate(zone, payload);
  invalidateDomain(zone);
  return created;
}

/**
 * Remplace le mot de passe d'un identifiant DynHost.
 *
 * L'API ne rend jamais un mot de passe : il n'y a pas de « voir », seulement un
 * « remplacer ». L'appelant est donc le dernier à connaître la valeur — c'est
 * pour ça que l'interface l'affiche une fois, avec de quoi la copier.
 */
export async function changeDynHostPassword(
  zone: string,
  login: string,
  password: string,
): Promise<void> {
  if (mode === "sample") sample.sampleChangeDynHostPassword(zone, login);
  else await api.dynhostLoginChangePassword(zone, login, password);
  invalidateDomain(zone);
}

export async function deleteDynHostLogin(zone: string, login: string): Promise<void> {
  if (mode === "sample") sample.sampleDeleteDynHostLogin(zone, login);
  else await api.dynhostLoginDelete(zone, login);
  invalidateDomain(zone);
}

export async function createGlueRecord(
  serviceName: string,
  payload: GlueRecordCreate,
): Promise<DomainTask> {
  const task =
    mode === "sample"
      ? sample.sampleCreateGlueRecord(serviceName, payload)
      : await api.glueRecordCreate(serviceName, payload);
  invalidateDomain(serviceName);
  return task;
}

export async function deleteGlueRecord(
  serviceName: string,
  host: string,
): Promise<DomainTask> {
  const task =
    mode === "sample"
      ? sample.sampleDeleteGlueRecord(serviceName, host)
      : await api.glueRecordDelete(serviceName, host);
  invalidateDomain(serviceName);
  return task;
}

/** `status` vaut `locked` ou `unlocked` ; les états transitoires ne s'écrivent pas. */
export async function setTransferLock(
  serviceName: string,
  status: "locked" | "unlocked",
): Promise<void> {
  if (mode === "sample") sample.sampleSetTransferLock(serviceName, status);
  else await api.update(serviceName, { transferLockStatus: status });
  invalidateDomain(serviceName);
}

/**
 * Active ou désactive DNSSEC **sur la zone**.
 *
 * Long côté registre : le statut passe par `enableInProgress` /
 * `disableInProgress` et la bascule n'est pas immédiate. L'appelant doit
 * relire (`refreshZoneDnssec`) tant que `isDnssecTransitioning` est vrai, et ne
 * pas reproposer l'action entre-temps.
 */
export async function setZoneDnssec(zone: string, enabled: boolean): Promise<void> {
  if (mode === "sample") sample.sampleSetZoneDnssec(zone, enabled);
  else if (enabled) await api.dnssecEnable(zone);
  else await api.dnssecDisable(zone);
  invalidateDomain(zone);
}

export async function setRenew(serviceName: string, renew: RenewType): Promise<void> {
  if (mode === "sample") sample.sampleSetRenew(serviceName, renew);
  else await api.setRenew(serviceName, renew);
  invalidateDomain(serviceName);
}

/**
 * Change les contacts administratif, de facturation et technique. **Jamais le
 * propriétaire** : c'est une procédure de trade chez le registre.
 */
export async function changeContacts(
  serviceName: string,
  payload: ChangeContact,
): Promise<number[]> {
  const tasks =
    mode === "sample"
      ? sample.sampleChangeContacts(serviceName, payload)
      : await api.changeContacts(serviceName, payload);
  invalidateDomain(serviceName);
  return tasks;
}

/** À n'appeler que si le drapeau `can…` de la tâche est vrai. */
export async function actOnDomainTask(
  serviceName: string,
  id: number,
  action: TaskAction,
): Promise<void> {
  if (mode === "sample") sample.sampleActOnDomainTask(serviceName, id, action);
  else await api.domainTaskAct(serviceName, id, action);
  invalidateDomain(serviceName);
}

export async function actOnZoneTask(
  zone: string,
  id: number,
  action: TaskAction,
): Promise<void> {
  if (mode === "sample") sample.sampleActOnZoneTask(zone, id, action);
  else await api.zoneTaskAct(zone, id, action);
  invalidateDomain(zone);
}

/**
 * De quoi identifier un contact du domaine à l'écran.
 *
 * La fiche du domaine ne porte qu'un identifiant numérique. Quand le compte
 * connaît ce contact, son adresse e-mail dit bien plus qu'un nombre ; sinon on
 * rend l'identifiant brut, sans rien inventer.
 */
export function nicHandleOf(bundle: DomainBundle, contactId: string): string | null {
  if (mode === "sample") return sample.sampleNicHandle(contactId);
  const n = Number(contactId);
  if (!Number.isFinite(n)) return contactId;
  const found = bundle.contacts.find((c) => c.id === n);
  return found ? (found.email ?? contactId) : null;
}

/** Le nom lisible d'un contact du domaine, si le compte le connaît. */
export function contactNameOf(bundle: DomainBundle, contactId: string): string | null {
  const n = Number(contactId);
  if (!Number.isFinite(n)) return null;
  const found = bundle.contacts.find((c) => c.id === n);
  return found ? nameOf(found) : null;
}

// ===========================================================================
// Hébergement web — lecture
// ===========================================================================

/**
 * Tout ce que la page d'un hébergement affiche, agrégé.
 *
 * Même règle que pour un domaine : ce qui n'a pas pu être lu est vide et sa
 * raison est dans `partialErrors`. Seule la fiche de l'hébergement est
 * obligatoire — sans elle il n'y a pas de page.
 *
 * `dumps` est rempli à la demande, base par base : `GET …/database/{name}/dump`
 * ne rend que des identifiants, et charger les sauvegardes de toutes les bases
 * au chargement de la page coûterait des appels que personne n'a demandés.
 */
export type HostingBundle = {
  serviceName: string;
  service: HostingService;
  /**
   * Ce que l'offre autorise.
   *
   * `null` quand la lecture a échoué : l'interface propose alors tout et laisse
   * l'API arbitrer, plutôt que d'interdire sur une ignorance.
   */
  capabilities: HostingCapabilities | null;
  attachedDomains: AttachedDomain[];
  users: HostingUser[];
  databases: Database[];
  /** Sauvegardes déjà chargées, par nom de base. */
  dumps: Record<string, DatabaseDump[]>;
  crons: Cron[];
  envVars: EnvVar[];
  runtimes: Runtime[];
  ssl: HostingSsl | null;
  tasks: HostingTask[];
  partialErrors: { part: string; message: string }[];
};

let hostingNamesCache: string[] | null = null;
let hostingServicesCache: Map<string, HostingService> | null = null;
const hostingBundleCache = new Map<string, HostingBundle>();
/**
 * Les zones DNS du compte.
 *
 * Elles décident si l'API pourra configurer le DNS d'un domaine qu'on attache :
 * une zone absente de cette liste n'est pas écrivable, et le formulaire doit le
 * dire **avant** de valider plutôt que de laisser l'API refuser.
 */
let zoneNamesCache: string[] | null = null;

function invalidateHostingCaches(): void {
  hostingNamesCache = null;
  hostingServicesCache = null;
  hostingBundleCache.clear();
  zoneNamesCache = null;
  zoneAddressCache.clear();
  hostingAddressIndex = null;
  offerCapabilitiesCache.clear();
}

export function invalidateHosting(serviceName: string): void {
  hostingBundleCache.delete(serviceName);
}

export async function listHostingNames(options: { force?: boolean } = {}): Promise<
  string[]
> {
  if (mode === "sample") return sample.sampleHostingNames();
  if (hostingNamesCache && !options.force) return hostingNamesCache;
  hostingNamesCache = await hostingApi.list();
  return hostingNamesCache;
}

/** Les zones DNS du compte, pour savoir où l'API a le droit d'écrire. */
export async function listZoneNames(): Promise<string[]> {
  if (mode === "sample") return sample.sampleZoneNames();
  if (zoneNamesCache) return zoneNamesCache;
  try {
    zoneNamesCache = await api.zonesList();
  } catch {
    // Sans la liste, le formulaire de multisite retombe sur « je ne sais pas si
    // l'API pourra écrire » : c'est moins précis, mais ça ne bloque rien.
    zoneNamesCache = [];
  }
  return zoneNamesCache;
}

async function loadHostingServices(): Promise<Map<string, HostingService>> {
  if (hostingServicesCache) return hostingServicesCache;
  const list = await hostingApi.fetch();
  hostingServicesCache = new Map(list.map((h) => [h.serviceName, h]));
  return hostingServicesCache;
}

/**
 * Le titre d'un hébergement. `displayName` d'abord, sinon le **code d'offre
 * brut** : `offer` compte 88 valeurs dont des fossiles (`start1m`,
 * `deproxxl2012`) et aucune table de correspondance ne tiendrait.
 */
export function hostingTitle(service: HostingService): string {
  return service.displayName?.trim() || service.offer;
}

function hostingSummary(service: HostingService): ProductSummary {
  const state = hostingStatePresentation(service.state);
  const title = service.displayName?.trim();
  return {
    id: service.serviceName,
    offer: title ? `${title} · ${service.offer}` : `${service.offer} · ${service.cluster}`,
    status: state.label,
    ok: state.tone === "ok",
  };
}

async function listHostingProducts(
  onEnrich?: (products: ProductSummary[]) => void,
): Promise<ProductSummary[]> {
  const names = await listHostingNames();

  if (mode === "sample") {
    return names.map((name) => hostingSummary(sample.sampleHostingService(name)));
  }

  const known = hostingServicesCache;
  const build = (): ProductSummary[] =>
    names.map((name) => {
      const svc = known?.get(name);
      return svc ? hostingSummary(svc) : { id: name, offer: "…", status: "", ok: true };
    });

  const immediate = build();

  // Même compromis que pour les domaines : les noms tout de suite, les fiches
  // ensuite — `hostings_fetch` coûte un appel par hébergement.
  if (onEnrich && (!known || names.some((n) => !known.has(n)))) {
    void loadHostingServices()
      .then(() => onEnrich(build()))
      .catch(() => {
        // Naviguer ne demande que les noms : un échec ici n'est pas bloquant.
      });
  }

  return immediate;
}

/**
 * Les capacités d'une offre, mises en cache par code d'offre.
 *
 * La route est ouverte et ne dépend pas du compte : deux hébergements sur la
 * même offre partagent la réponse, et elle ne change pas d'une session à l'autre.
 */
const offerCapabilitiesCache = new Map<string, HostingCapabilities>();

export async function loadOfferCapabilities(
  offer: string,
): Promise<HostingCapabilities> {
  const cached = offerCapabilitiesCache.get(offer);
  if (cached) return cached;
  const capabilities =
    mode === "sample"
      ? sample.sampleOfferCapabilities(offer)
      : await hostingApi.offerCapabilities(offer);
  offerCapabilitiesCache.set(offer, capabilities);
  return capabilities;
}

/** Charge tout ce dont la page d'un hébergement a besoin, en parallèle. */
export async function loadHostingBundle(
  serviceName: string,
  options: { force?: boolean } = {},
): Promise<HostingBundle> {
  if (mode === "sample") {
    const bundle = sample.sampleHostingBundle(serviceName);
    hostingBundleCache.set(serviceName, bundle);
    return bundle;
  }

  const cached = hostingBundleCache.get(serviceName);
  if (cached && !options.force) return cached;

  const service = await hostingApi.get(serviceName);

  const errors: { part: string; message: string }[] = [];
  const settled = await Promise.allSettled([
    hostingApi.attachedDomains(serviceName),
    // Les capacités de l'offre partent avec le reste : elles décident de ce que
    // chaque onglet a le droit de proposer, et sans elles on laisserait l'API
    // répondre 400 sur une action que l'offre n'autorise pas.
    loadOfferCapabilities(service.offer),
    hostingApi.users(serviceName),
    hostingApi.databases(serviceName),
    hostingApi.crons(serviceName),
    hostingApi.envVars(serviceName),
    hostingApi.runtimes(serviceName),
    hostingApi.ssl(serviceName),
    hostingApi.tasks(serviceName),
  ] as const);

  function pick<T>(index: number, part: string, fallback: T): T {
    const r = settled[index];
    if (r.status === "fulfilled") return r.value as T;
    errors.push({ part, message: describeFailure(r.reason).message });
    return fallback;
  }

  const bundle: HostingBundle = {
    serviceName,
    service,
    attachedDomains: pick<AttachedDomain[]>(0, "multisites", []),
    // Capacités illisibles : on n'en fait pas une erreur d'écran. L'interface
    // propose alors tout, et l'API reste l'arbitre.
    capabilities:
      settled[1].status === "fulfilled"
        ? (settled[1].value as HostingCapabilities)
        : null,
    users: pick<HostingUser[]>(2, "utilisateurs FTP", []),
    databases: pick<Database[]>(3, "bases de données", []),
    dumps: {},
    crons: pick<Cron[]>(4, "tâches planifiées", []),
    envVars: pick<EnvVar[]>(5, "variables d'environnement", []),
    runtimes: pick<Runtime[]>(6, "configurations d'exécution", []),
    // Un hébergement sans certificat hébergé répond 404 : c'est une absence, pas
    // une panne, et elle ne mérite donc pas de message d'erreur à l'écran.
    ssl: settled[7].status === "fulfilled" ? (settled[7].value as HostingSsl) : null,
    tasks: pick<HostingTask[]>(8, "opérations", []),
    partialErrors: errors,
  };

  hostingBundleCache.set(serviceName, bundle);
  return bundle;
}

function patchHostingBundle(
  serviceName: string,
  patch: Partial<HostingBundle>,
): void {
  const cached = hostingBundleCache.get(serviceName);
  if (cached) hostingBundleCache.set(serviceName, { ...cached, ...patch });
}

/** Relit les seules tâches — appelé pendant le suivi d'une opération. */
export async function refreshHostingTasks(serviceName: string): Promise<HostingTask[]> {
  if (mode === "sample") {
    const tasks = sample.sampleHostingBundle(serviceName).tasks;
    patchHostingBundle(serviceName, { tasks });
    return tasks;
  }
  try {
    const tasks = await hostingApi.tasks(serviceName);
    patchHostingBundle(serviceName, { tasks });
    return tasks;
  } catch {
    return hostingBundleCache.get(serviceName)?.tasks ?? [];
  }
}

/**
 * Charge les sauvegardes d'une base, à la demande.
 *
 * Elles ne sont demandées qu'à l'ouverture du volet : `GET …/dump` ne rend que
 * des identifiants, et chaque sauvegarde coûte un appel de plus.
 */
export async function loadDatabaseDumps(
  serviceName: string,
  database: string,
): Promise<DatabaseDump[]> {
  const dumps =
    mode === "sample"
      ? sample.sampleDatabaseDumps(serviceName, database)
      : await hostingApi.databaseDumps(serviceName, database);
  const cached = hostingBundleCache.get(serviceName);
  if (cached) {
    hostingBundleCache.set(serviceName, {
      ...cached,
      dumps: { ...cached.dumps, [database]: dumps },
    });
  }
  return dumps;
}

/**
 * Les enregistrements d'adresse d'une zone : A, AAAA et CNAME.
 *
 * Ils servent deux fois dans l'écran d'hébergement : pour dire si un multisite
 * pointe réellement vers l'hébergement, et pour montrer ce que l'attachement va
 * écrire. Trois appels filtrés par `fieldType` couvrent toute la zone d'un coup
 * — bien moins que la zone entière, qui coûte un appel par enregistrement — et
 * le résultat est mis en cache par zone, parce qu'un tableau de multisites
 * interroge souvent la même.
 */
const zoneAddressCache = new Map<string, Record_[]>();

/** Ce qui est déjà en cache, sans déclencher d'appel. `null` = pas encore lu. */
export function cachedZoneAddresses(zone: string): Record_[] | null {
  return zoneAddressCache.get(zone) ?? null;
}

export async function loadZoneAddresses(zone: string): Promise<Record_[]> {
  const cached = zoneAddressCache.get(zone);
  if (cached) return cached;

  if (mode === "sample") {
    const records = sample.sampleZoneAddresses(zone);
    zoneAddressCache.set(zone, records);
    return records;
  }

  const settled = await Promise.allSettled(
    ["A", "AAAA", "CNAME"].map((fieldType) => api.recordsFetch(zone, { fieldType })),
  );
  const out: Record_[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") out.push(...r.value);
  }
  // Une lecture entièrement en échec n'est pas mise en cache : ce serait geler
  // « aucune adresse » alors qu'on n'a rien pu lire.
  if (settled.some((r) => r.status === "fulfilled")) zoneAddressCache.set(zone, out);
  return out;
}

// ===========================================================================
// Hébergement web — écriture
//
// Toutes ces écritures rendent une **tâche**, pas un résultat : l'appelant doit
// lancer le suivi. Et contrairement aux tâches de domaine, aucune ne s'annule.
// ===========================================================================

export async function createAttachedDomain(
  serviceName: string,
  payload: AttachedDomain,
): Promise<HostingTask> {
  const task =
    mode === "sample"
      ? sample.sampleCreateAttachedDomain(serviceName, payload)
      : await hostingApi.attachedDomainCreate(serviceName, payload);
  invalidateHosting(serviceName);
  // Attacher un domaine sans `bypassDNSConfiguration` fait écrire l'API dans la
  // zone : ce qui est en cache pour ce domaine ne vaut plus rien.
  if (payload.domain) invalidateZoneOf(payload.domain);
  return task;
}

export async function updateAttachedDomain(
  serviceName: string,
  domain: string,
  payload: AttachedDomain,
): Promise<void> {
  if (mode === "sample") sample.sampleUpdateAttachedDomain(serviceName, domain, payload);
  else await hostingApi.attachedDomainUpdate(serviceName, domain, payload);
  invalidateHosting(serviceName);
  invalidateZoneOf(domain);
}

export async function deleteAttachedDomain(
  serviceName: string,
  domain: string,
): Promise<HostingTask> {
  const task =
    mode === "sample"
      ? sample.sampleDeleteAttachedDomain(serviceName, domain)
      : await hostingApi.attachedDomainDelete(serviceName, domain);
  invalidateHosting(serviceName);
  return task;
}

/**
 * Vide le cache de la zone qui porte ce domaine, quand elle est dans le compte.
 *
 * Une écriture de multisite peut modifier une zone DNS affichée dans une autre
 * famille : laisser son cache en place ferait mentir l'onglet Zone DNS.
 */
function invalidateZoneOf(domain: string): void {
  const name = domain.toLowerCase().replace(/\.$/, "");
  for (const zone of bundleCache.keys()) {
    if (name === zone || name.endsWith(`.${zone}`)) invalidateDomain(zone);
  }
  for (const zone of [...zoneAddressCache.keys()]) {
    if (name === zone || name.endsWith(`.${zone}`)) zoneAddressCache.delete(zone);
  }
}

export async function createHostingUser(
  serviceName: string,
  payload: HostingUserCreate,
): Promise<HostingTask> {
  const task =
    mode === "sample"
      ? sample.sampleCreateHostingUser(serviceName, payload)
      : await hostingApi.userCreate(serviceName, payload);
  invalidateHosting(serviceName);
  return task;
}

/**
 * Modifie un utilisateur FTP. `state` et `sshState` sont **deux notions
 * distinctes** — « le compte est-il ouvert » et « a-t-il droit au shell » — et
 * l'API prend l'objet entier : les deux partent ensemble, ce qui impose de
 * renvoyer la valeur courante de celui qu'on ne change pas.
 */
export async function updateHostingUser(
  serviceName: string,
  user: HostingUser,
): Promise<void> {
  if (mode === "sample") sample.sampleUpdateHostingUser(serviceName, user);
  else await hostingApi.userUpdate(serviceName, user.login, user);
  invalidateHosting(serviceName);
}

/**
 * Remplace le mot de passe d'un utilisateur FTP.
 *
 * Il n'existe nulle part dans le modèle : il se pose, il ne se relit pas.
 * L'appelant est donc le dernier à connaître la valeur — d'où l'affichage unique
 * côté interface, comme pour DynHost.
 */
export async function changeHostingUserPassword(
  serviceName: string,
  login: string,
  password: string,
): Promise<HostingTask> {
  const task =
    mode === "sample"
      ? sample.sampleChangeHostingUserPassword(serviceName, login)
      : await hostingApi.userChangePassword(serviceName, login, password);
  invalidateHosting(serviceName);
  return task;
}

export async function deleteHostingUser(
  serviceName: string,
  login: string,
): Promise<HostingTask> {
  const task =
    mode === "sample"
      ? sample.sampleDeleteHostingUser(serviceName, login)
      : await hostingApi.userDelete(serviceName, login);
  invalidateHosting(serviceName);
  return task;
}

export async function createDatabaseDump(
  serviceName: string,
  database: string,
): Promise<HostingTask> {
  const task =
    mode === "sample"
      ? sample.sampleCreateDatabaseDump(serviceName, database)
      : await hostingApi.databaseDumpCreate(serviceName, database);
  invalidateHosting(serviceName);
  return task;
}

export async function createCron(
  serviceName: string,
  payload: CronInput,
): Promise<HostingTask> {
  const task =
    mode === "sample"
      ? sample.sampleCreateCron(serviceName, payload)
      : await hostingApi.cronCreate(serviceName, payload);
  invalidateHosting(serviceName);
  return task;
}

export async function deleteCron(
  serviceName: string,
  id: number,
): Promise<HostingTask> {
  const task =
    mode === "sample"
      ? sample.sampleDeleteCron(serviceName, id)
      : await hostingApi.cronDelete(serviceName, id);
  invalidateHosting(serviceName);
  return task;
}

/**
 * Crée une variable d'environnement. `kind` est le `type` déclaré (`string`,
 * `integer`, `password`) — le mot `type` est réservé côté commande Tauri.
 *
 * La valeur est typée `password` par l'API **quel que soit** ce `kind` : elle ne
 * se relit jamais, et l'interface ne doit donc jamais prétendre le contraire.
 */
export async function createEnvVar(
  serviceName: string,
  key: string,
  value: string,
  kind: string,
): Promise<HostingTask> {
  const task =
    mode === "sample"
      ? sample.sampleCreateEnvVar(serviceName, key, kind)
      : await hostingApi.envVarCreate(serviceName, key, value, kind);
  invalidateHosting(serviceName);
  return task;
}

export async function deleteEnvVar(
  serviceName: string,
  key: string,
): Promise<HostingTask> {
  const task =
    mode === "sample"
      ? sample.sampleDeleteEnvVar(serviceName, key)
      : await hostingApi.envVarDelete(serviceName, key);
  invalidateHosting(serviceName);
  return task;
}

/**
 * Index des adresses d'hébergement, pour relier un enregistrement DNS à
 * l'hébergement qu'il sert.
 *
 * Clés : l'IPv4, l'IPv6 et le nom du service, en minuscules — un enregistrement
 * peut pointer par IP (A, AAAA) ou par nom (CNAME). Sans cet index, lire
 * `203.0.113.10` dans une zone ne dit rien de l'hébergement qui répond derrière.
 *
 * Un échec rend un index vide : le lien disparaît, rien ne casse.
 */
export type HostingAddressIndex = Map<string, { serviceName: string; title: string }>;

let hostingAddressIndex: HostingAddressIndex | null = null;

export async function loadHostingAddressIndex(): Promise<HostingAddressIndex> {
  if (hostingAddressIndex) return hostingAddressIndex;

  const index: HostingAddressIndex = new Map();
  try {
    const services =
      mode === "sample"
        ? sample.sampleHostingNames().map((n) => sample.sampleHostingService(n))
        : [...(await loadHostingServices()).values()];
    for (const service of services) {
      const entry = { serviceName: service.serviceName, title: hostingTitle(service) };
      for (const key of [service.hostingIp, service.hostingIpv6, service.serviceName]) {
        if (key) index.set(key.toLowerCase(), entry);
      }
      for (const country of service.countriesIp ?? []) {
        for (const key of [country.ip, country.ipv6]) {
          if (key) index.set(key.toLowerCase(), entry);
        }
      }
    }
  } catch {
    // Pas de droit sur `/hosting/web`, ou aucun hébergement : le lien ne
    // s'affiche pas, et la zone reste parfaitement lisible sans lui.
  }
  hostingAddressIndex = index;
  return index;
}

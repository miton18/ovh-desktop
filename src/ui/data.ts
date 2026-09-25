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
} from "../ovh-api";
import type { IconName } from "./icons";
import {
  domainStateLabel,
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
 * En mode normal, seuls les domaines existent : le backend n'expose que
 * `/domain`. Les quatre autres familles de la maquette n'apparaissent qu'en mode
 * « données d'exemple », marquées `live: false`.
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
  if (section === "domains") return null;
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

/**
 * Publie la zone : ce qui a été écrit devient ce qui est servi.
 *
 * Sans cet appel, les enregistrements existent côté API mais ne répondent pas —
 * c'est le second temps du modèle d'OVHcloud, pas une invention d'ici.
 */
export async function publishZone(zone: string): Promise<void> {
  if (mode === "sample") sample.sampleRefreshZone(zone);
  else await api.zoneRefresh(zone);
  invalidateDomain(zone);
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

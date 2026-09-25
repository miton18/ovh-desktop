/**
 * État de la page domaine, et les calculs qui en découlent.
 *
 * Tout ce qui est local à l'écran vit ici : l'éditeur ouvert, les filtres, les
 * formulaires. Rien de tout ça ne va à l'API — les appels passent par
 * `../data.ts`.
 */

import type { Record_ } from "../../ovh-api";
import type { DomainBundle } from "../data";
import { TXT_ALIASES } from "../labels";

// ---------------------------------------------------------------------------
// Lignes de la zone
// ---------------------------------------------------------------------------

/**
 * Une modification décidée mais pas encore envoyée.
 *
 * Le brouillon est côté interface parce que l'API n'en a pas : une écriture
 * d'enregistrement s'applique tout de suite, et n'est servie qu'après un
 * `zoneRefresh`. Accumuler puis publier d'un coup évite de laisser la zone dans
 * un état intermédiaire que personne n'a demandé, et rend « Tout annuler »
 * réellement possible.
 */
/** L'éditeur d'un enregistrement, ouvert en ligne dans le tableau. */
export type RecordEditor = {
  /** Identifiant API, `null` pour une création. */
  id: number | null;
  /** Identifiant local d'une création déjà au brouillon, `null` sinon. */
  tempId: string | null;
  subDomain: string;
  fieldType: string;
  /** Saisi en texte : vide signifie « TTL de la zone ». */
  ttl: string;
  target: string;
  /** Type au chargement, pour l'avertissement « le type ne se modifie pas ». */
  originalType: string | null;
  /** L'utilisateur a demandé à changer le type malgré l'avertissement. */
  changingType: boolean;
};

export type NsEditor = {
  step: "edit" | "confirm";
  /** Un champ par serveur ; la liste envoyée remplace toute la configuration. */
  hosts: string[];
};

export type ContactRole = "admin" | "tech" | "billing";

/**
 * Ce qu'il faut afficher une fois, après avoir posé un mot de passe DynHost.
 *
 * L'API ne rend jamais un mot de passe : `dynhostLoginCreate` et
 * `dynhostLoginChangePassword` le prennent, rien ne le relit. L'interface est
 * donc le dernier endroit où la valeur existe, et le panneau de révélation est
 * la seule occasion de la noter. D'où le stockage en mémoire, jamais persisté.
 */
export type DynHostReveal = {
  login: string;
  /** Sous-domaine autorisé ; `*` signifie toute la zone. */
  subDomain: string;
  password: string;
  /** Création, par opposition à un remplacement sur un identifiant existant. */
  isNew: boolean;
};

/** Minimum imposé par l'API pour un mot de passe DynHost. */
export const DYNHOST_PASSWORD_MIN = 8;

/**
 * Un mot de passe tiré au hasard, en évitant les caractères qu'on confond en le
 * recopiant à la main (`0`/`O`, `1`/`l`/`I`) : ce mot de passe finit dans le
 * champ d'un routeur, souvent tapé depuis un bout de papier.
 */
export function generatePassword(length = 16): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const draws = new Uint32Array(length);
  crypto.getRandomValues(draws);
  return [...draws].map((n) => alphabet[n % alphabet.length]).join("");
}

export type DomainTab = "zone" | "registry" | "contacts" | "ops";

export type DomainViewState = {
  tab: DomainTab;
  editor: RecordEditor | null;
  /** Filtre par type d'enregistrement ; vide = tous. */
  filterType: string;
  filterQuery: string;
  ns: NsEditor | null;
  nsBusy: boolean;
  dyn: { suffix: string; subDomain: string; password: string };
  /** Le mot de passe qui vient d'être posé, affiché une fois puis oublié. */
  dynReveal: DynHostReveal | null;
  /** Le formulaire de remplacement ouvert sur un identifiant, s'il y en a un. */
  dynPassword: { login: string; value: string } | null;
  /**
   * Les identifiants dont le mot de passe a été posé pendant cette session.
   * L'API ne dit pas quand un mot de passe a été défini : on n'affiche donc une
   * date que là où on la connaît vraiment, plutôt que d'en inventer une.
   */
  dynPasswordSetAt: Map<string, string>;
  glue: { host: string; ips: string };
  contactEdit: { role: ContactRole; value: string } | null;
  /** Clés des actions en cours, pour désactiver leur bouton sans tout figer. */
  busy: Set<string>;
  publishing: boolean;
  /**
   * Une écriture a réussi mais sa publication a échoué.
   *
   * Uniquement ce cas-là : chaque écriture publie la zone dans la foulée, parce
   * que rien dans l'API ne permettrait de savoir, au chargement suivant, qu'une
   * publication reste due. `isDeployed` décrit la santé de la zone, et ni
   * `lastUpdate` ni le serial SOA ne sont exploitables sans mémoriser une
   * référence. Ce drapeau ne survit donc volontairement pas à un rechargement :
   * il ne couvre qu'un échec visible à l'écran, tout de suite.
   */
  publishPending: boolean;
};

export function createDomainViewState(): DomainViewState {
  return {
    tab: "zone",
    editor: null,
    filterType: "",
    filterQuery: "",
    ns: null,
    nsBusy: false,
    dyn: { suffix: "", subDomain: "", password: "" },
    dynReveal: null,
    dynPassword: null,
    dynPasswordSetAt: new Map(),
    glue: { host: "", ips: "" },
    contactEdit: null,
    busy: new Set(),
    publishing: false,
    publishPending: false,
  };
}


// ---------------------------------------------------------------------------
// Lignes affichées du tableau de zone
// ---------------------------------------------------------------------------

export type ZoneRowState = "" | "new" | "mod" | "del" | "dyn";

export type ZoneRow = {
  key: string;
  /** Identifiant API, `null` pour une création pas encore envoyée. */
  id: number | null;
  tempId: string | null;
  subDomain: string | null;
  fieldType: string;
  ttl: number | null;
  target: string;
  state: ZoneRowState;
  /** Version publiée, pour proposer « revenir à la version publiée ». */
  published: Record_ | null;
};

/**
 * Compose ce que le tableau montre : les enregistrements publiés, modifiés par
 * les enregistrements DynHost, marqués comme tels.
 */
export function computeZoneRows(bundle: DomainBundle): ZoneRow[] {
  const rows: ZoneRow[] = bundle.records.map((r) => ({
    key: `r${r.id}`,
    id: r.id,
    tempId: null,
    subDomain: r.subDomain,
    fieldType: r.fieldType,
    ttl: r.ttl,
    target: r.target,
    state: "" as ZoneRowState,
    published: r,
  }));

  // Les enregistrements DynHost vivent dans un espace séparé de l'API : ils
  // n'apparaissent pas dans `/record` et ne se modifient pas ici, d'où l'état
  // « dyn » qui les marque et verrouille leurs actions.
  const dyn: ZoneRow[] = bundle.dynHostRecords.map((d) => ({
    key: `dyn${d.id}`,
    id: d.id,
    tempId: null,
    subDomain: d.subDomain,
    fieldType: "A",
    ttl: d.ttl,
    target: d.ip,
    state: "dyn" as ZoneRowState,
    published: null,
  }));

  return [...rows, ...dyn];
}

export function filterZoneRows(rows: ZoneRow[], state: DomainViewState): ZoneRow[] {
  const q = state.filterQuery.trim().toLowerCase();
  return rows.filter((r) => {
    if (state.filterType && r.fieldType !== state.filterType) return false;
    if (!q) return true;
    const sub = (r.subDomain || "@").toLowerCase();
    return sub.includes(q) || r.target.toLowerCase().includes(q);
  });
}

/** Les compteurs des puces de filtre, dans l'ordre alphabétique des types. */
export function countByType(rows: ZoneRow[]): { type: string; n: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.fieldType, (counts.get(r.fieldType) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([type, n]) => ({ type, n }));
}



// ---------------------------------------------------------------------------
// Mutations du brouillon
// ---------------------------------------------------------------------------






// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+\.?$/;
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const NIC_RE = /^[a-z]{2,}\d+-ovh$/i;

export function isValidHost(host: string): boolean {
  return HOST_RE.test(host.trim().toLowerCase());
}

export function isValidIpv4(value: string): boolean {
  if (!IPV4_RE.test(value)) return false;
  return value.split(".").every((part) => Number(part) <= 255);
}

export function looksLikeIpv6(value: string): boolean {
  return value.includes(":");
}

export function isValidNicHandle(value: string): boolean {
  return NIC_RE.test(value.trim());
}

/**
 * Le message d'erreur d'un éditeur d'enregistrement, ou `""` si tout va bien.
 *
 * On ne valide que ce qui est vérifiable sans réseau et sans ambiguïté : un TTL
 * qui n'est pas une durée, une cible qui n'est manifestement pas du bon type.
 * Le reste est arbitré par l'API, qui a le dernier mot.
 */
export function recordEditorError(editor: RecordEditor): string {
  const target = editor.target.trim();
  if (!target) return "";

  const ttl = editor.ttl.trim();
  if (ttl && (!/^\d+$/.test(ttl) || Number(ttl) < 60)) {
    return "Le TTL est une durée en secondes, 60 au minimum.";
  }

  const type = editor.fieldType;
  if (type === "A" && !isValidIpv4(target)) {
    return "Un enregistrement A attend une adresse IPv4.";
  }
  if (type === "AAAA" && !looksLikeIpv6(target)) {
    return "Un enregistrement AAAA attend une adresse IPv6.";
  }
  return "";
}

export function editorIsSubmittable(editor: RecordEditor): boolean {
  return editor.target.trim().length > 0 && recordEditorError(editor) === "";
}

/** Le TTL saisi, converti pour l'API. `null` signifie « TTL de la zone ». */
export function parsedTtl(editor: RecordEditor): number | null {
  const ttl = editor.ttl.trim();
  return ttl ? Number(ttl) : null;
}

/** Le sous-domaine saisi, converti pour l'API. `@` et vide valent la racine. */
export function parsedSubDomain(editor: RecordEditor): string | null {
  const sub = editor.subDomain.trim();
  return sub === "" || sub === "@" ? null : sub;
}

/**
 * Le type de confort OVH derrière un TXT, deviné à partir de la cible.
 *
 * L'API rend un `TXT` pour un enregistrement créé en `SPF`, `DKIM` ou `DMARC` :
 * l'information du type d'origine est perdue. Cette lecture de la cible la
 * restitue pour l'affichage — elle n'est jamais renvoyée à l'API.
 */
export function txtFlavour(row: { fieldType: string; target: string }): string | null {
  if (row.fieldType !== "TXT") return null;
  const value = row.target.replace(/^"|"$/g, "").trim().toLowerCase();
  if (value.startsWith("v=spf1")) return "SPF";
  if (value.startsWith("v=dmarc1")) return "DMARC";
  if (value.startsWith("v=dkim1")) return "DKIM";
  return null;
}

/** Le type à pré-sélectionner dans l'éditeur d'une ligne existante. */
export function editableTypeOf(row: { fieldType: string; target: string }): string {
  return txtFlavour(row) ?? row.fieldType;
}

/** `true` si le type choisi est un alias qui produira un TXT. */
export function isTxtAlias(type: string): boolean {
  return Boolean(TXT_ALIASES[type]);
}

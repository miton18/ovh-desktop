/**
 * Libellés français et formatage.
 *
 * Règle appliquée partout : une valeur d'enum inconnue est **affichée telle
 * quelle**, jamais remplacée par un vide ni écartée. L'API OVH gagne des valeurs
 * sans préavis ; le backend les conserve, l'interface doit les montrer.
 */

import { KNOWN_RECORD_TYPES } from "../ovh-api";
import type { IconName } from "./icons";

/** Cherche un libellé, et retombe sur la valeur brute si elle est inconnue. */
function labelOf(table: Record<string, string>, value: string): string {
  return table[value] ?? value;
}

// ---------------------------------------------------------------------------
// Domaine
// ---------------------------------------------------------------------------

const DOMAIN_STATE: Record<string, string> = {
  ok: "Actif",
  pending_create: "Création en cours",
  pending_installation: "Installation en cours",
  pending_incoming_transfer: "Transfert entrant",
  outgoing_transfer: "Transfert sortant",
  autorenew_in_progress: "Renouvellement en cours",
  autorenew_registry_in_progress: "Renouvellement au registre",
  pending_delete: "Suppression en cours",
  expired: "Expiré",
  restorable: "Restaurable",
  dispute: "Litige",
  registry_suspended: "Suspendu par le registre",
  technical_suspended: "Suspension technique",
  deleted: "Supprimé",
};

export function domainStateLabel(state: string): string {
  return labelOf(DOMAIN_STATE, state);
}

/** Un état qui ne demande aucune attention. */
export function isHealthyDomainState(state: string): boolean {
  return state === "ok";
}

const RENEWAL_STATE: Record<string, string> = {
  automatic_renew: "renouvellement automatique",
  manual_renew: "renouvellement manuel",
  cancellation_requested: "résiliation demandée",
  cancellation_complete: "résiliation effective",
  unpaid: "impayé",
};

export function renewalStateLabel(state: string): string {
  return labelOf(RENEWAL_STATE, state);
}

const NAME_SERVER_TYPE: Record<string, string> = {
  hosted: "DNS OVHcloud",
  anycast: "DNS Anycast",
  external: "DNS externe",
  dedicated: "DNS dédié",
  hosting: "DNS de l'hébergement",
  mixed: "configuration mixte",
  parking: "parking",
  hold: "en attente",
  empty: "aucun serveur",
};

export function nameServerTypeLabel(type: string): string {
  return labelOf(NAME_SERVER_TYPE, type);
}

const SUSPENSION_STATE: Record<string, string> = {
  not_suspended: "non suspendu",
  suspended: "suspendu",
};

export function suspensionStateLabel(state: string): string {
  return labelOf(SUSPENSION_STATE, state);
}

// ---------------------------------------------------------------------------
// Verrou de transfert
// ---------------------------------------------------------------------------

/**
 * Ce qu'un état binaire piloté par interrupteur doit dire à l'écran.
 *
 * `on` est la position de l'interrupteur, `actionable` dit si la bascule est
 * proposable, et `busy` distingue « une demande court chez le registre » de
 * « le registre ne propose pas ça » : les deux désactivent l'interrupteur, mais
 * seul le second doit l'éteindre visuellement.
 */
export type TogglePresentation = {
  label: string;
  description: string;
  on: boolean;
  actionable: boolean;
  busy: boolean;
};

export function lockPresentation(status: string): TogglePresentation {
  switch (status) {
    case "locked":
      return {
        label: "Activée",
        description: "Le domaine ne peut pas être transféré vers un autre registrar.",
        on: true,
        actionable: true,
        busy: false,
      };
    case "unlocked":
      return {
        label: "Désactivée",
        description: "Le domaine peut être transféré. À réactiver après un transfert.",
        on: false,
        actionable: true,
        busy: false,
      };
    // Pendant `locking`, l'interrupteur montre déjà la position demandée : c'est
    // celle vers laquelle le registre travaille, pas celle d'avant.
    case "locking":
      return {
        label: "Activation…",
        description: "Demande en cours au registre.",
        on: true,
        actionable: false,
        busy: true,
      };
    case "unlocking":
      return {
        label: "Désactivation…",
        description: "Demande en cours au registre.",
        on: false,
        actionable: false,
        busy: true,
      };
    case "unavailable":
      return {
        label: "Indisponible",
        description:
          "Le registre de cette extension ne propose pas de verrou de transfert.",
        on: false,
        actionable: false,
        busy: false,
      };
    default:
      // Valeur inconnue : on l'affiche brute et on ne propose rien.
      return {
        label: status,
        description: "État renvoyé par l'API et non reconnu par cette version.",
        on: false,
        actionable: false,
        busy: false,
      };
  }
}

/** Le libellé court d'un verrou, pour la carte de synthèse du domaine. */
export function lockShortLabel(status: string): string {
  return lockPresentation(status).label;
}

// ---------------------------------------------------------------------------
// DNSSEC
// ---------------------------------------------------------------------------

/**
 * Le statut DNSSEC **de la zone** (`ZoneDnssec.status`), qui est celui que
 * `domain.dnssecEnable` / `dnssecDisable` font bouger.
 *
 * Distinct de `DomainService.dnssecState`, qui décrit le DNSSEC déclaré au
 * registre : `supported` vient bien de la fiche du domaine, mais l'état affiché
 * et basculé est celui de la zone. Les deux valeurs `…InProgress` durent
 * plusieurs minutes côté registre — l'interrupteur se désactive alors, il ne se
 * repropose pas.
 */
export function dnssecPresentation(
  status: string,
  supported: boolean,
): TogglePresentation {
  if (!supported || status === "not_supported") {
    return {
      label: "Non supporté",
      description: "Le registre de cette extension n'accepte pas DNSSEC.",
      on: false,
      actionable: false,
      busy: false,
    };
  }
  switch (status) {
    case "enabled":
      return {
        label: "Activé",
        description: "Les réponses DNS de la zone sont signées.",
        on: true,
        actionable: true,
        busy: false,
      };
    case "disabled":
      return {
        label: "Désactivé",
        description: "Les réponses DNS ne sont pas signées.",
        on: false,
        actionable: true,
        busy: false,
      };
    case "enableInProgress":
      return {
        label: "Activation…",
        description:
          "Signature de la zone en cours, puis publication de la clé au registre.",
        on: true,
        actionable: false,
        busy: true,
      };
    case "disableInProgress":
      return {
        label: "Désactivation…",
        description: "Retrait de la clé au registre en cours.",
        on: false,
        actionable: false,
        busy: true,
      };
    default:
      return {
        label: status,
        description: "État renvoyé par l'API et non reconnu par cette version.",
        on: false,
        actionable: false,
        busy: false,
      };
  }
}

/** Le libellé court de DNSSEC, pour la carte de synthèse du domaine. */
export function dnssecShortLabel(status: string, supported: boolean): string {
  return dnssecPresentation(status, supported).label;
}

// ---------------------------------------------------------------------------
// Tâches
// ---------------------------------------------------------------------------

/**
 * Un état de tâche, avec sa couleur sémantique et son icône.
 *
 * Le vert et le rouge remplacent l'ancien contour neutre parce que « terminée »
 * et « échec » ne sont pas deux nuances de la même chose : la couleur doit se
 * lire avant le texte. `icon` est `null` pour `doing`, qui porte déjà l'anneau
 * qui tourne — deux marques de mouvement sur la même étiquette n'en valent pas
 * mieux qu'une.
 */
const TASK_STATUS: Record<
  string,
  [label: string, tagClass: string, icon: IconName | null]
> = {
  todo: ["Planifiée", "tag-pending", "clock"],
  doing: ["En cours", "tag-doing", null],
  done: ["Terminée", "tag-success", "check"],
  error: ["Échec", "tag-danger", "warning"],
  problem: ["Problème", "tag-danger", "warning"],
  cancelled: ["Annulée", "tag-muted", "x"],
};

export function taskStatusPresentation(status: string): {
  label: string;
  tagClass: string;
  icon: IconName | null;
  running: boolean;
} {
  const found = TASK_STATUS[status];
  return {
    label: found ? found[0] : status,
    tagClass: found ? found[1] : "tag-pending",
    icon: found ? found[2] : null,
    running: status === "doing",
  };
}

/**
 * Nom lisible d'une opération. Les fonctions de l'API sont en CamelCase et la
 * liste n'est pas figée : celles qu'on ne connaît pas sont désagrégées en mots
 * plutôt que masquées.
 */
const TASK_FUNCTION: Record<string, string> = {
  ZoneRefresh: "Publication de la zone",
  ZoneCreate: "Création de la zone",
  ZoneDelete: "Suppression de la zone",
  ZoneImport: "Import d'un fichier de zone",
  ZoneRestore: "Restauration de la zone",
  ZoneCheck: "Vérification de la zone",
  ZoneCut: "Découpe de la zone",
  DnssecEnable: "Activation DNSSEC",
  DnssecDisable: "Désactivation DNSSEC",
  DnssecResigning: "Resignature DNSSEC",
  DnssecRollKsk: "Rotation de la clé KSK",
  DnssecRollZsk: "Rotation de la clé ZSK",
  DnsAnycastActivate: "Activation du DNS Anycast",
  DnsAnycastDeactivate: "Désactivation du DNS Anycast",
  changeContact: "Changement de contact",
  DomainDnsUpdate: "Mise à jour des serveurs DNS",
  DomainRenew: "Renouvellement du domaine",
  DomainTransferLock: "Activation du verrou de transfert",
  DomainTransferUnlock: "Désactivation du verrou de transfert",
  DomainGlueRecordCreate: "Création d'un glue record",
  DomainGlueRecordUpdate: "Modification d'un glue record",
  DomainGlueRecordDelete: "Suppression d'un glue record",
};

export function taskFunctionLabel(fn: string): string {
  const known = TASK_FUNCTION[fn];
  if (known) return known;
  // `DomainSomethingElse` → « Domain something else », lisible et sans perte.
  const spaced = fn.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// ---------------------------------------------------------------------------
// Enregistrements DNS
// ---------------------------------------------------------------------------

/**
 * Exemples de cible, affichés en `placeholder`. Ils ne valident rien : ils
 * disent seulement à quoi ressemble une valeur correcte.
 */
const TARGET_HINTS: Record<string, string> = {
  A: "203.0.113.10",
  AAAA: "2001:db8::1",
  CAA: '0 issue "letsencrypt.org"',
  CNAME: "cible.exemple.fr.",
  DKIM: "v=DKIM1; k=rsa; p=MIIB…",
  DMARC: "v=DMARC1; p=quarantine",
  DNAME: "autre-zone.fr.",
  HTTPS: '1 . alpn="h2,h3"',
  LOC: "48 51 24.000 N 2 21 03.000 E 35m",
  MX: "10 mx.exemple.fr.",
  NAPTR: '100 10 "s" "SIP+D2U" "" _sip._udp.exemple.fr.',
  NS: "ns1.exemple.fr.",
  PTR: "hote.exemple.fr.",
  RP: "hostmaster.exemple.fr. .",
  SPF: "v=spf1 include:mx.ovh.com ~all",
  SRV: "10 5 443 cible.exemple.fr.",
  SSHFP: "1 1 a1b2c3…",
  SVCB: "1 cible.exemple.fr.",
  TLSA: "3 1 1 a1b2c3…",
  TXT: '"texte libre"',
};

export function targetHint(type: string): string {
  return TARGET_HINTS[type] ?? "";
}

/**
 * Les types de confort OVH : ils produisent un enregistrement TXT, avec une
 * saisie assistée. Ce qui revient de l'API est un TXT.
 */
export const TXT_ALIASES: Record<string, string> = {
  SPF: "TXT",
  DKIM: "TXT",
  DMARC: "TXT",
};

/** Les types proposés dans le menu : ceux du schéma, dans l'ordre du schéma. */
export function recordTypeOptions(): { value: string; label: string }[] {
  return KNOWN_RECORD_TYPES.map((value) => ({
    value,
    label: TXT_ALIASES[value] ? `${value} → TXT` : value,
  }));
}

// ---------------------------------------------------------------------------
// Durées et dates
// ---------------------------------------------------------------------------

/** Une durée en secondes, rendue lisible. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86400)} j`;
}

/** Une période de renouvellement, en mois. */
export function formatPeriod(months: number): string {
  if (months % 12 !== 0) return `${months} mois`;
  const years = months / 12;
  return `${years} an${years > 1 ? "s" : ""}`;
}

const MONTHS = [
  "janv.",
  "févr.",
  "mars",
  "avr.",
  "mai",
  "juin",
  "juil.",
  "août",
  "sept.",
  "oct.",
  "nov.",
  "déc.",
];

/**
 * Formate une date de l'API. Les scalaires datés restent des chaînes côté Rust
 * parce que l'API mélange les formats : la conversion échoue donc ici, au point
 * d'usage, et on rend alors la chaîne brute plutôt que « Invalid Date ».
 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${hh}:${mm}`;
}

/**
 * Une date récente exprimée en durée écoulée, et la date exacte pour le `title`.
 *
 * Utile là où l'on suit des opérations : « il y a 3 min » répond à la question
 * réellement posée, alors qu'un horodatage demande une soustraction mentale.
 * Passé 24 h, le repère relatif ne dit plus rien d'utile et on revient à la date
 * complète — `text` vaut alors la même chose que `title`.
 */
export function formatElapsed(value: string | null | undefined): {
  text: string;
  title: string;
} {
  const exact = formatDateTime(value);
  if (!value) return { text: exact, title: "" };
  const at = new Date(value).getTime();
  if (Number.isNaN(at)) return { text: exact, title: exact };

  const elapsed = Date.now() - at;
  if (elapsed < 0 || elapsed >= 86400000) return { text: exact, title: exact };

  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return { text: "à l'instant", title: exact };
  if (minutes < 60) return { text: `il y a ${minutes} min`, title: exact };
  return { text: `il y a ${Math.floor(minutes / 60)} h`, title: exact };
}

/** Nombre de jours d'ici à `value`, ou `null` si la date est illisible. */
export function daysUntil(value: string | null | undefined): number | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}

/** Les initiales d'un nom, pour la pastille du compte. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Accord du pluriel, cas simple. */
export function plural(n: number, singular: string, pluralForm?: string): string {
  return n > 1 ? (pluralForm ?? `${singular}s`) : singular;
}

// ---------------------------------------------------------------------------
// Hébergement web — états
// ---------------------------------------------------------------------------

/**
 * L'état d'un hébergement (`hosting.web.StateEnum`).
 *
 * L'API contient **deux orthographes pour la même chose** — `blocked`/`bloqued`,
 * `hardBlocked`/`hardBloqued`. Ce n'est pas une coquille d'ici : les deux
 * valeurs existent réellement dans le schéma, et un hébergement peut revenir
 * avec l'une ou l'autre. Les deux sont donc traitées.
 */
const HOSTING_STATE: Record<string, [label: string, tone: HostingTone]> = {
  active: ["Actif", "ok"],
  maintenance: ["Maintenance", "neutral"],
  blocked: ["Bloqué", "warn"],
  bloqued: ["Bloqué", "warn"],
  hardBlocked: ["Bloqué définitivement", "bad"],
  hardBloqued: ["Bloqué définitivement", "bad"],
};

export type HostingTone = "ok" | "neutral" | "warn" | "bad";

export function hostingStatePresentation(state: string): {
  label: string;
  tone: HostingTone;
  tagClass: string;
} {
  const found = HOSTING_STATE[state];
  const tone: HostingTone = found ? found[1] : "neutral";
  return {
    label: found ? found[0] : state,
    tone,
    tagClass:
      tone === "ok"
        ? "tag-state-ok"
        : tone === "neutral"
          ? "tag-neutral"
          : "tag-danger",
  };
}

/** Un hébergement dans cet état ne sert plus les sites. */
export function isBlockedHostingState(state: string): boolean {
  const tone = hostingStatePresentation(state).tone;
  return tone === "warn" || tone === "bad";
}

// ---------------------------------------------------------------------------
// Hébergement web — les trois orthographes de « PHP 8.0 »
// ---------------------------------------------------------------------------

/**
 * Le numéro de version contenu dans une chaîne de moteur d'exécution.
 *
 * L'API dit la même chose de trois façons selon la route : `8.0` dans
 * `Service.phpVersions`, `phpfpm-8.0` dans `runtime.type`, `php8.0` dans
 * `cron.language`. Ces chaînes ne se comparent donc **jamais** entre elles :
 * on en extrait la version, et c'est elle qui sert de clé.
 */
export function versionOf(raw: string | null | undefined): string | null {
  const found = /(\d+(?:\.\d+)?)/.exec(raw ?? "");
  return found ? found[1] : null;
}

/** `true` si la chaîne désigne un moteur PHP, quelle que soit son orthographe. */
export function isPhpRuntime(raw: string | null | undefined): boolean {
  const value = (raw ?? "").toLowerCase();
  return value.startsWith("php") || /^\d+\.\d+$/.test(value);
}

/**
 * Le libellé unique d'un moteur d'exécution, quelle que soit l'orthographe
 * reçue. Une valeur non reconnue est rendue telle quelle — l'API gagne des
 * langages sans préavis.
 */
export function runtimeLabel(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (!value) return "—";
  let m: RegExpExecArray | null;
  if ((m = /^(?:phpfpm-|php-?)(\d+(?:\.\d+)?)$/i.exec(value))) return `PHP ${m[1]}`;
  if (/^\d+\.\d+$/.test(value)) return `PHP ${value}`;
  if ((m = /^node(?:js)?-?(\d+(?:\.\d+)?)$/i.exec(value))) return `Node.js ${m[1]}`;
  if ((m = /^python-?(\d+(?:\.\d+)?)$/i.exec(value))) return `Python ${m[1]}`;
  if ((m = /^ruby-?(\d+(?:\.\d+)?)$/i.exec(value))) return `Ruby ${m[1]}`;
  if ((m = /^(?:static|html)$/i.exec(value))) return "Fichiers statiques";
  return value;
}

const PHP_SUPPORT: Record<string, string> = {
  stable: "stable",
  testing: "en test",
  beta: "bêta",
  security: "correctifs de sécurité seulement",
  deprecated: "dépréciée",
  "end-of-life": "en fin de vie",
};

export function phpSupportLabel(support: string): string {
  return labelOf(PHP_SUPPORT, support);
}

/**
 * `true` quand l'API dit elle-même que cette version n'est plus tenue.
 *
 * `security` n'en fait pas partie : une version qui reçoit encore les
 * correctifs de sécurité n'est pas périmée, et l'annoncer comme telle ferait
 * crier au loup.
 */
export function isEndOfLifeSupport(support: string): boolean {
  return support === "deprecated" || support === "end-of-life";
}

// ---------------------------------------------------------------------------
// Hébergement web — bases de données
// ---------------------------------------------------------------------------

const DB_ENGINE: Record<string, string> = {
  mysql: "MySQL",
  mariadb: "MariaDB",
  postgresql: "PostgreSQL",
  redis: "Redis",
  mongodb: "MongoDB",
};

export function dbEngineLabel(type: string): string {
  return labelOf(DB_ENGINE, type);
}

/** `database.StateEnum` — la santé de la base. */
const DB_STATE: Record<string, string> = {
  ok: "Opérationnelle",
  readonly: "Lecture seule",
  close: "Fermée",
};

export function dbStateLabel(state: string): string {
  return labelOf(DB_STATE, state);
}

/**
 * `database.StatusEnum` — l'opération en cours, distincte de la santé.
 *
 * `created` n'est pas « créée » : c'est « aucune opération en cours ». D'où le
 * `null` renvoyé, qui laisse la ligne muette au lieu d'afficher un état qui
 * n'en est pas un.
 */
const DB_STATUS: Record<string, string> = {
  creating: "Création en cours",
  deleting: "Suppression en cours",
  checking: "Vérification en cours",
  dumping: "Sauvegarde en cours",
  importing: "Import en cours",
  optimizing: "Optimisation en cours",
  restoring: "Restauration en cours",
  updating: "Mise à jour en cours",
  locked: "Verrouillée",
};

export function dbStatusLabel(status: string): string | null {
  if (status === "created") return null;
  return labelOf(DB_STATUS, status);
}

/** Une opération court sur cette base : rien d'autre ne doit lui être demandé. */
export function isDatabaseBusy(status: string): boolean {
  return status !== "created";
}

const DB_MODE: Record<string, string> = {
  classic: "Mode classique",
  besteffort: "Best effort",
  module: "Module",
};

export function dbModeLabel(mode: string): string {
  return labelOf(DB_MODE, mode);
}

const VERSION_SUPPORT: Record<string, string> = {
  stable: "stable",
  beta: "bêta",
  deprecated: "dépréciée",
};

export function versionSupportLabel(support: string): string {
  return labelOf(VERSION_SUPPORT, support);
}

/** Les trois types de sauvegarde que l'API propose, et rien d'autre. */
const DUMP_TYPE: Record<string, string> = {
  now: "Manuelle",
  "daily.1": "Quotidienne (J-1)",
  "weekly.1": "Hebdomadaire (S-1)",
};

export function dumpTypeLabel(type: string): string {
  return labelOf(DUMP_TYPE, type);
}

// ---------------------------------------------------------------------------
// Hébergement web — quotas
// ---------------------------------------------------------------------------

/**
 * Les unités de `complexType.UnitAndValue`, en octets.
 *
 * L'API mélange les unités d'un champ à l'autre : `quotaSize` peut être en `GB`
 * quand `quotaUsed` est en `MB`. Un pourcentage calculé sans convertir est faux
 * sans prévenir — c'est exactement le piège que cette table existe pour éviter.
 */
const BYTE_UNIT: Record<string, number> = {
  B: 1,
  o: 1,
  KB: 1024,
  MB: 1024 ** 2,
  GB: 1024 ** 3,
  TB: 1024 ** 4,
  PB: 1024 ** 5,
};

/** Convertit une valeur unitée en octets, ou `null` si l'unité est inconnue. */
export function toBytes(
  quota: { unit: string; value: number } | null | undefined,
): number | null {
  if (!quota) return null;
  const factor = BYTE_UNIT[quota.unit];
  // Unité non reconnue : mieux vaut ne rien tracer qu'une jauge fausse.
  if (factor === undefined) return null;
  return quota.value * factor;
}

const BYTE_STEPS: [label: string, size: number][] = [
  ["To", 1024 ** 4],
  ["Go", 1024 ** 3],
  ["Mo", 1024 ** 2],
  ["Ko", 1024],
];

/** Une taille en octets, rendue lisible avec la virgule décimale française. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  for (const [label, size] of BYTE_STEPS) {
    if (bytes >= size) {
      const n = bytes / size;
      const rounded = n >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
      return `${String(rounded).replace(".", ",")} ${label}`;
    }
  }
  return `${Math.round(bytes)} o`;
}

/**
 * Le pourcentage d'un quota, ou `null` quand il n'est pas calculable.
 *
 * Renvoyer `null` plutôt que `0` est volontaire : une jauge à zéro dit « rien
 * n'est consommé », ce qui est un mensonge quand la vérité est « on ne sait
 * pas ».
 */
export function quotaPercent(
  used: { unit: string; value: number } | null | undefined,
  size: { unit: string; value: number } | null | undefined,
): number | null {
  const u = toBytes(used);
  const s = toBytes(size);
  if (u === null || s === null || s <= 0) return null;
  return Math.min(100, (u / s) * 100);
}

/** Le seuil au-delà duquel un quota mérite d'être signalé. */
export const QUOTA_ALERT_PERCENT = 85;

// ---------------------------------------------------------------------------
// Hébergement web — pays servant une IP
// ---------------------------------------------------------------------------

/**
 * Les 14 pays de `hosting.web.CountryEnum`. La liste sert à nommer un code ;
 * les IP réellement disponibles viennent de `Service.countriesIp`, jamais
 * d'ici.
 */
const IP_COUNTRY: Record<string, string> = {
  FR: "France",
  BE: "Belgique",
  CA: "Canada",
  CZ: "Tchéquie",
  DE: "Allemagne",
  ES: "Espagne",
  FI: "Finlande",
  GB: "Royaume-Uni",
  IE: "Irlande",
  IT: "Italie",
  LT: "Lituanie",
  NL: "Pays-Bas",
  PL: "Pologne",
  PT: "Portugal",
};

export function ipCountryLabel(code: string): string {
  return labelOf(IP_COUNTRY, code);
}

export function ipCountryCodes(): string[] {
  return Object.keys(IP_COUNTRY);
}

// ---------------------------------------------------------------------------
// Hébergement web — utilisateurs FTP & SSH
// ---------------------------------------------------------------------------

/** `user.SshStateEnum` — distinct de `state`, qui dit si le compte est ouvert. */
const SSH_STATE: Record<string, [label: string, note: string]> = {
  active: ["SSH", "Shell complet et SFTP"],
  sftponly: ["SFTP", "Transfert chiffré, sans shell"],
  none: ["Aucun", "FTP uniquement"],
};

export function sshStatePresentation(state: string): { label: string; note: string } {
  const found = SSH_STATE[state];
  return found
    ? { label: found[0], note: found[1] }
    : { label: state, note: "Valeur renvoyée par l'API et non reconnue." };
}

// ---------------------------------------------------------------------------
// Hébergement web — tâches
// ---------------------------------------------------------------------------

/**
 * `hosting.web.task.FunctionEnum` compte près de 190 valeurs de la forme
 * `objet/action`. Les traduire une à une serait une table à maintenir contre
 * une API qui bouge : on traduit les deux moitiés séparément, et une moitié
 * inconnue passe telle quelle.
 */
const HOSTING_TASK_OBJECT: Record<string, string> = {
  attachedDomain: "Multisite",
  boostOffer: "Montée en puissance",
  cdn: "CDN",
  cron: "Tâche planifiée",
  database: "Base de données",
  dump: "Sauvegarde",
  envVar: "Variable d'environnement",
  filer: "Filer",
  hosting: "Hébergement",
  indy: "Base privée",
  localSeo: "Référencement local",
  module: "Module",
  ovhConfig: "Fichier .ovhconfig",
  runtime: "Configuration d'exécution",
  ssl: "Certificat SSL",
  user: "Utilisateur FTP",
  web: "Hébergement",
};

const HOSTING_TASK_VERB: Record<string, string> = {
  changePassword: "nouveau mot de passe",
  check: "vérification",
  create: "création",
  delete: "suppression",
  dump: "sauvegarde",
  import: "import",
  optimize: "optimisation",
  rebuild: "reconstruction",
  regenerate: "régénération",
  restore: "restauration",
  update: "modification",
};

export function hostingTaskLabel(fn: string): string {
  const [object, verb] = (fn || "").split("/");
  const left = HOSTING_TASK_OBJECT[object] ?? spaced(object);
  if (!verb) return left;
  return `${left} · ${HOSTING_TASK_VERB[verb] ?? spaced(verb).toLowerCase()}`;
}

/** `attachedDomain` → « Attached domain » : lisible, et sans rien perdre. */
function spaced(value: string): string {
  const out = (value || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ");
  return out.charAt(0).toUpperCase() + out.slice(1);
}

// ---------------------------------------------------------------------------
// Hébergement web — fréquence d'un cron
// ---------------------------------------------------------------------------

const CRON_FIELD = /^(\*|\d+(-\d+)?)(\/\d+)?(,(\*|\d+(-\d+)?)(\/\d+)?)*$/;
const CRON_DAYS = [
  "dimanche",
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
];

/**
 * Traduit une expression crontab en français, ou rend `null` si elle est
 * invalide.
 *
 * `Cron.frequency` est une **chaîne brute** que l'API ne valide pas : sans
 * cette relecture, on planifie à l'aveugle. Les planifications qu'on ne sait
 * pas nommer ne sont pas rejetées pour autant — elles sont seulement dites
 * « personnalisée ».
 */
export function cronDescription(frequency: string): string | null {
  const parts = (frequency || "").trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const max = [59, 23, 31, 12, 7];
  for (const [i, part] of parts.entries()) {
    if (!CRON_FIELD.test(part)) return null;
    for (const n of part.match(/\d+/g) ?? []) {
      if (Number(n) > max[i]) return null;
    }
  }

  const [mi, ho, dm, mo, dw] = parts;
  const isNum = (x: string): boolean => /^\d+$/.test(x);
  let m: RegExpExecArray | null;

  if (dm === "*" && mo === "*" && dw === "*") {
    if ((m = /^\*\/(\d+)$/.exec(mi)) && ho === "*") return `Toutes les ${m[1]} minutes`;
    if (mi === "*" && ho === "*") return "Chaque minute";
    if (isNum(mi) && ho === "*") return `Toutes les heures, à la minute ${mi}`;
    if (isNum(mi) && (m = /^\*\/(\d+)$/.exec(ho))) return `Toutes les ${m[1]} heures`;
  }
  if (isNum(mi) && isNum(ho)) {
    const at = `${ho.padStart(2, "0")}:${mi.padStart(2, "0")}`;
    if (dm === "*" && mo === "*" && dw === "*") return `Tous les jours à ${at}`;
    if (dm === "*" && mo === "*" && /^[0-7]$/.test(dw)) {
      return `Chaque ${CRON_DAYS[Number(dw) % 7]} à ${at}`;
    }
    if (isNum(dm) && mo === "*" && dw === "*") {
      return `Le ${dm} de chaque mois à ${at}`;
    }
  }
  return "Planification personnalisée";
}

// ---------------------------------------------------------------------------
// Hébergement web — ce que l'offre autorise
// ---------------------------------------------------------------------------

/**
 * Au-delà de ce seuil, un compteur de capacité ne dit plus une limite mais
 * « sans limite pratique ». L'API renvoie `1000000` pour ça : afficher
 * « 2 / 1 000 000 » ne renseignerait personne.
 */
export const CAPABILITY_UNLIMITED = 100000;

/**
 * « 2 sur 3 », « 2 » quand la limite n'apporte rien, « aucun » à zéro.
 *
 * Les compteurs de `HostingCapabilities` sont des **limites**, pas des
 * booléens : `attachedDomains: 1` veut dire qu'un second domaine sera refusé, et
 * c'est ce qu'il faut montrer avant d'essayer.
 */
export function formatCapacity(used: number, limit: number | null): string {
  if (limit === null) return String(used);
  if (limit === 0) return "aucun autorisé";
  if (limit < 0 || limit >= CAPABILITY_UNLIMITED) return String(used);
  return `${used} sur ${limit}`;
}

/** La limite sous forme lisible, pour une phrase. `null` = non connue. */
export function formatLimit(limit: number | null): string {
  if (limit === null) return "non renseignée";
  if (limit === 0) return "aucun";
  if (limit < 0 || limit >= CAPABILITY_UNLIMITED) return "sans limite";
  return String(limit);
}

/**
 * Rend lisible un refus de l'API.
 *
 * Une offre qui n'autorise pas une action répond `400 … this account is not
 * allowed to create EnvVar`. La capacité est pourtant connue d'avance, donc ce
 * message ne devrait plus apparaître — mais s'il apparaît, il vaut mieux une
 * phrase qu'un morceau d'anglais technique. Le message brut est conservé en
 * queue : c'est lui qui sert à comprendre un cas non prévu.
 */
const REFUSED_OBJECT: Record<string, string> = {
  envvar: "les variables d'environnement",
  cron: "les tâches planifiées",
  user: "les comptes FTP supplémentaires",
  attacheddomain: "les multisites",
  database: "les bases de données",
  runtime: "les configurations d'exécution",
};

export function hostingRefusalMessage(raw: string): string {
  const found = /not allowed to (?:create|add|update|delete)\s+(\w+)/i.exec(raw);
  if (!found) return raw;
  const what = REFUSED_OBJECT[found[1].toLowerCase()] ?? found[1];
  return `Cette offre d'hébergement n'autorise pas ${what}. (${raw})`;
}

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

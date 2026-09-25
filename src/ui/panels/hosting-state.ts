/**
 * État local de la page d'un hébergement, et les calculs qui en découlent.
 *
 * Rien ici ne parle à l'API : les appels passent par `../data.ts`. Ce module
 * porte les formulaires ouverts, les volets dépliés, et les validations qu'on
 * peut faire sans réseau — l'API du multisite, elle, n'en impose aucune : tous
 * les champs d'`AttachedDomain` sont nullables, `domain` et `path` compris.
 */

import {
  capabilityAllows,
  isTerminalHostingStatus,
  type AttachedDomain,
  type HostingCapabilities,
  type HostingService,
  type Record_,
  type Runtime,
} from "../../ovh-api";
import type { HostingBundle } from "../data";
import {
  CAPABILITY_UNLIMITED,
  hostingTaskLabel,
  isEndOfLifeSupport,
  isPhpRuntime,
  versionOf,
} from "../labels";

export type HostingTab = "sites" | "users" | "db" | "exec" | "cron" | "ops";

// ---------------------------------------------------------------------------
// Multisite
// ---------------------------------------------------------------------------

/**
 * L'aperçu de ce qui va arriver à la zone DNS, chargé au moment de confirmer.
 *
 * Il n'est pas chargé pendant la saisie : il faut le domaine complet pour savoir
 * de quelle zone on parle, et une lecture par frappe n'apprendrait rien de plus.
 */
export type DnsPreview = {
  /** La zone du compte qui porte ce domaine, `null` si elle est ailleurs. */
  zone: string | null;
  subDomain: string | null;
  /** Les A, AAAA et CNAME déjà en place sur ce sous-domaine. */
  existing: Record_[];
  error: string | null;
};

/**
 * Le formulaire d'un multisite, en deux temps.
 *
 * Le second temps n'est pas une politesse : attacher un domaine **écrit dans la
 * zone DNS** quand `bypassDNSConfiguration` n'est pas `true`, et cette écriture
 * a lieu dans une autre section de l'API, visible dans un autre écran. Elle doit
 * être annoncée avant, pas découverte après.
 */
export type SiteForm = {
  mode: "new" | "edit";
  step: "edit" | "confirm";
  /** Le domaine tel que l'API le connaît — la clé de la route de modification. */
  original: string | null;
  /** Localisation d'origine : c'est son changement qui rouvre le DNS. */
  originalLocation: string | null;
  domain: string;
  path: string;
  runtimeId: number | null;
  ipLocation: string;
  ownLog: string;
  ssl: boolean;
  firewall: boolean;
  cdn: boolean;
  /** Coché : l'API ne touche pas à la zone DNS du domaine. */
  bypass: boolean;
  dns: DnsPreview | null;
  dnsLoading: boolean;
};

/** Ce qu'il faut afficher une fois, après avoir posé un mot de passe. */
export type HostingReveal = {
  title: string;
  rows: { k: string; v: string; copy: string }[];
};

export type HostingViewState = {
  tab: HostingTab;
  site: SiteForm | null;
  /** Le domaine dont le détachement attend une confirmation. */
  siteDelete: string | null;
  userForm: {
    open: boolean;
    suffix: string;
    home: string;
    sshState: string;
    password: string;
  };
  /** Le formulaire de remplacement de mot de passe ouvert sur un login. */
  userPassword: { login: string; value: string } | null;
  /** Le mot de passe qui vient d'être posé, affiché une fois puis oublié. */
  reveal: HostingReveal | null;
  /**
   * Les comptes dont le mot de passe a été posé pendant cette session.
   *
   * L'API n'expose aucune date de dernier changement : on n'affiche donc une
   * heure que là où on la connaît vraiment, plutôt que d'en inventer une.
   */
  passwordSetAt: Map<string, string>;
  /**
   * Les zones dont la lecture d'adresses a déjà été tentée.
   *
   * `loadZoneAddresses` ne met volontairement pas un échec en cache : sans cette
   * mémoire, une zone illisible relancerait un appel à chaque redessin.
   */
  zonesAttempted: Set<string>;
  /** Les bases dont le volet des sauvegardes est ouvert. */
  dbOpen: Set<string>;
  dbLoading: Set<string>;
  envForm: { open: boolean; key: string; kind: string; value: string };
  cronForm: {
    open: boolean;
    command: string;
    frequency: string;
    language: string;
    description: string;
    email: string;
  };
  /** Clés des actions en cours, pour désactiver leur bouton sans tout figer. */
  busy: Set<string>;
};

export function createHostingViewState(): HostingViewState {
  return {
    tab: "sites",
    site: null,
    siteDelete: null,
    userForm: { open: false, suffix: "", home: "", sshState: "sftponly", password: "" },
    userPassword: null,
    reveal: null,
    passwordSetAt: new Map(),
    zonesAttempted: new Set(),
    dbOpen: new Set(),
    dbLoading: new Set(),
    envForm: { open: false, key: "", kind: "string", value: "" },
    cronForm: {
      open: false,
      command: "",
      frequency: "",
      language: "",
      description: "",
      email: "",
    },
    busy: new Set(),
  };
}

// ---------------------------------------------------------------------------
// Versions dépréciées — l'information la plus utile du périmètre
// ---------------------------------------------------------------------------

/**
 * `true` quand l'API dit elle-même que ce moteur n'est plus tenu.
 *
 * Le rapprochement se fait par **numéro de version**, jamais par comparaison de
 * chaînes : `phpfpm-8.0` d'un runtime et `8.0` de `phpVersions` désignent la
 * même chose sans se ressembler, et `php8.0` d'un cron encore autrement.
 */
export function isDeprecatedEngine(raw: string | null, service: HostingService): boolean {
  if (!isPhpRuntime(raw)) return false;
  const version = versionOf(raw);
  if (!version) return false;
  const found = service.phpVersions.find((p) => p.version === version);
  return found ? isEndOfLifeSupport(found.support) : false;
}

/** Le runtime référencé par un multisite, ou celui par défaut à défaut. */
export function runtimeOf(bundle: HostingBundle, id: number | null): Runtime | null {
  if (bundle.runtimes.length === 0) return null;
  const found = bundle.runtimes.find((r) => r.id === id);
  if (found) return found;
  return defaultRuntime(bundle);
}

export function defaultRuntime(bundle: HostingBundle): Runtime | null {
  return bundle.runtimes.find((r) => r.isDefault) ?? bundle.runtimes[0] ?? null;
}

/** Le nom d'un runtime : l'API le laisse vide, l'identifiant sert alors de nom. */
export function runtimeName(runtime: Runtime): string {
  return runtime.name?.trim() || `Configuration ${runtime.id}`;
}

// ---------------------------------------------------------------------------
// IP servies
// ---------------------------------------------------------------------------

/**
 * L'IPv4 et l'IPv6 réellement servies pour une localisation.
 *
 * `countriesIp` est la seule source : l'IP d'un pays ne se déduit pas de
 * `hostingIp`. Quand elle n'est pas renseignée, on retombe sur l'IP principale
 * de l'hébergement, qui est celle que l'API utiliserait.
 */
export function ipsForLocation(
  service: HostingService,
  location: string | null,
): { ip: string | null; ipv6: string | null } {
  const found = (service.countriesIp ?? []).find((c) => c.country === location);
  if (found) return { ip: found.ip, ipv6: found.ipv6 };
  return { ip: service.hostingIp, ipv6: service.hostingIpv6 };
}

/** Les localisations proposables : celles que l'API annonce, sinon les 14 codes. */
export function locationOptions(service: HostingService, fallback: string[]): string[] {
  const announced = (service.countriesIp ?? []).map((c) => c.country);
  return announced.length > 0 ? announced : fallback;
}

// ---------------------------------------------------------------------------
// Zones du compte
// ---------------------------------------------------------------------------

/**
 * Découpe un nom en (zone du compte, sous-domaine).
 *
 * Rend `null` quand aucune zone du compte ne porte ce nom : l'API ne pourra
 * alors pas configurer son DNS, et le formulaire doit l'annoncer plutôt que de
 * laisser l'appel échouer.
 */
export function splitZone(
  name: string,
  zones: string[],
): { zone: string; subDomain: string | null } | null {
  const clean = name.trim().toLowerCase().replace(/\.$/, "");
  if (!clean) return null;
  const match = zones
    .map((z) => z.toLowerCase())
    .filter((z) => clean === z || clean.endsWith(`.${z}`))
    // Le suffixe le plus long gagne : `a.b.fr` appartient à `b.fr`, pas à `fr`.
    .sort((a, b) => b.length - a.length)[0];
  if (!match) return null;
  return {
    zone: match,
    subDomain: clean === match ? null : clean.slice(0, -(match.length + 1)),
  };
}

// ---------------------------------------------------------------------------
// Ce que le formulaire DNS va faire
// ---------------------------------------------------------------------------

/**
 * Les quatre issues possibles pour la zone DNS :
 *
 * - `none` : rien ne change côté DNS (modification qui ne touche pas l'IP) ;
 * - `manual` : `bypassDNSConfiguration` est coché, l'API n'écrit rien et c'est à
 *   l'utilisateur de créer les enregistrements ;
 * - `blocked` : l'API devrait écrire, mais la zone n'est pas dans ce compte —
 *   l'appel échouerait ;
 * - `write` : l'API va écrire, et on montre quoi.
 */
export type DnsMode = "none" | "manual" | "blocked" | "write";

export function dnsModeOf(form: SiteForm): DnsMode {
  // Une modification qui ne change pas la localisation de l'IP ne demande aucune
  // écriture DNS : l'adresse servie reste la même.
  const needsDns = form.mode === "new" || form.ipLocation !== form.originalLocation;
  if (!needsDns) return "none";
  if (form.bypass) return "manual";
  if (!form.dns || !form.dns.zone) return "blocked";
  return "write";
}

export type WantedRecord = { fieldType: string; target: string };

/** Les enregistrements que l'hébergement attend pour ce multisite. */
export function wantedRecords(
  service: HostingService,
  location: string | null,
): WantedRecord[] {
  const { ip, ipv6 } = ipsForLocation(service, location);
  const out: WantedRecord[] = [];
  if (ip) out.push({ fieldType: "A", target: ip });
  if (ipv6) out.push({ fieldType: "AAAA", target: ipv6 });
  return out;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+\.?$/;
const PATH_RE = /^[A-Za-z0-9._\-/]+$/;
const ESCAPES_HOME = /(^|\/)\.\.(\/|$)/;

export function cleanDomain(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

export function cleanPath(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

/** Le message d'erreur du formulaire de multisite, ou `""` si tout va bien. */
export function siteFormError(form: SiteForm, bundle: HostingBundle): string {
  const domain = cleanDomain(form.domain);
  const path = cleanPath(form.path);
  const ownLog = form.ownLog.trim().toLowerCase();

  if (domain && !HOST_RE.test(domain)) return "Nom de domaine invalide.";
  if (
    form.mode === "new" &&
    bundle.attachedDomains.some((a) => a.domain === domain)
  ) {
    return "Ce domaine est déjà attaché à l'hébergement.";
  }
  if (path && ESCAPES_HOME.test(path)) {
    return "Le dossier doit rester à l'intérieur de l'hébergement.";
  }
  if (path && !PATH_RE.test(path)) {
    return "Dossier : lettres, chiffres, points, tirets et / uniquement.";
  }
  if (ownLog && !HOST_RE.test(ownLog)) return "Domaine des logs invalide.";
  return "";
}

/**
 * Le formulaire est-il envoyable.
 *
 * `domain` et `path` sont nullables côté API — elle accepterait un multisite
 * sans domaine, qui ne servirait rien. L'obligation est donc posée ici.
 */
export function siteFormComplete(form: SiteForm, bundle: HostingBundle): boolean {
  return (
    cleanDomain(form.domain) !== "" &&
    cleanPath(form.path) !== "" &&
    siteFormError(form, bundle) === ""
  );
}

/** Le payload d'écriture, construit une seule fois pour les deux routes. */
export function siteFormPayload(
  form: SiteForm,
  service: HostingService,
): AttachedDomain {
  const ownLog = form.ownLog.trim().toLowerCase();
  return {
    domain: form.mode === "edit" ? form.original : cleanDomain(form.domain),
    path: cleanPath(form.path),
    ssl: form.ssl,
    runtimeId: form.runtimeId,
    firewall: form.firewall ? "active" : "none",
    // Le CDN ne se propose pas si l'offre ne l'inclut pas : l'API refuserait.
    cdn: form.cdn && service.hasCdn === true ? "active" : "none",
    ownLog: ownLog || null,
    ipLocation: form.ipLocation,
    bypassDNSConfiguration: form.bypass,
  };
}

// ---------------------------------------------------------------------------
// Mots de passe FTP
// ---------------------------------------------------------------------------

/** Politique imposée par l'API sur un mot de passe d'utilisateur FTP. */
export const FTP_PASSWORD_HINT = "9 à 30 caractères";
export const FTP_PASSWORD_RULE =
  "Une majuscule, une minuscule et un chiffre. L'ancien cesse de fonctionner.";

export function isValidFtpPassword(value: string): boolean {
  return (
    value.length >= 9 &&
    value.length <= 30 &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /\d/.test(value)
  );
}

/**
 * Un mot de passe tiré au hasard qui respecte la politique, en évitant les
 * caractères qu'on confond en le recopiant (`0`/`O`, `1`/`l`/`I`).
 */
export function generateFtpPassword(length = 16): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  for (;;) {
    const draws = new Uint32Array(length);
    crypto.getRandomValues(draws);
    const candidate = [...draws].map((n) => alphabet[n % alphabet.length]).join("");
    if (isValidFtpPassword(candidate)) return candidate;
  }
}

/** Le message d'erreur du formulaire de création d'utilisateur. */
export function userFormError(
  form: HostingViewState["userForm"],
  bundle: HostingBundle,
): string {
  const suffix = form.suffix.trim().toLowerCase();
  const home = form.home.trim() || "/";
  const login = `${bundle.service.primaryLogin}-${suffix}`;

  if (suffix && !/^[a-z0-9]+$/.test(suffix)) {
    return "Suffixe : lettres minuscules et chiffres uniquement.";
  }
  if (suffix && bundle.users.some((u) => u.login === login)) {
    return "Cet identifiant existe déjà.";
  }
  if (!home.startsWith("/") || ESCAPES_HOME.test(home)) {
    return "Le dossier commence par / et reste dans l'hébergement.";
  }
  if (form.password && !isValidFtpPassword(form.password)) {
    return "Mot de passe : 9 à 30 caractères, avec une majuscule, une minuscule et un chiffre.";
  }
  return "";
}

// ---------------------------------------------------------------------------
// Variables d'environnement et crons
// ---------------------------------------------------------------------------

export function envFormError(
  form: HostingViewState["envForm"],
  bundle: HostingBundle,
): string {
  const key = form.key.trim();
  if (key && !/^[A-Z_][A-Z0-9_]*$/.test(key)) {
    return "Nom : majuscules, chiffres et _, sans commencer par un chiffre.";
  }
  if (key && bundle.envVars.some((v) => v.key === key)) {
    return "Cette variable existe déjà.";
  }
  if (form.value && form.kind === "integer" && !/^-?\d+$/.test(form.value)) {
    return "Une variable integer attend un nombre entier.";
  }
  return "";
}

export function cronFormError(form: HostingViewState["cronForm"]): string {
  const command = form.command.trim().replace(/^\/+/, "");
  const email = form.email.trim();
  if (command && ESCAPES_HOME.test(command)) {
    return "Le script doit se trouver dans l'hébergement.";
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return "Adresse e-mail invalide.";
  }
  return "";
}

/** Le serveur FTP d'un cluster : il se déduit du cluster, pas d'un champ. */
export function ftpHost(service: HostingService): string {
  return `ftp.${service.cluster}.hosting.ovh.net`;
}

export function sshHost(service: HostingService): string {
  return `ssh.${service.cluster}.hosting.ovh.net`;
}

/**
 * L'offre comprend-elle un accès shell.
 *
 * Aucun champ ne le dit : `serviceManagementAccess.ssh` porte l'URL du point
 * d'accès, et son absence est la seule information disponible. Mieux vaut s'en
 * servir que de deviner d'après le code d'offre.
 */
export function sshAvailable(service: HostingService): boolean {
  return Boolean(service.serviceManagementAccess.ssh.url);
}

// ---------------------------------------------------------------------------
// Ce qui est en cours sur une ligne
// ---------------------------------------------------------------------------

/**
 * La tâche non terminée qui porte sur cet objet, s'il y en a une.
 *
 * Les modèles de l'hébergement ne portent aucun drapeau « en attente » —
 * `AttachedDomain`, `HostingUser` et `Cron` n'en ont pas. L'information existe
 * pourtant : `objectId` d'une tâche nomme la ligne concernée. C'est donc la
 * liste des tâches qui dit ce qui bouge, et pas un état inventé côté interface.
 */
export function pendingTaskFor(
  bundle: HostingBundle,
  objectId: string | null,
): { label: string; function: string } | null {
  if (!objectId) return null;
  const key = objectId.toLowerCase();
  const found = bundle.tasks.find(
    (t) =>
      !isTerminalHostingStatus(t.status) && (t.objectId ?? "").toLowerCase() === key,
  );
  if (!found) return null;
  return { label: `${hostingTaskLabel(found.function)}…`, function: found.function };
}

// ---------------------------------------------------------------------------
// Ce que l'offre autorise
// ---------------------------------------------------------------------------

/** Les compteurs de `HostingCapabilities` que l'écran interroge. */
export type CapabilityCounter =
  | "attachedDomains"
  | "extraUsers"
  | "envVars"
  | "runtimes";

/**
 * Ce qu'une action a le droit de proposer, avec la raison quand c'est non.
 *
 * Trois états, et le troisième compte autant que les deux autres :
 *
 * - autorisé ;
 * - refusé par l'offre — on grise **avec la raison**, on ne masque pas, et
 *   surtout on ne laisse pas l'API répondre 400 ;
 * - capacités inconnues (lecture en échec) : on autorise. L'API reste l'arbitre,
 *   et interdire sur une ignorance serait pire que laisser essayer.
 */
export type Capability = {
  allowed: boolean;
  reason: string;
  /** `null` : limite inconnue, ou sans limite pratique. */
  limit: number | null;
};

const CAPABILITY_WORDING: Record<CapabilityCounter, { what: string; hint: string }> = {
  attachedDomains: {
    what: "multisite",
    hint: "Le nombre de domaines servis est fixé par l'offre.",
  },
  extraUsers: {
    what: "compte FTP supplémentaire",
    hint: "Seul le compte principal existe sur cette offre.",
  },
  envVars: {
    what: "variable d'environnement",
    hint: "Les variables d'environnement demandent une offre Cloud Web.",
  },
  runtimes: {
    what: "configuration d'exécution",
    hint: "Les configurations d'exécution demandent une offre Cloud Web.",
  },
};

/**
 * La limite d'un compteur, `null` quand elle n'apprend rien : capacités non
 * lues, ou valeur si grande qu'elle vaut « sans limite ».
 */
export function capabilityLimit(
  capabilities: HostingCapabilities | null,
  counter: CapabilityCounter,
): number | null {
  if (!capabilities) return null;
  const value = capabilities[counter];
  if (value < 0 || value >= CAPABILITY_UNLIMITED) return null;
  return value;
}

/** `used` est le nombre déjà en place : une limite atteinte refuse l'ajout. */
export function canAdd(
  capabilities: HostingCapabilities | null,
  counter: CapabilityCounter,
  used: number,
): Capability {
  const wording = CAPABILITY_WORDING[counter];
  if (!capabilities) {
    return { allowed: true, reason: "", limit: null };
  }
  const raw = capabilities[counter];
  if (!capabilityAllows(raw)) {
    return {
      allowed: false,
      reason: `Cette offre n'autorise aucun ${wording.what}. ${wording.hint}`,
      limit: 0,
    };
  }
  const limit = capabilityLimit(capabilities, counter);
  if (limit !== null && used >= limit) {
    return {
      allowed: false,
      reason: `Limite de l'offre atteinte : ${limit} ${wording.what}${limit > 1 ? "s" : ""}. ${wording.hint}`,
      limit,
    };
  }
  return { allowed: true, reason: "", limit };
}

/** Un booléen de capacité, avec sa raison quand il est faux. */
export function capabilityFlag(
  capabilities: HostingCapabilities | null,
  flag: "crontab" | "ssh" | "filesBrowser" | "moduleOneClick",
  reason: string,
): Capability {
  if (!capabilities) return { allowed: true, reason: "", limit: null };
  return capabilities[flag]
    ? { allowed: true, reason: "", limit: null }
    : { allowed: false, reason, limit: null };
}

/**
 * Le nombre de comptes FTP **en plus** du principal.
 *
 * `extraUsers` compte les comptes supplémentaires, pas le total : le compte
 * principal existe sur toutes les offres, y compris celles à `extraUsers: 0`.
 */
export function extraUserCount(bundle: HostingBundle): number {
  return bundle.users.filter((u) => !u.isPrimaryAccount).length;
}

/**
 * L'offre comprend-elle un accès shell.
 *
 * `capabilities.ssh` est la réponse quand elle a pu être lue ; sinon l'absence
 * d'URL dans `serviceManagementAccess.ssh` est la seule information disponible,
 * et elle vaut mieux qu'une déduction à partir du code d'offre.
 */
export function shellAvailable(bundle: HostingBundle): boolean {
  if (bundle.capabilities) return bundle.capabilities.ssh;
  return sshAvailable(bundle.service);
}

/** Les bases incluses dans l'offre, quand l'API le dit. `null` sinon. */
export function databaseAllowance(
  capabilities: HostingCapabilities | null,
): number | null {
  const first = capabilities?.databases?.[0];
  if (!first) return null;
  return first.available;
}

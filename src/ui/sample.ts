/**
 * ⚠ DONNÉES D'EXEMPLE — AUCUNE DE CES VALEURS NE VIENT DE L'API OVHcloud.
 *
 * Ce module alimente le mode « données d'exemple » de `data.ts`, qui permet de
 * travailler l'écran 03 Console sans compte OVH connecté. Il est **inerte** en
 * mode normal : `data.ts` ne l'appelle que si le mode a été activé
 * explicitement. Les objets produits respectent les types de `../ovh-api.ts` au
 * champ près, pour qu'une vue qui marche ici marche aussi sur des vraies données.
 *
 * Le contenu reprend celui de la maquette `design/OVH Console.dc.html`.
 */

import type {
  AttachedDomain,
  ChangeContact,
  Contact,
  Cron,
  CronInput,
  Database,
  DatabaseDump,
  EnvVar,
  HostingCapabilities,
  HostingService,
  HostingSsl,
  HostingTask,
  HostingUser,
  HostingUserCreate,
  Runtime,
  DomainServiceWithIam,
  DomainTask,
  DynHostLogin,
  DynHostLoginCreate,
  DynHostRecord,
  FullNameServer,
  GlueRecord,
  GlueRecordCreate,
  NameServerInput,
  Record_,
  RenewType,
  Service,
  Soa,
  TaskAction,
  ZoneCapabilities,
  ZoneDnssec,
  ZoneStatus,
  ZoneTask,
  ZoneWithIam,
} from "../ovh-api";
import type { IconName } from "./icons";
import type {
  DomainBundle,
  HostingBundle,
  ProductDetail,
  ProductSummary,
  SectionId,
} from "./data";

// ---------------------------------------------------------------------------
// Petits utilitaires internes
// ---------------------------------------------------------------------------

let nextId = 9000;
const newId = (): number => (nextId += 1);

const nowIso = (): string => new Date().toISOString();

/** Décale une date de N jours par rapport à maintenant, en ISO. */
function isoIn(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Contacts d'exemple
// ---------------------------------------------------------------------------

function sampleContact(
  id: number,
  firstName: string,
  lastName: string,
  email: string,
): Contact {
  return {
    id,
    firstName,
    lastName,
    gender: null,
    language: "fr_FR",
    email,
    phone: "+33.100000000",
    cellPhone: null,
    fax: null,
    website: null,
    address: {
      line1: "12 rue des Potiers",
      line2: null,
      line3: null,
      zip: "59000",
      city: "Lille",
      province: null,
      country: "FR",
      otherDetails: null,
    },
    birthDay: null,
    birthCity: null,
    birthZip: null,
    birthCountry: null,
    nationality: "FR",
    legalForm: "individual",
    legalFormCategory: null,
    organisationName: null,
    enterpriseId: null,
    vat: null,
    insee: null,
    nationalIdentificationNumber: null,
    companyNationalIdentificationNumber: null,
    accreditationId: null,
    accreditationOrganism: null,
    accreditationCountry: null,
    accreditationYear: null,
    organisationType: null,
    organisationTypeOther: null,
    organisationRole: null,
    organisationRoleOther: null,
    organisationFunding: null,
    organisationFundingOther: null,
    organisationStaffStatus: null,
    organisationStaffStatusOther: null,
    organisationAccountable: null,
    roleInOrganisation: null,
    registrantDocumentType: null,
    registrantDocumentTypeOther: null,
    trademarkId: null,
  };
}

/**
 * Les contacts sont indexés par identifiant numérique, comme `/me/contact` :
 * la fiche du domaine, elle, ne porte que des identifiants.
 */
const CONTACTS: Contact[] = [
  sampleContact(42187, "Camille", "Martin", "camille@atelier-exemple.fr"),
  sampleContact(8812, "Thomas", "Bernard", "thomas.bernard@exemple.fr"),
];

const NIC_OF: Record<number, string> = {
  42187: "cm42187-ovh",
  8812: "tb8812-ovh",
};

/** Le compte du porteur des données d'exemple. */
export const SAMPLE_ACCOUNT = { account: "cm42187-ovh", displayName: "Camille Martin" };

// ---------------------------------------------------------------------------
// Fabriques typées
// ---------------------------------------------------------------------------

type RecordSeed = {
  sub: string;
  type: string;
  ttl: number | null;
  target: string;
};

function record(zone: string, seed: RecordSeed): Record_ {
  return {
    id: newId(),
    zone,
    fieldType: seed.type,
    subDomain: seed.sub === "" ? null : seed.sub,
    target: seed.target,
    ttl: seed.ttl,
  };
}

function soa(zone: string): Soa {
  return {
    server: "dns110.ovh.net.",
    email: `hostmaster@${zone}`,
    serial: 2026092501,
    refresh: 3600,
    expire: 3600000,
    nxDomainTtl: 60,
    ttl: 3600,
  };
}

function nameServers(hosts: string[]): FullNameServer[] {
  return hosts.map((host) => ({
    id: newId(),
    host,
    ip: null,
    isUsed: true,
    toDelete: false,
  }));
}

function domainTask(
  fn: string,
  status: string,
  options: Partial<DomainTask> = {},
): DomainTask {
  return {
    id: newId(),
    function: fn,
    status,
    type: "domain",
    domain: null,
    comment: null,
    creationDate: isoIn(-6),
    lastUpdate: isoIn(-6),
    todoDate: isoIn(-6),
    doneDate: null,
    canAccelerate: false,
    canCancel: false,
    canRelaunch: false,
    ...options,
  };
}

function zoneTask(fn: string, status: string, options: Partial<ZoneTask> = {}): ZoneTask {
  return {
    id: newId(),
    function: fn,
    status,
    comment: null,
    creationDate: isoIn(-23),
    lastUpdate: isoIn(-23),
    todoDate: isoIn(-23),
    doneDate: isoIn(-23),
    canAccelerate: false,
    canCancel: false,
    canRelaunch: false,
    ...options,
  };
}

// ---------------------------------------------------------------------------
// Le magasin mutable
//
// Les écritures du mode exemple modifient ce magasin, de façon à ce que
// l'interface se comporte comme sur de vraies données : une écriture rend une
// tâche, la tâche se termine, la zone repasse en « publiée ».
// ---------------------------------------------------------------------------

type Entry = {
  service: DomainServiceWithIam;
  serviceInfo: Service;
  zone: ZoneWithIam;
  zoneStatus: ZoneStatus;
  zoneCapabilities: ZoneCapabilities;
  zoneDnssec: ZoneDnssec;
  soa: Soa;
  records: Record_[];
  dynHostLogins: DynHostLogin[];
  dynHostRecords: DynHostRecord[];
  nameServers: FullNameServer[];
  glueRecords: GlueRecord[];
  domainTasks: DomainTask[];
  zoneTasks: ZoneTask[];
};

function entryAtelierExemple(): Entry {
  const zone = "atelier-exemple.fr";
  return {
    service: {
      domain: zone,
      serviceId: 100001,
      state: "ok",
      suspensionState: "not_suspended",
      renewalState: "automatic_renew",
      expirationDate: "2027-03-14T00:00:00+01:00",
      renewalDate: "2027-03-14T00:00:00+01:00",
      lastUpdate: isoIn(-23),
      offer: "diamond",
      parentService: null,
      contactOwner: { id: "42187" },
      contactAdmin: { id: "42187" },
      contactBilling: { id: "42187" },
      contactTech: { id: "8812" },
      whoisOwner: "42187",
      nameServerType: "hosted",
      nameServers: [],
      dnssecState: "enabled",
      dnssecSupported: true,
      transferLockStatus: "locked",
      glueRecordIpv6Supported: true,
      glueRecordMultiIpSupported: true,
      hostSupported: true,
      owoSupported: true,
      iam: null,
    },
    serviceInfo: {
      serviceId: 100001,
      domain: zone,
      status: "ok",
      creation: "2021-03-14",
      expiration: "2027-03-14",
      engagedUpTo: null,
      renewalType: "automaticV2016",
      renew: {
        automatic: true,
        deleteAtExpiration: false,
        forced: false,
        manualPayment: false,
        period: 12,
      },
      possibleRenewPeriod: [12, 24, 36, 60, 120],
      canDeleteAtExpiration: true,
      contactAdmin: "cm42187-ovh",
      contactBilling: "cm42187-ovh",
      contactTech: "tb8812-ovh",
    },
    zone: {
      name: zone,
      nameServers: ["dns110.ovh.net", "ns110.ovh.net"],
      dnssecActivated: true,
      dnssecSupported: true,
      hasDnsAnycast: false,
      lastUpdate: isoIn(-23),
      iam: null,
    },
    zoneStatus: { isDeployed: true, errors: null, warnings: null },
    zoneCapabilities: { dynHost: true },
    zoneDnssec: { status: "enabled" },
    soa: soa(zone),
    records: [
      { sub: "", type: "A", ttl: null, target: "203.0.113.10" },
      { sub: "", type: "AAAA", ttl: null, target: "2001:db8::1" },
      { sub: "www", type: "CNAME", ttl: null, target: "atelier-exemple.fr." },
      { sub: "", type: "MX", ttl: 3600, target: "1 mx1.mail.ovh.net." },
      { sub: "", type: "MX", ttl: 3600, target: "5 mx2.mail.ovh.net." },
      { sub: "", type: "TXT", ttl: 600, target: '"v=spf1 include:mx.ovh.com ~all"' },
      {
        sub: "_dmarc",
        type: "TXT",
        ttl: null,
        target: '"v=DMARC1; p=quarantine; rua=mailto:dmarc@atelier-exemple.fr"',
      },
      { sub: "", type: "CAA", ttl: null, target: '0 issue "letsencrypt.org"' },
    ].map((seed) => record(zone, seed as RecordSeed)),
    // Deux identifiants, dont un autorisé sur toute la zone (`*`) : c'est le cas
    // où le panneau de révélation ne peut pas nommer l'hôte à mettre à jour.
    dynHostLogins: [
      { login: "atelier-exemple.fr-nas", zone, subDomain: "nas" },
      { login: "atelier-exemple.fr-box", zone, subDomain: "*" },
    ],
    dynHostRecords: [
      { id: newId(), zone, subDomain: "nas", ip: "203.0.113.77", ttl: 60 },
      { id: newId(), zone, subDomain: "bureau", ip: "203.0.113.91", ttl: 60 },
    ],
    nameServers: nameServers(["dns110.ovh.net", "ns110.ovh.net"]),
    glueRecords: [{ host: "ns1.atelier-exemple.fr", ips: ["203.0.113.10"] }],
    domainTasks: [
      domainTask("changeContact", "error", {
        comment:
          "tb8812-ovh n'a pas validé la demande dans le délai de 7 jours.",
        canRelaunch: true,
        creationDate: isoIn(-6),
        lastUpdate: isoIn(-6),
        todoDate: isoIn(-6),
      }),
    ],
    zoneTasks: [
      zoneTask("DnssecEnable", "done", {
        creationDate: isoIn(-23),
        doneDate: isoIn(-23),
      }),
    ],
  };
}

function entryBoutiqueExemple(): Entry {
  const zone = "boutique-exemple.com";
  return {
    service: {
      domain: zone,
      serviceId: 100002,
      state: "ok",
      suspensionState: "not_suspended",
      renewalState: "manual_renew",
      expirationDate: "2026-10-08T00:00:00+02:00",
      renewalDate: "2026-10-08T00:00:00+02:00",
      lastUpdate: isoIn(-95),
      offer: "gold",
      parentService: null,
      contactOwner: { id: "42187" },
      contactAdmin: { id: "42187" },
      contactBilling: { id: "42187" },
      contactTech: { id: "42187" },
      whoisOwner: "42187",
      nameServerType: "hosted",
      nameServers: [],
      dnssecState: "disabled",
      dnssecSupported: true,
      transferLockStatus: "unlocked",
      glueRecordIpv6Supported: true,
      glueRecordMultiIpSupported: true,
      hostSupported: true,
      owoSupported: true,
      iam: null,
    },
    serviceInfo: {
      serviceId: 100002,
      domain: zone,
      status: "ok",
      creation: "2023-06-08",
      expiration: "2026-10-08",
      engagedUpTo: null,
      renewalType: "manual",
      renew: {
        automatic: false,
        deleteAtExpiration: false,
        forced: false,
        manualPayment: true,
        period: 12,
      },
      possibleRenewPeriod: [12, 24, 36, 60, 120],
      canDeleteAtExpiration: true,
      contactAdmin: "cm42187-ovh",
      contactBilling: "cm42187-ovh",
      contactTech: "cm42187-ovh",
    },
    zone: {
      name: zone,
      nameServers: ["dns17.ovh.net"],
      dnssecActivated: false,
      dnssecSupported: true,
      hasDnsAnycast: false,
      lastUpdate: isoIn(-95),
      iam: null,
    },
    // Une zone volontairement non déployée : c'est le cas que l'interface doit
    // signaler sans mentir (« ce qui est affiché n'est pas ce qui est servi »).
    zoneStatus: {
      isDeployed: false,
      errors: null,
      warnings: ["La zone contient des modifications non publiées."],
    },
    zoneCapabilities: { dynHost: true },
    zoneDnssec: { status: "disabled" },
    soa: soa(zone),
    records: [
      { sub: "", type: "A", ttl: null, target: "203.0.113.42" },
      { sub: "www", type: "CNAME", ttl: null, target: "boutique-exemple.com." },
      { sub: "", type: "MX", ttl: null, target: "1 mx1.mail.ovh.net." },
      {
        sub: "",
        type: "TXT",
        ttl: null,
        target: '"google-site-verification=Qm8x…"',
      },
    ].map((seed) => record(zone, seed as RecordSeed)),
    dynHostLogins: [],
    dynHostRecords: [],
    nameServers: nameServers(["dns17.ovh.net"]),
    glueRecords: [],
    domainTasks: [
      domainTask("DomainRenew", "todo", {
        canAccelerate: true,
        canCancel: true,
        creationDate: isoIn(-1),
        lastUpdate: isoIn(-1),
        todoDate: isoIn(5),
      }),
    ],
    zoneTasks: [],
  };
}

function entryExempleEu(): Entry {
  const zone = "exemple.eu";
  return {
    service: {
      domain: zone,
      serviceId: 100003,
      state: "ok",
      suspensionState: "not_suspended",
      renewalState: "automatic_renew",
      expirationDate: "2027-06-22T00:00:00+02:00",
      renewalDate: "2027-06-22T00:00:00+02:00",
      lastUpdate: isoIn(-460),
      offer: "gold",
      parentService: null,
      contactOwner: { id: "42187" },
      contactAdmin: { id: "42187" },
      contactBilling: { id: "42187" },
      contactTech: { id: "42187" },
      whoisOwner: "42187",
      nameServerType: "hosted",
      nameServers: [],
      dnssecState: "enabled",
      dnssecSupported: true,
      // `unavailable` : le registre ne propose pas de verrou de transfert. Le
      // bouton doit être grisé avec la raison, jamais masqué.
      transferLockStatus: "unavailable",
      glueRecordIpv6Supported: false,
      glueRecordMultiIpSupported: false,
      hostSupported: false,
      owoSupported: false,
      iam: null,
    },
    serviceInfo: {
      serviceId: 100003,
      domain: zone,
      status: "ok",
      creation: "2024-06-22",
      expiration: "2027-06-22",
      engagedUpTo: null,
      renewalType: "automaticV2016",
      renew: {
        automatic: true,
        deleteAtExpiration: false,
        forced: false,
        manualPayment: false,
        period: 12,
      },
      possibleRenewPeriod: [12, 24, 36, 60, 120],
      canDeleteAtExpiration: false,
      contactAdmin: "cm42187-ovh",
      contactBilling: "cm42187-ovh",
      contactTech: "cm42187-ovh",
    },
    zone: {
      name: zone,
      nameServers: ["dns110.ovh.net", "ns110.ovh.net"],
      dnssecActivated: true,
      dnssecSupported: true,
      hasDnsAnycast: false,
      lastUpdate: isoIn(-460),
      iam: null,
    },
    zoneStatus: { isDeployed: true, errors: null, warnings: null },
    zoneCapabilities: { dynHost: false },
    zoneDnssec: { status: "enabled" },
    soa: soa(zone),
    records: [
      { sub: "", type: "A", ttl: null, target: "203.0.113.10" },
      { sub: "www", type: "CNAME", ttl: null, target: "exemple.eu." },
    ].map((seed) => record(zone, seed as RecordSeed)),
    dynHostLogins: [],
    dynHostRecords: [],
    nameServers: nameServers(["dns110.ovh.net", "ns110.ovh.net"]),
    glueRecords: [],
    domainTasks: [],
    zoneTasks: [],
  };
}

let store: Map<string, Entry> | null = null;

function db(): Map<string, Entry> {
  if (!store) {
    store = new Map([
      ["atelier-exemple.fr", entryAtelierExemple()],
      ["boutique-exemple.com", entryBoutiqueExemple()],
      ["exemple.eu", entryExempleEu()],
    ]);
  }
  return store;
}

function entry(name: string): Entry {
  const found = db().get(name);
  if (!found) throw { kind: "notFound", message: `domaine ${name} inconnu` };
  return found;
}

/**
 * Fait avancer une tâche jusqu'à `done` après un délai, puis applique son effet.
 * Reproduit le fait qu'une écriture OVH rend une tâche et non un résultat.
 */
function settleLater(after: number, apply: () => void): void {
  setTimeout(apply, after);
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export function sampleDomainNames(): string[] {
  return [...db().keys()];
}

export function sampleContacts(): Contact[] {
  return CONTACTS.map((c) => ({ ...c }));
}

/** Le nichandle d'un contact d'exemple, pour l'affichage. */
export function sampleNicHandle(contactId: string): string | null {
  const n = Number(contactId);
  return Number.isFinite(n) ? (NIC_OF[n] ?? null) : null;
}

/** La fiche d'un domaine d'exemple, pour les lignes du sélecteur. */
export function sampleDomainService(name: string): DomainServiceWithIam {
  return { ...entry(name).service };
}

export function sampleDomainBundle(name: string): DomainBundle {
  const e = entry(name);
  return {
    name,
    service: { ...e.service },
    serviceInfo: { ...e.serviceInfo },
    zone: { ...e.zone },
    zoneStatus: { ...e.zoneStatus },
    zoneCapabilities: { ...e.zoneCapabilities },
    zoneDnssec: { ...e.zoneDnssec },
    soa: { ...e.soa },
    records: e.records.map((r) => ({ ...r })),
    dynHostLogins: e.dynHostLogins.map((l) => ({ ...l })),
    dynHostRecords: e.dynHostRecords.map((r) => ({ ...r })),
    nameServers: e.nameServers.map((n) => ({ ...n })),
    glueRecords: e.glueRecords.map((g) => ({ ...g, ips: [...g.ips] })),
    contacts: sampleContacts(),
    domainTasks: e.domainTasks.map((t) => ({ ...t })),
    zoneTasks: e.zoneTasks.map((t) => ({ ...t })),
    partialErrors: [],
  };
}

// ---------------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------------

export function sampleCreateRecord(
  zone: string,
  payload: { fieldType: string; target: string; subDomain: string | null; ttl: number },
): Record_ {
  const e = entry(zone);
  const created: Record_ = {
    id: newId(),
    zone,
    fieldType: payload.fieldType,
    subDomain: payload.subDomain,
    target: payload.target,
    ttl: payload.ttl,
  };
  e.records.push(created);
  e.zoneStatus = { ...e.zoneStatus, isDeployed: false };
  return created;
}

export function sampleUpdateRecord(
  zone: string,
  id: number,
  payload: { target: string; subDomain: string | null; ttl: number | null },
): void {
  const e = entry(zone);
  e.records = e.records.map((r) => (r.id === id ? { ...r, ...payload } : r));
  e.zoneStatus = { ...e.zoneStatus, isDeployed: false };
}

export function sampleDeleteRecord(zone: string, id: number): void {
  const e = entry(zone);
  e.records = e.records.filter((r) => r.id !== id);
  e.zoneStatus = { ...e.zoneStatus, isDeployed: false };
}

export function sampleRefreshZone(zone: string): void {
  const e = entry(zone);
  const task = zoneTask("ZoneRefresh", "doing", {
    creationDate: nowIso(),
    lastUpdate: nowIso(),
    todoDate: nowIso(),
    doneDate: null,
  });
  e.zoneTasks = [task, ...e.zoneTasks];
  settleLater(2600, () => {
    const cur = db().get(zone);
    if (!cur) return;
    cur.zoneStatus = { isDeployed: true, errors: null, warnings: null };
    cur.zoneTasks = cur.zoneTasks.map((t) =>
      t.id === task.id ? { ...t, status: "done", doneDate: nowIso() } : t,
    );
  });
}

export function sampleReplaceNameServers(
  serviceName: string,
  list: NameServerInput[],
): DomainTask {
  const e = entry(serviceName);
  const task = domainTask("DomainDnsUpdate", "doing", {
    domain: serviceName,
    creationDate: nowIso(),
    lastUpdate: nowIso(),
    todoDate: nowIso(),
  });
  e.domainTasks = [task, ...e.domainTasks];
  e.nameServers = e.nameServers.map((n) => ({ ...n, toDelete: !list.some((i) => i.host === n.host) }));
  settleLater(3200, () => {
    const cur = db().get(serviceName);
    if (!cur) return;
    cur.nameServers = nameServers(list.map((i) => i.host));
    cur.zone = { ...cur.zone, nameServers: list.map((i) => i.host) };
    cur.domainTasks = cur.domainTasks.map((t) =>
      t.id === task.id
        ? { ...t, status: "done", doneDate: nowIso(), canAccelerate: false, canCancel: false }
        : t,
    );
  });
  return { ...task };
}

export function sampleCreateDynHostLogin(
  zone: string,
  payload: DynHostLoginCreate,
): DynHostLogin {
  const e = entry(zone);
  const created: DynHostLogin = {
    login: `${zone}-${payload.loginSuffix}`,
    zone,
    subDomain: payload.subDomain,
  };
  e.dynHostLogins = [...e.dynHostLogins, created];
  return { ...created };
}

/**
 * Le changement de mot de passe ne laisse aucune trace lisible côté API : rien à
 * muter dans le magasin, mais la fonction existe pour que le chemin d'appel du
 * mode exemple soit le même que le chemin réel — et pour qu'un login inconnu
 * échoue ici comme il échouerait là-bas.
 */
export function sampleChangeDynHostPassword(zone: string, login: string): void {
  const e = entry(zone);
  if (!e.dynHostLogins.some((l) => l.login === login)) {
    throw { kind: "notFound", message: `identifiant ${login} inconnu` };
  }
}

export function sampleDeleteDynHostLogin(zone: string, login: string): void {
  const e = entry(zone);
  e.dynHostLogins = e.dynHostLogins.filter((l) => l.login !== login);
}

/**
 * Bascule DNSSEC : passe par l'état transitoire, comme le registre.
 *
 * C'est ce qui permet de vérifier sans compte que l'interrupteur se désactive
 * pendant `enableInProgress` au lieu de se reproposer.
 */
export function sampleSetZoneDnssec(zone: string, enabled: boolean): void {
  const e = entry(zone);
  e.zoneDnssec = { status: enabled ? "enableInProgress" : "disableInProgress" };
  const task = zoneTask(enabled ? "DnssecEnable" : "DnssecDisable", "doing", {
    creationDate: nowIso(),
    lastUpdate: nowIso(),
    todoDate: nowIso(),
    doneDate: null,
  });
  e.zoneTasks = [task, ...e.zoneTasks];
  settleLater(3400, () => {
    const cur = db().get(zone);
    if (!cur) return;
    cur.zoneDnssec = { status: enabled ? "enabled" : "disabled" };
    cur.zone = { ...cur.zone, dnssecActivated: enabled };
    cur.service = { ...cur.service, dnssecState: enabled ? "enabled" : "disabled" };
    cur.zoneTasks = cur.zoneTasks.map((t) =>
      t.id === task.id ? { ...t, status: "done", doneDate: nowIso() } : t,
    );
  });
}

export function sampleCreateGlueRecord(
  serviceName: string,
  payload: GlueRecordCreate,
): DomainTask {
  const e = entry(serviceName);
  e.glueRecords = [...e.glueRecords, { host: payload.host, ips: [...payload.ips] }];
  const task = domainTask("DomainGlueRecordCreate", "doing", {
    domain: serviceName,
    creationDate: nowIso(),
    lastUpdate: nowIso(),
    todoDate: nowIso(),
  });
  e.domainTasks = [task, ...e.domainTasks];
  settleLater(2600, () => finishDomainTask(serviceName, task.id));
  return { ...task };
}

export function sampleDeleteGlueRecord(serviceName: string, host: string): DomainTask {
  const e = entry(serviceName);
  const task = domainTask("DomainGlueRecordDelete", "doing", {
    domain: serviceName,
    creationDate: nowIso(),
    lastUpdate: nowIso(),
    todoDate: nowIso(),
  });
  e.domainTasks = [task, ...e.domainTasks];
  settleLater(2600, () => {
    const cur = db().get(serviceName);
    if (!cur) return;
    cur.glueRecords = cur.glueRecords.filter((g) => g.host !== host);
    finishDomainTask(serviceName, task.id);
  });
  return { ...task };
}

export function sampleSetTransferLock(serviceName: string, status: string): void {
  const e = entry(serviceName);
  const target = status === "locked" ? "locked" : "unlocked";
  e.service = {
    ...e.service,
    transferLockStatus: target === "locked" ? "locking" : "unlocking",
  };
  const task = domainTask(
    target === "locked" ? "DomainTransferLock" : "DomainTransferUnlock",
    "doing",
    { domain: serviceName, creationDate: nowIso(), lastUpdate: nowIso(), todoDate: nowIso() },
  );
  e.domainTasks = [task, ...e.domainTasks];
  settleLater(2800, () => {
    const cur = db().get(serviceName);
    if (!cur) return;
    cur.service = { ...cur.service, transferLockStatus: target };
    finishDomainTask(serviceName, task.id);
  });
}

export function sampleSetRenew(serviceName: string, renew: RenewType): void {
  const e = entry(serviceName);
  e.serviceInfo = { ...e.serviceInfo, renew: { ...renew } };
  e.service = {
    ...e.service,
    renewalState: renew.automatic ? "automatic_renew" : "manual_renew",
  };
}

export function sampleChangeContacts(
  serviceName: string,
  payload: ChangeContact,
): number[] {
  const e = entry(serviceName);
  const task = domainTask("changeContact", "doing", {
    domain: serviceName,
    comment: "En attente de validation par le nouveau contact.",
    creationDate: nowIso(),
    lastUpdate: nowIso(),
    todoDate: nowIso(),
  });
  e.domainTasks = [task, ...e.domainTasks];
  settleLater(4000, () => {
    const cur = db().get(serviceName);
    if (!cur) return;
    cur.serviceInfo = {
      ...cur.serviceInfo,
      contactAdmin: payload.contactAdmin,
      contactBilling: payload.contactBilling,
      contactTech: payload.contactTech,
    };
    finishDomainTask(serviceName, task.id);
  });
  return [task.id];
}

function finishDomainTask(serviceName: string, id: number): void {
  const cur = db().get(serviceName);
  if (!cur) return;
  cur.domainTasks = cur.domainTasks.map((t) =>
    t.id === id
      ? {
          ...t,
          status: "done",
          doneDate: nowIso(),
          comment: null,
          canAccelerate: false,
          canCancel: false,
          canRelaunch: false,
        }
      : t,
  );
}

export function sampleActOnDomainTask(
  serviceName: string,
  id: number,
  action: TaskAction,
): void {
  const e = entry(serviceName);
  if (action === "cancel") {
    e.domainTasks = e.domainTasks.map((t) =>
      t.id === id
        ? {
            ...t,
            status: "cancelled",
            doneDate: nowIso(),
            canAccelerate: false,
            canCancel: false,
            canRelaunch: false,
          }
        : t,
    );
    return;
  }
  e.domainTasks = e.domainTasks.map((t) =>
    t.id === id
      ? {
          ...t,
          status: "doing",
          comment: null,
          canAccelerate: false,
          canCancel: false,
          canRelaunch: false,
        }
      : t,
  );
  settleLater(2600, () => finishDomainTask(serviceName, id));
}

export function sampleActOnZoneTask(zone: string, id: number, action: TaskAction): void {
  const e = entry(zone);
  if (action === "cancel") {
    e.zoneTasks = e.zoneTasks.map((t) =>
      t.id === id
        ? {
            ...t,
            status: "cancelled",
            doneDate: nowIso(),
            canAccelerate: false,
            canCancel: false,
            canRelaunch: false,
          }
        : t,
    );
    return;
  }
  e.zoneTasks = e.zoneTasks.map((t) =>
    t.id === id ? { ...t, status: "doing", comment: null } : t,
  );
  settleLater(2600, () => {
    const cur = db().get(zone);
    if (!cur) return;
    cur.zoneTasks = cur.zoneTasks.map((t) =>
      t.id === id ? { ...t, status: "done", doneDate: nowIso() } : t,
    );
  });
}

// ---------------------------------------------------------------------------
// Les autres familles de produits
//
// Le backend n'expose que `/domain` pour l'instant : serveurs dédiés, VPS,
// hébergements et e-mails n'existent qu'ici, pour montrer la coquille de la
// maquette. Ils ne sont jamais proposés en mode normal.
// ---------------------------------------------------------------------------

type SampleSection = {
  id: SectionId;
  label: string;
  icon: IconName;
  primary: { label: string; icon: IconName } | null;
  secondary: { label: string; icon: IconName }[];
  items: ProductDetail[];
};

const OTHER_SECTIONS: SampleSection[] = [
  {
    id: "dedicated",
    label: "Serveurs dédiés",
    icon: "hard-drives",
    primary: { label: "Redémarrer", icon: "arrow-clockwise" },
    secondary: [{ label: "Réinstaller", icon: "disc" }],
    items: [
      {
        id: "ns3124578.ip-203-0-113.eu",
        offer: "Advance-2 · Gravelines (GRA2)",
        status: "En service",
        ok: true,
        infos: [
          { k: "Processeur", v: "AMD EPYC 4344P · 8c/16t" },
          { k: "Mémoire", v: "64 Go DDR5 ECC" },
          { k: "Stockage", v: "2 × 960 Go NVMe" },
          { k: "Système", v: "Debian 12" },
          { k: "IPv4", v: "203.0.113.10" },
          { k: "Renouvellement", v: "12 nov. 2026" },
        ],
        table: {
          title: "Adresses IP",
          cols: ["Adresse", "Type", "Reverse"],
          rows: [
            ["203.0.113.10", "IPv4 principale", "ns3124578.ip-203-0-113.eu"],
            ["2001:db8::1", "IPv6", "—"],
            ["203.0.113.200/30", "Additional IP", "mail.atelier-exemple.fr"],
          ],
        },
        primary: null,
        secondary: [],
      },
      {
        id: "ns5019932.ip-203-0-113.eu",
        offer: "Rise-1 · Roubaix (RBX8)",
        status: "En service",
        ok: true,
        infos: [
          { k: "Processeur", v: "Intel Xeon-E 2386G · 6c/12t" },
          { k: "Mémoire", v: "32 Go DDR4 ECC" },
          { k: "Stockage", v: "2 × 512 Go NVMe" },
          { k: "Système", v: "Proxmox VE 8" },
          { k: "IPv4", v: "203.0.113.60" },
          { k: "Renouvellement", v: "3 fév. 2027" },
        ],
        table: {
          title: "Adresses IP",
          cols: ["Adresse", "Type", "Reverse"],
          rows: [
            ["203.0.113.60", "IPv4 principale", "ns5019932.ip-203-0-113.eu"],
            ["2001:db8:2::1", "IPv6", "—"],
          ],
        },
        primary: null,
        secondary: [],
      },
    ],
  },
  {
    id: "vps",
    label: "VPS",
    icon: "cube",
    primary: { label: "Console KVM", icon: "terminal-window" },
    secondary: [{ label: "Snapshot", icon: "camera" }],
    items: [
      {
        id: "vps-8f21c4a0.vps.ovh.net",
        offer: "VPS-2 · Strasbourg (SBG)",
        status: "En service",
        ok: true,
        infos: [
          { k: "vCores", v: "6" },
          { k: "Mémoire", v: "12 Go" },
          { k: "Stockage", v: "100 Go NVMe" },
          { k: "Système", v: "Ubuntu 24.04" },
          { k: "IPv4", v: "203.0.113.42" },
          { k: "Renouvellement", v: "1 oct. 2026" },
        ],
        table: {
          title: "Snapshots",
          cols: ["Nom", "Date", "Taille"],
          rows: [["avant-maj-php", "18 sept. 2026", "14,2 Go"]],
        },
        primary: null,
        secondary: [],
      },
    ],
  },
  {
    id: "email",
    label: "E-mails",
    icon: "envelope-simple",
    primary: { label: "Créer une adresse", icon: "plus" },
    secondary: [],
    items: [
      {
        id: "MX Plan · atelier-exemple.fr",
        offer: "MX Plan 5 comptes",
        status: "Actif",
        ok: true,
        infos: [
          { k: "Comptes", v: "3 / 5" },
          { k: "Stockage total", v: "4,1 Go" },
          { k: "Redirections", v: "2" },
          { k: "Webmail", v: "Activé" },
        ],
        table: {
          title: "Adresses",
          cols: ["Adresse", "Quota", "Utilisé"],
          rows: [
            ["contact@atelier-exemple.fr", "5 Go", "2,8 Go"],
            ["camille@atelier-exemple.fr", "5 Go", "1,1 Go"],
            ["factures@atelier-exemple.fr", "5 Go", "0,2 Go"],
          ],
        },
        primary: null,
        secondary: [],
      },
    ],
  },
];

export function sampleOtherSections(): {
  id: SectionId;
  label: string;
  icon: IconName;
  count: number;
}[] {
  return OTHER_SECTIONS.map((s) => ({
    id: s.id,
    label: s.label,
    icon: s.icon,
    count: s.items.length,
  }));
}

export function sampleOtherProducts(section: SectionId): ProductSummary[] {
  const found = OTHER_SECTIONS.find((s) => s.id === section);
  if (!found) return [];
  return found.items.map((i) => ({
    id: i.id,
    offer: i.offer,
    status: i.status,
    ok: i.ok,
  }));
}

export function sampleOtherProduct(
  section: SectionId,
  id: string,
): ProductDetail | null {
  const found = OTHER_SECTIONS.find((s) => s.id === section);
  const item = found?.items.find((i) => i.id === id);
  if (!found || !item) return null;
  return { ...item, primary: found.primary, secondary: found.secondary };
}

// ---------------------------------------------------------------------------
// Hébergements web d'exemple
//
// ⚠ Comme tout ce fichier : aucun domaine réel, aucun nichandle réel, et
// uniquement des adresses de documentation — RFC 5737 (203.0.113.0/24,
// 198.51.100.0/24) et RFC 3849 (2001:db8::/32).
// ---------------------------------------------------------------------------

function address(url: string | null, port: number | null): {
  url: string | null;
  port: number | null;
} {
  return { url, port };
}

/**
 * Les capacités d'une offre. Relevées sur l'API : seules les offres Cloud Web
 * autorisent les variables d'environnement et les runtimes, et une offre fournie
 * avec un domaine n'autorise ni cron, ni SSH, ni compte supplémentaire.
 */
function capabilities(
  options: Partial<HostingCapabilities> = {},
): HostingCapabilities {
  return {
    attachedDomains: 1,
    extraUsers: 0,
    envVars: 0,
    runtimes: 0,
    databaseEngines: 0,
    sitesRecommended: 1,
    crontab: false,
    ssh: false,
    filesBrowser: true,
    moduleOneClick: false,
    disk: { type: "ssd", unit: "GB", value: 10 },
    traffic: null,
    languages: null,
    databases: null,
    privateDatabases: null,
    emails: null,
    highlight: null,
    ...options,
  };
}

type HostEntry = {
  service: HostingService;
  capabilities: HostingCapabilities;
  attachedDomains: AttachedDomain[];
  users: HostingUser[];
  databases: Database[];
  dumps: Record<string, DatabaseDump[]>;
  crons: Cron[];
  envVars: EnvVar[];
  runtimes: Runtime[];
  ssl: HostingSsl | null;
  tasks: HostingTask[];
};

function hostingTask(
  fn: string,
  status: string,
  options: Partial<HostingTask> = {},
): HostingTask {
  return {
    id: newId(),
    function: fn,
    status,
    objectType: null,
    objectId: null,
    startDate: isoIn(-4),
    lastUpdate: isoIn(-4),
    doneDate: isoIn(-4),
    ...options,
  };
}

function runtime(options: Partial<Runtime> & { id: number; type: string }): Runtime {
  return {
    name: null,
    appEnv: "production",
    publicDir: null,
    appBootstrap: null,
    isDefault: false,
    isDeletable: true,
    status: "created",
    creationDate: isoIn(-400),
    lastUpdate: isoIn(-40),
    taskId: null,
    ...options,
  };
}

function user(options: Partial<HostingUser> & { login: string }): HostingUser {
  return {
    home: "/",
    state: "rw",
    sshState: "none",
    isPrimaryAccount: false,
    serviceManagementCredentials: {
      ftp: address(null, 21),
      ssh: address(null, 22),
    },
    ...options,
  };
}

/** Une sauvegarde, positionnée par son âge et ce qu'il lui reste à vivre. */
function dump(type: string, createdDaysAgo: number, expiresInDays: number): DatabaseDump {
  return {
    id: newId(),
    type,
    status: "created",
    creationDate: isoIn(-createdDaysAgo),
    deletionDate: isoIn(expiresInDays),
    url: null,
    taskId: null,
  };
}

function hostAtelier(): HostEntry {
  const serviceName = "atelierxx.cluster121.hosting.ovh.net";
  return {
    service: {
      serviceName,
      displayName: "Site de l'atelier",
      // Seule une offre Cloud Web autorise les variables d'environnement et
      // plusieurs configurations d'exécution : le jeu de données doit être
      // cohérent avec ce que les capacités annoncent.
      offer: "CLOUDWEB_2",
      state: "active",
      resourceType: "shared",
      primaryLogin: "atelierxx",
      home: "/homez.121/atelierxx",
      defaultAttachedDomain: "atelier-exemple.fr",

      // Deux unités différentes sur le même quota : c'est exactement le piège que
      // l'interface doit convertir avant de tracer une jauge.
      quotaSize: { unit: "GB", value: 100 },
      quotaUsed: { unit: "MB", value: 38912 },
      trafficQuotaSize: null,
      trafficQuotaUsed: null,

      cluster: "cluster121",
      datacenter: "gra3",
      filer: "121",
      hostingIp: "203.0.113.10",
      hostingIpv6: "2001:db8::1",
      clusterIp: "203.0.113.1",
      clusterIpv6: "2001:db8::ff",
      countriesIp: [
        { country: "FR", ip: "203.0.113.10", ipv6: "2001:db8::1" },
        { country: "BE", ip: "198.51.100.10", ipv6: null },
      ],
      operatingSystem: "linux",
      phpVersions: [
        { version: "8.3", support: "stable" },
        { version: "8.2", support: "stable" },
        { version: "8.1", support: "security" },
        { version: "7.4", support: "deprecated" },
      ],
      lastOvhConfigScan: isoIn(-2),

      hasCdn: false,
      hasHostedSsl: true,
      multipleSSL: true,
      boostOffer: null,
      recommendedOffer: null,
      serviceManagementAccess: {
        ftp: address("ftp.cluster121.hosting.ovh.net", 21),
        http: address("http://atelierxx.cluster121.hosting.ovh.net", 80),
        ssh: address("ssh.cluster121.hosting.ovh.net", 22),
      },
      updates: [],
      token: null,
    },
    capabilities: capabilities({
      attachedDomains: 2000,
      extraUsers: 1000000,
      envVars: 1000000,
      runtimes: 2,
      databaseEngines: 4,
      sitesRecommended: -1,
      crontab: true,
      ssh: true,
      moduleOneClick: true,
      disk: { type: "ssd", unit: "GB", value: 100 },
      databases: [
        {
          available: 2,
          engines: ["mysql", "mariadb", "postgresql"],
          isolation: "shared",
          quota: { unit: "MB", value: 512 },
          type: "sqlperso",
        },
      ],
    }),
    attachedDomains: [
      {
        domain: "atelier-exemple.fr",
        path: "www",
        ssl: true,
        runtimeId: 1,
        firewall: "active",
        cdn: "none",
        ownLog: null,
        ipLocation: "FR",
        bypassDNSConfiguration: false,
      },
      {
        domain: "www.atelier-exemple.fr",
        path: "www",
        ssl: true,
        runtimeId: 1,
        firewall: "active",
        cdn: "none",
        ownLog: "atelier-exemple.fr",
        ipLocation: "FR",
        bypassDNSConfiguration: false,
      },
      // Attaché, mais sans enregistrement dans la zone : le site ne répond pas,
      // et c'est le cas que la colonne DNS existe pour montrer.
      {
        domain: "boutique.atelier-exemple.fr",
        path: "boutique",
        ssl: true,
        runtimeId: 2,
        firewall: "none",
        cdn: "none",
        ownLog: null,
        ipLocation: "FR",
        bypassDNSConfiguration: false,
      },
    ],
    users: [
      user({
        login: "atelierxx",
        home: "/",
        sshState: "active",
        isPrimaryAccount: true,
        serviceManagementCredentials: {
          ftp: address("ftp.cluster121.hosting.ovh.net", 21),
          ssh: address("ssh.cluster121.hosting.ovh.net", 22),
        },
      }),
      user({ login: "atelierxx-thomas", home: "/boutique", sshState: "sftponly" }),
    ],
    databases: [
      {
        name: "atelierxxmain.mysql.db",
        type: "mysql",
        version: "8.0",
        versionSupport: "stable",
        databaseServiceDeprecated: false,
        state: "ok",
        status: "created",
        quotaSize: { unit: "MB", value: 512 },
        quotaUsed: { unit: "MB", value: 187.4 },
        server: "atelierxxmain.mysql.db",
        port: 3306,
        user: "atelierxxmain",
        guiURL: "https://phpmyadmin.hosting.ovh.net",
        dumps: 2,
        mode: "classic",
        databaseType: "mysql",
        sqlpersoId: null,
        lastCheck: isoIn(-1),
        taskId: null,
      },
    ],
    dumps: {
      // Une sauvegarde qui périme demain : le compte à rebours doit se voir.
      "atelierxxmain.mysql.db": [dump("daily.1", 0.4, 0.6), dump("weekly.1", 3, 4)],
    },
    crons: [
      {
        id: 4101,
        command: "www/wp-cron.php",
        frequency: "0 * * * *",
        // Troisième orthographe de la version : `php8.3` ici, `8.3` sur
        // l'hébergement, `phpfpm-8.3` sur le runtime.
        language: "php8.3",
        description: "Tâches de fond du site",
        email: null,
        status: "enabled",
        state: "created",
      },
      {
        id: 4102,
        command: "boutique/bin/sync-stock.php",
        frequency: "0 3 * * *",
        language: "php7.4",
        description: "Synchronisation du stock",
        email: "camille@atelier-exemple.fr",
        status: "enabled",
        state: "created",
      },
    ],
    envVars: [
      { key: "APP_ENV", value: "", type: "string", status: "created", taskId: null },
      {
        key: "STRIPE_SECRET_KEY",
        value: "",
        type: "password",
        status: "created",
        taskId: null,
      },
    ],
    runtimes: [
      runtime({
        id: 1,
        name: "Par défaut",
        type: "phpfpm-8.3",
        isDefault: true,
        isDeletable: false,
      }),
      runtime({ id: 2, name: "Boutique", type: "phpfpm-7.4", publicDir: "public" }),
    ],
    ssl: {
      provider: "LETSENCRYPT",
      type: "SAN",
      status: "created",
      regenerable: true,
      isReportable: false,
      taskId: null,
    },
    tasks: [
      hostingTask("database/dump", "done", {
        objectType: "database",
        objectId: "atelierxxmain.mysql.db",
        startDate: isoIn(-4),
        doneDate: isoIn(-4),
      }),
      hostingTask("attachedDomain/create", "done", {
        objectType: "attachedDomain",
        objectId: "boutique.atelier-exemple.fr",
        startDate: isoIn(-14),
        doneDate: isoIn(-14),
      }),
    ],
  };
}

function hostCmartin(): HostEntry {
  const serviceName = "cmartinvx.cluster028.hosting.ovh.net";
  return {
    service: {
      serviceName,
      // Sans `displayName`, le titre est le code d'offre brut : `start1m`.
      displayName: null,
      offer: "start1m",
      state: "active",
      resourceType: "shared",
      primaryLogin: "cmartinvx",
      home: "/homez.028/cmartinvx",
      defaultAttachedDomain: "exemple.eu",

      // 912 Mo sur 1 Go : au-delà du seuil, la jauge et l'alerte doivent le dire.
      quotaSize: { unit: "GB", value: 1 },
      quotaUsed: { unit: "MB", value: 912 },
      trafficQuotaSize: { unit: "TB", value: 1 },
      trafficQuotaUsed: { unit: "GB", value: 214 },

      cluster: "cluster028",
      datacenter: "p19",
      filer: "028",
      hostingIp: "203.0.113.28",
      hostingIpv6: null,
      clusterIp: "203.0.113.2",
      clusterIpv6: null,
      countriesIp: null,
      operatingSystem: "linux",
      phpVersions: [
        { version: "8.3", support: "stable" },
        { version: "7.4", support: "deprecated" },
      ],
      lastOvhConfigScan: null,

      hasCdn: false,
      hasHostedSsl: false,
      multipleSSL: false,
      boostOffer: null,
      // L'API suggère elle-même une autre offre : c'est une information, pas une
      // publicité inventée par l'interface.
      recommendedOffer: "perso2014",
      serviceManagementAccess: {
        ftp: address("ftp.cluster028.hosting.ovh.net", 21),
        http: address("http://cmartinvx.cluster028.hosting.ovh.net", 80),
        // Pas d'accès shell sur cette offre : l'absence d'URL est la seule
        // information disponible, et elle doit griser les réglages SSH.
        ssh: address(null, null),
      },
      updates: [],
      token: null,
    },
    // `start1m` : un seul domaine servi, aucun cron, aucun SSH, aucun compte
    // supplémentaire, aucune variable. C'est le cas qui doit griser, pas masquer.
    capabilities: capabilities({
      attachedDomains: 1,
      databaseEngines: 1,
      databases: [
        {
          available: 1,
          engines: ["mysql"],
          isolation: "shared",
          quota: { unit: "MB", value: 25 },
          type: "sqlperso",
        },
      ],
      disk: { type: "hdd", unit: "GB", value: 1 },
    }),
    attachedDomains: [
      {
        domain: "exemple.eu",
        path: "www",
        ssl: false,
        runtimeId: 1,
        firewall: "none",
        cdn: "none",
        ownLog: null,
        ipLocation: "FR",
        bypassDNSConfiguration: false,
      },
    ],
    users: [user({ login: "cmartinvx", home: "/", isPrimaryAccount: true })],
    databases: [
      {
        name: "cmartinvxblog.mysql.db",
        type: "mysql",
        version: "5.6",
        // L'API dit elle-même que cette version est périmée : c'est l'information
        // la plus utile du périmètre.
        versionSupport: "deprecated",
        databaseServiceDeprecated: false,
        state: "ok",
        status: "created",
        quotaSize: { unit: "MB", value: 25 },
        quotaUsed: { unit: "KB", value: 18842 },
        server: "cmartinvxblog.mysql.db",
        port: 3306,
        user: "cmartinvxblog",
        guiURL: "https://phpmyadmin.hosting.ovh.net",
        dumps: 1,
        mode: "classic",
        databaseType: "mysql",
        sqlpersoId: null,
        lastCheck: isoIn(-3),
        taskId: null,
      },
    ],
    dumps: { "cmartinvxblog.mysql.db": [dump("daily.1", 0.2, 0.8)] },
    crons: [],
    envVars: [],
    runtimes: [
      runtime({
        id: 1,
        name: "Par défaut",
        type: "phpfpm-7.4",
        isDefault: true,
        isDeletable: false,
      }),
    ],
    ssl: null,
    tasks: [
      hostingTask("user/changePassword", "done", {
        objectType: "user",
        objectId: "cmartinvx",
        startDate: isoIn(-300),
        doneDate: isoIn(-300),
      }),
    ],
  };
}

function hostVitrine(): HostEntry {
  const serviceName = "vitrinexx.cluster003.hosting.ovh.net";
  return {
    service: {
      serviceName,
      displayName: null,
      // Code fossile : aucune table de correspondance ne le connaîtrait.
      offer: "deproxxl2012",
      // `bloqued`, pas `blocked` : les deux graphies existent dans l'API et
      // l'interface doit traiter les deux.
      state: "bloqued",
      resourceType: "shared",
      primaryLogin: "vitrinexx",
      home: "/homez.003/vitrinexx",
      defaultAttachedDomain: "vitrine-exemple.net",

      quotaSize: { unit: "GB", value: 10 },
      quotaUsed: null,
      trafficQuotaSize: null,
      trafficQuotaUsed: null,

      cluster: "cluster003",
      datacenter: "sbg5",
      filer: null,
      hostingIp: "198.51.100.3",
      hostingIpv6: null,
      clusterIp: null,
      clusterIpv6: null,
      countriesIp: null,
      operatingSystem: "linux",
      phpVersions: [{ version: "7.4", support: "end-of-life" }],
      lastOvhConfigScan: null,

      hasCdn: null,
      hasHostedSsl: null,
      multipleSSL: false,
      boostOffer: null,
      recommendedOffer: "perso2014",
      serviceManagementAccess: {
        ftp: address("ftp.cluster003.hosting.ovh.net", 21),
        http: address(null, null),
        ssh: address(null, null),
      },
      updates: ["Migration de cluster proposée par OVHcloud"],
      token: null,
    },
    capabilities: capabilities({ filesBrowser: false }),
    // Le DNS de ce domaine n'est pas dans le compte : rien n'est vérifiable, et
    // l'API ne pourrait pas y écrire.
    attachedDomains: [
      {
        domain: "vitrine-exemple.net",
        path: "www",
        ssl: false,
        runtimeId: 1,
        firewall: "none",
        cdn: "none",
        ownLog: null,
        ipLocation: "FR",
        bypassDNSConfiguration: true,
      },
    ],
    users: [user({ login: "vitrinexx", home: "/", isPrimaryAccount: true })],
    databases: [],
    dumps: {},
    crons: [],
    envVars: [],
    runtimes: [
      runtime({
        id: 1,
        name: null,
        type: "phpfpm-7.4",
        isDefault: true,
        isDeletable: false,
      }),
    ],
    ssl: null,
    tasks: [],
  };
}

let hostStore: Map<string, HostEntry> | null = null;

function hostDb(): Map<string, HostEntry> {
  if (!hostStore) {
    hostStore = new Map([
      ["atelierxx.cluster121.hosting.ovh.net", hostAtelier()],
      ["cmartinvx.cluster028.hosting.ovh.net", hostCmartin()],
      ["vitrinexx.cluster003.hosting.ovh.net", hostVitrine()],
    ]);
  }
  return hostStore;
}

function host(serviceName: string): HostEntry {
  const found = hostDb().get(serviceName);
  if (!found) {
    throw { kind: "notFound", message: `hébergement ${serviceName} inconnu` };
  }
  return found;
}

// ---------------------------------------------------------------------------
// Hébergements — lecture
// ---------------------------------------------------------------------------

export function sampleHostingNames(): string[] {
  return [...hostDb().keys()];
}

export function sampleHostingService(serviceName: string): HostingService {
  return { ...host(serviceName).service };
}

export function sampleHostingBundle(serviceName: string): HostingBundle {
  const h = host(serviceName);
  return {
    serviceName,
    service: { ...h.service },
    capabilities: { ...h.capabilities },
    attachedDomains: h.attachedDomains.map((a) => ({ ...a })),
    users: h.users.map((u) => ({ ...u })),
    databases: h.databases.map((b) => ({ ...b })),
    dumps: Object.fromEntries(
      Object.entries(h.dumps).map(([k, v]) => [k, v.map((d) => ({ ...d }))]),
    ),
    crons: h.crons.map((c) => ({ ...c })),
    envVars: h.envVars.map((v) => ({ ...v })),
    runtimes: h.runtimes.map((r) => ({ ...r })),
    ssl: h.ssl ? { ...h.ssl } : null,
    tasks: h.tasks.map((t) => ({ ...t })),
    partialErrors: [],
  };
}

/**
 * Les capacités d'une offre d'exemple.
 *
 * Une offre inconnue retombe sur le jeu le plus restreint : c'est ce que répond
 * l'API pour les offres fournies avec un domaine, et c'est le cas qui met le
 * plus l'interface à l'épreuve.
 */
export function sampleOfferCapabilities(offer: string): HostingCapabilities {
  for (const entry of hostDb().values()) {
    if (entry.service.offer === offer) return { ...entry.capabilities };
  }
  return capabilities();
}

/** Les zones du compte : ce sont les mêmes que les domaines d'exemple. */
export function sampleZoneNames(): string[] {
  return sampleDomainNames();
}

/** Les A, AAAA et CNAME d'une zone d'exemple, pour l'aperçu d'impact DNS. */
export function sampleZoneAddresses(zone: string): Record_[] {
  const found = db().get(zone);
  if (!found) return [];
  return found.records
    .filter((r) => ["A", "AAAA", "CNAME"].includes(r.fieldType))
    .map((r) => ({ ...r }));
}

export function sampleDatabaseDumps(
  serviceName: string,
  database: string,
): DatabaseDump[] {
  return (host(serviceName).dumps[database] ?? []).map((d) => ({ ...d }));
}

// ---------------------------------------------------------------------------
// Hébergements — écriture
//
// Chaque écriture rend une tâche qui finit toute seule : c'est ce que fait l'API,
// et c'est ce qui permet de vérifier le suivi d'opérations sans compte.
// ---------------------------------------------------------------------------

function pushHostTask(
  serviceName: string,
  fn: string,
  objectType: string,
  objectId: string,
  after: number,
  apply: (entry: HostEntry) => void,
): HostingTask {
  const h = host(serviceName);
  const task = hostingTask(fn, "doing", {
    objectType,
    objectId,
    startDate: nowIso(),
    lastUpdate: nowIso(),
    doneDate: null,
  });
  h.tasks = [task, ...h.tasks];
  settleLater(after, () => {
    const cur = hostDb().get(serviceName);
    if (!cur) return;
    apply(cur);
    cur.tasks = cur.tasks.map((t) =>
      t.id === task.id ? { ...t, status: "done", doneDate: nowIso() } : t,
    );
  });
  return { ...task };
}

export function sampleCreateAttachedDomain(
  serviceName: string,
  payload: AttachedDomain,
): HostingTask {
  const domain = payload.domain ?? "";
  const task = pushHostTask(
    serviceName,
    "attachedDomain/create",
    "attachedDomain",
    domain,
    2600,
    (h) => {
      h.attachedDomains = [...h.attachedDomains, { ...payload }];
    },
  );
  // Sans le contournement, l'API écrit dans la zone : le mode exemple le fait
  // aussi, sinon l'aperçu d'impact DNS ne serait qu'une promesse.
  if (payload.bypassDNSConfiguration !== true) applyDnsForAttachedDomain(serviceName, payload);
  return task;
}

export function sampleUpdateAttachedDomain(
  serviceName: string,
  domain: string,
  payload: AttachedDomain,
): void {
  const h = host(serviceName);
  h.attachedDomains = h.attachedDomains.map((a) =>
    a.domain === domain ? { ...payload, domain } : a,
  );
  if (payload.bypassDNSConfiguration !== true) {
    applyDnsForAttachedDomain(serviceName, { ...payload, domain });
  }
}

export function sampleDeleteAttachedDomain(
  serviceName: string,
  domain: string,
): HostingTask {
  return pushHostTask(
    serviceName,
    "attachedDomain/delete",
    "attachedDomain",
    domain,
    2600,
    (h) => {
      h.attachedDomains = h.attachedDomains.filter((a) => a.domain !== domain);
    },
  );
}

/**
 * Remplace les A, AAAA et CNAME du sous-domaine par les adresses de
 * l'hébergement — c'est ce que fait l'API quand `bypassDNSConfiguration` n'est
 * pas `true`, et la zone touchée est bien celle de la famille Domaines.
 */
function applyDnsForAttachedDomain(serviceName: string, payload: AttachedDomain): void {
  const name = (payload.domain ?? "").toLowerCase().replace(/\.$/, "");
  if (!name) return;
  const zone = sampleDomainNames()
    .filter((z) => name === z || name.endsWith(`.${z}`))
    .sort((a, b) => b.length - a.length)[0];
  if (!zone) return;

  const e = db().get(zone);
  if (!e) return;
  const sub = name === zone ? null : name.slice(0, -(zone.length + 1));

  const service = host(serviceName).service;
  const country = (service.countriesIp ?? []).find(
    (c) => c.country === payload.ipLocation,
  );
  const ip = country ? country.ip : service.hostingIp;
  const ipv6 = country ? country.ipv6 : service.hostingIpv6;

  e.records = e.records.filter(
    (r) =>
      (r.subDomain ?? null) !== sub ||
      !["A", "AAAA", "CNAME"].includes(r.fieldType),
  );
  for (const [fieldType, target] of [
    ["A", ip],
    ["AAAA", ipv6],
  ] as const) {
    if (!target) continue;
    e.records.push({
      id: newId(),
      zone,
      fieldType,
      subDomain: sub,
      target,
      ttl: null,
    });
  }
  sampleRefreshZone(zone);
}

export function sampleCreateHostingUser(
  serviceName: string,
  payload: HostingUserCreate,
): HostingTask {
  return pushHostTask(serviceName, "user/create", "user", payload.login, 2600, (h) => {
    h.users = [
      ...h.users,
      user({
        login: payload.login,
        home: payload.home,
        state: payload.state,
        sshState: payload.sshState,
      }),
    ];
  });
}

export function sampleUpdateHostingUser(
  serviceName: string,
  next: HostingUser,
): void {
  const h = host(serviceName);
  if (!h.users.some((u) => u.login === next.login)) {
    throw { kind: "notFound", message: `utilisateur ${next.login} inconnu` };
  }
  pushHostTask(serviceName, "user/update", "user", next.login, 2200, (cur) => {
    cur.users = cur.users.map((u) => (u.login === next.login ? { ...next } : u));
  });
}

/**
 * Le changement de mot de passe ne laisse aucune trace lisible : rien à muter,
 * mais la tâche existe — et un login inconnu échoue ici comme il échouerait là-bas.
 */
export function sampleChangeHostingUserPassword(
  serviceName: string,
  login: string,
): HostingTask {
  const h = host(serviceName);
  if (!h.users.some((u) => u.login === login)) {
    throw { kind: "notFound", message: `utilisateur ${login} inconnu` };
  }
  return pushHostTask(serviceName, "user/changePassword", "user", login, 2200, () => {});
}

export function sampleDeleteHostingUser(
  serviceName: string,
  login: string,
): HostingTask {
  return pushHostTask(serviceName, "user/delete", "user", login, 2600, (h) => {
    h.users = h.users.filter((u) => u.login !== login);
  });
}

export function sampleCreateDatabaseDump(
  serviceName: string,
  database: string,
): HostingTask {
  const h = host(serviceName);
  h.databases = h.databases.map((b) =>
    b.name === database ? { ...b, status: "dumping" } : b,
  );
  return pushHostTask(serviceName, "database/dump", "database", database, 3000, (cur) => {
    cur.databases = cur.databases.map((b) =>
      b.name === database ? { ...b, status: "created", dumps: b.dumps + 1 } : b,
    );
    // Une sauvegarde manuelle est gardée 30 jours : la date de péremption vient
    // de l'API, elle n'est pas choisie ici.
    cur.dumps = {
      ...cur.dumps,
      [database]: [dump("now", 0, 30), ...(cur.dumps[database] ?? [])],
    };
  });
}

export function sampleCreateCron(
  serviceName: string,
  payload: CronInput,
): HostingTask {
  const id = newId();
  return pushHostTask(serviceName, "cron/create", "cron", payload.command, 2600, (h) => {
    h.crons = [
      ...h.crons,
      {
        id,
        command: payload.command,
        frequency: payload.frequency,
        language: payload.language,
        description: payload.description,
        email: payload.email,
        status: payload.status,
        state: "created",
      },
    ];
  });
}

export function sampleDeleteCron(serviceName: string, id: number): HostingTask {
  const h = host(serviceName);
  const found = h.crons.find((c) => c.id === id);
  return pushHostTask(
    serviceName,
    "cron/delete",
    "cron",
    found?.command ?? String(id),
    2400,
    (cur) => {
      cur.crons = cur.crons.filter((c) => c.id !== id);
    },
  );
}

export function sampleCreateEnvVar(
  serviceName: string,
  key: string,
  kind: string,
): HostingTask {
  return pushHostTask(serviceName, "envVar/create", "envVar", key, 2400, (h) => {
    // La valeur n'est jamais renvoyée par l'API : le magasin d'exemple ne la
    // garde donc pas non plus, sinon il mentirait sur ce qui est lisible.
    h.envVars = [
      ...h.envVars,
      { key, value: "", type: kind, status: "created", taskId: null },
    ];
  });
}

export function sampleDeleteEnvVar(serviceName: string, key: string): HostingTask {
  return pushHostTask(serviceName, "envVar/delete", "envVar", key, 2400, (h) => {
    h.envVars = h.envVars.filter((v) => v.key !== key);
  });
}

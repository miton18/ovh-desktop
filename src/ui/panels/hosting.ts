/**
 * La page d'un hébergement web : en-tête, alertes, onglets.
 *
 * L'en-tête porte ce qui concerne l'hébergement entier, et surtout ce que l'API
 * dit elle-même de périmé — version de base de données dépréciée, moteur PHP
 * plus maintenu, offre recommandée. C'est l'information la plus utile du
 * périmètre, et la console officielle l'enterre dans une colonne : ici elle est
 * remontée en tête, avec un lien vers l'onglet où l'on agit.
 *
 * Les quotas sont des `complexType.UnitAndValue` : une unité accompagne le
 * nombre et elle n'est pas la même d'un champ à l'autre. Les jauges passent donc
 * toutes par `quotaPercent`, qui convertit avant de diviser.
 */

import { isTerminalHostingStatus } from "../../ovh-api";
import { hostingTitle } from "../data";
import { button, el, frag } from "../dom";
import { icon, spinner } from "../icons";
import type { IconName } from "../icons";
import {
  dbEngineLabel,
  formatBytes,
  formatCapacity,
  hostingStatePresentation,
  isBlockedHostingState,
  plural,
  QUOTA_ALERT_PERCENT,
  quotaPercent,
  runtimeLabel,
  toBytes,
} from "../labels";
import { copyButton } from "./copy";
import type { HostingContext } from "./hosting-context";
import {
  databaseAllowance,
  defaultRuntime,
  ftpHost,
  isDeprecatedEngine,
  runtimeName,
  shellAvailable,
  sshHost,
  type HostingTab,
} from "./hosting-state";
import { renderSitesTab } from "./hosting-sites";
import { renderUsersTab } from "./hosting-users";
import { renderDatabasesTab } from "./hosting-db";
import { renderExecTab } from "./hosting-exec";
import { renderCronTab } from "./hosting-cron";
import { renderHostingOpsTab } from "./hosting-ops";

export function renderHostingPage(ctx: HostingContext): DocumentFragment {
  return frag(
    renderHeader(ctx),
    renderPartialErrors(ctx),
    renderTabs(ctx),
    renderActiveTab(ctx),
  );
}

/** Les tâches qui n'ont pas encore fini. Aucune ne s'annule : on les compte. */
export function runningHostingTasks(ctx: HostingContext): number {
  return ctx.bundle.tasks.filter((t) => !isTerminalHostingStatus(t.status)).length;
}

// ---------------------------------------------------------------------------
// En-tête
// ---------------------------------------------------------------------------

function renderHeader(ctx: HostingContext): HTMLElement {
  const { bundle } = ctx;
  const service = bundle.service;
  const state = hostingStatePresentation(service.state);
  const running = runningHostingTasks(ctx);

  return el("div", { class: "host-head" }, [
    el("div", { class: "host-head-row" }, [
      el("h1", { class: "page-title", text: hostingTitle(service) }),
      el("span", { class: `tag ${state.tagClass}`, text: state.label }),
      el("div", { class: "spacer" }),
      running > 0
        ? button(`${running} ${plural(running, "opération")} en cours`, {
            class: "btn btn-ghost activity-btn",
            icon: spinner(15),
            onClick: () => ctx.goToTab("ops"),
          })
        : null,
    ]),
    el("div", { class: "host-meta" }, [
      el("span", { class: "mono", text: service.serviceName }),
      el("span", {}, [
        "Offre ",
        el("span", { class: "mono", text: service.offer }),
      ]),
      el("span", { text: infraLine(ctx) }),
    ]),
    renderCards(ctx),
    renderAddresses(ctx),
    renderAlerts(ctx),
  ]);
}

/** Où vit l'hébergement — c'est ce que le support demande en premier. */
function infraLine(ctx: HostingContext): string {
  const s = ctx.bundle.service;
  return [
    s.cluster,
    s.filer ? `filer ${s.filer}` : null,
    s.datacenter.toUpperCase(),
    s.operatingSystem === "windows" ? "Windows" : "Linux",
  ]
    .filter(Boolean)
    .join(" · ");
}

type Card = {
  k: string;
  v: string;
  /** Pourcentage de la jauge, `null` pour ne pas en tracer. */
  pct: number | null;
  sub: string | null;
  tone: "" | "muted" | "warn";
  tab: HostingTab | null;
};

function renderCards(ctx: HostingContext): HTMLElement {
  const { bundle } = ctx;
  const service = bundle.service;

  const diskUsed = toBytes(service.quotaUsed);
  const diskSize = toBytes(service.quotaSize);
  const diskPct = quotaPercent(service.quotaUsed, service.quotaSize);
  const trafficPct = quotaPercent(service.trafficQuotaUsed, service.trafficQuotaSize);
  const runtime = defaultRuntime(bundle);
  const runtimeDeprecated = runtime
    ? isDeprecatedEngine(runtime.type, service)
    : false;
  const deprecatedDatabases = databaseNote(ctx);
  /**
   * `capabilities.traffic` à `null` veut dire « pas de quota » — donc illimité,
   * et non pas « on ne sait pas ». Les deux se disent différemment.
   */
  const trafficUnlimited =
    bundle.capabilities !== null &&
    bundle.capabilities.traffic === null &&
    service.trafficQuotaSize === null;

  // `capabilities.disk` nomme le support (SSD, NVMe…), que la fiche du service ne
  // porte pas : c'est un détail, mais il ne coûte rien et répond à une question.
  const diskType = bundle.capabilities?.disk?.type;
  const diskSub =
    diskPct === null
      ? "Consommation non renvoyée"
      : [`${Math.round(diskPct)} % utilisé`, diskType?.toUpperCase()]
          .filter(Boolean)
          .join(" · ");

  const cards: Card[] = [
    {
      k: "Espace disque",
      // `quotaUsed` est nullable : dire « inconnu » plutôt que tracer un zéro.
      v:
        diskUsed === null
          ? `? sur ${formatBytes(diskSize)}`
          : `${formatBytes(diskUsed)} sur ${formatBytes(diskSize)}`,
      pct: diskPct,
      sub: diskSub,
      tone: diskPct !== null && diskPct >= QUOTA_ALERT_PERCENT ? "warn" : "",
      tab: null,
    },
    trafficPct === null
      ? {
          k: "Trafic",
          // Pas de quota de trafic dans l'offre : c'est illimité, pas
          // « non mesuré ». Et rien à tracer, donc pas de jauge.
          v: trafficUnlimited ? "Illimité" : "Non mesuré",
          pct: null,
          sub: trafficUnlimited
            ? "Aucun quota de trafic sur cette offre"
            : "Consommation de trafic non renvoyée par l'API",
          tone: "muted",
          tab: null,
        }
      : {
          k: "Trafic du mois",
          v: `${formatBytes(toBytes(service.trafficQuotaUsed))} sur ${formatBytes(
            toBytes(service.trafficQuotaSize),
          )}`,
          pct: trafficPct,
          sub: `${Math.round(trafficPct)} % consommé`,
          tone: trafficPct >= QUOTA_ALERT_PERCENT ? "warn" : "",
          tab: null,
        },
    {
      k: "Exécution par défaut",
      v: runtime ? runtimeLabel(runtime.type) : "—",
      pct: null,
      sub: runtimeDeprecated ? "Version plus maintenue" : null,
      tone: runtimeDeprecated ? "warn" : "",
      tab: "exec",
    },
    {
      k: "Multisites",
      v: String(bundle.attachedDomains.length),
      pct: null,
      sub: service.defaultAttachedDomain
        ? `Principal : ${service.defaultAttachedDomain}`
        : null,
      tone: "",
      tab: "sites",
    },
    {
      k: "Bases de données",
      // « 1 sur 2 » plutôt que « 1 » quand l'offre dit combien elle en inclut :
      // c'est `capabilities`, pas `HostingService`, qui porte cette limite.
      v: formatCapacity(
        bundle.databases.length,
        databaseAllowance(bundle.capabilities),
      ),
      pct: null,
      sub: deprecatedDatabases,
      tone: deprecatedDatabases ? "warn" : "",
      tab: "db",
    },
    sslCard(ctx),
  ];

  return el(
    "div",
    { class: "host-cards" },
    cards.map((c) => renderCard(ctx, c)),
  );
}

/** Une base dépréciée se voit dès la carte, pas seulement dans l'onglet. */
function databaseNote(ctx: HostingContext): string | null {
  const n = ctx.bundle.databases.filter(
    (b) => b.versionSupport === "deprecated" || b.databaseServiceDeprecated,
  ).length;
  if (n === 0) return null;
  return `${n} ${plural(n, "version dépréciée", "versions dépréciées")}`;
}

/**
 * Le certificat, à la place de la date d'échéance : `/hosting/web/{sn}` ne porte
 * aucune expiration, et aucune commande de facturation n'existe pour un
 * hébergement. Mieux vaut montrer une information vraie qu'une case vide.
 */
function sslCard(ctx: HostingContext): Card {
  const { bundle } = ctx;
  const ssl = bundle.ssl;
  if (!ssl) {
    return {
      k: "Certificat SSL",
      v: bundle.service.hasHostedSsl === true ? "Aucun" : "Non proposé",
      pct: null,
      sub:
        bundle.service.hasHostedSsl === true
          ? "L'offre permet un certificat hébergé"
          : "Pas de certificat hébergé sur cette offre",
      tone: "muted",
      tab: null,
    };
  }
  return {
    k: "Certificat SSL",
    v: ssl.provider,
    pct: null,
    sub: ssl.status === "created" ? "En service" : ssl.status,
    tone: ssl.status === "created" ? "" : "warn",
    tab: null,
  };
}

function renderCard(ctx: HostingContext, card: Card): HTMLElement {
  const children = [
    el("span", { class: "k", text: card.k }),
    el("span", { class: card.tone ? `v is-${card.tone}` : "v", text: card.v }),
    card.pct !== null
      ? el("span", { class: "host-gauge" }, [
          el("span", {
            class: card.pct >= QUOTA_ALERT_PERCENT ? "bar is-warn" : "bar",
            style: { width: `${card.pct}%` },
          }),
        ])
      : null,
    card.sub ? el("span", { class: "sub", text: card.sub }) : null,
  ];

  if (!card.tab) return el("div", { class: "card host-card" }, children);

  const tab = card.tab;
  return el(
    "button",
    {
      class: "card host-card is-link",
      attrs: { type: "button", title: `${card.k} — aller à l'onglet correspondant` },
      on: { click: () => ctx.goToTab(tab) },
    },
    children,
  );
}

/**
 * Les adresses de l'hébergement.
 *
 * Elles sont là parce qu'elles servent ailleurs : l'IPv4 et l'IPv6 vont dans une
 * zone DNS, le serveur FTP dans un client. Toutes copiables, aucune à recopier à
 * la main.
 */
function renderAddresses(ctx: HostingContext): HTMLElement {
  const service = ctx.bundle.service;
  // L'adresse SSH ne s'affiche que si l'offre l'autorise : `capabilities.ssh` le
  // dit, et l'absence d'URL de gestion sert de repli.
  const shell = shellAvailable(ctx.bundle);
  const entries: [string, string][] = [];
  if (service.hostingIp) entries.push(["IPv4", service.hostingIp]);
  if (service.hostingIpv6) entries.push(["IPv6", service.hostingIpv6]);
  entries.push(["FTP", ftpHost(service)]);
  if (shell) entries.push(["SSH", sshHost(service)]);

  return el("div", { class: "host-ips" }, [
    el("span", { class: "section-note", text: "Adresses" }),
    ...entries.map(([label, value]) =>
      el("span", { class: "host-ip" }, [
        el("span", { class: "k", text: label }),
        el("span", { class: "mono", text: value }),
        copyButton(value, label === "FTP" || label === "SSH" ? `Serveur ${label}` : "Adresse", {
          size: 14,
        }),
      ]),
    ),
  ]);
}

type Alert = {
  icon: IconName;
  tone: "warn" | "info";
  text: string;
  detail: string;
  cta: { label: string; tab: HostingTab } | null;
};

/**
 * Ce que l'API dit elle-même d'anormal ou de périmé.
 *
 * Rien n'est deviné : chaque ligne vient d'un champ — `state`, `versionSupport`,
 * `databaseServiceDeprecated`, `PhpVersion.support`, `recommendedOffer`, les
 * quotas.
 */
function buildAlerts(ctx: HostingContext): Alert[] {
  const { bundle } = ctx;
  const service = bundle.service;
  const state = hostingStatePresentation(service.state);
  const out: Alert[] = [];

  if (isBlockedHostingState(service.state)) {
    out.push({
      icon: "lock-simple",
      tone: "warn",
      text: `Hébergement ${state.label.toLowerCase()}`,
      detail: "Les sites ne sont plus servis. Le support OVHcloud peut en donner la raison.",
      cta: null,
    });
  }
  if (service.state === "maintenance") {
    out.push({
      icon: "wrench",
      tone: "info",
      text: "Maintenance en cours sur le cluster",
      detail: "Les sites peuvent répondre plus lentement.",
      cta: null,
    });
  }

  for (const db of bundle.databases) {
    if (db.versionSupport !== "deprecated" && !db.databaseServiceDeprecated) continue;
    out.push({
      icon: "warning",
      tone: "warn",
      text: `${db.name} tourne sur ${dbEngineLabel(db.type)} ${db.version}, version dépréciée`,
      detail: "Elle ne reçoit plus de correctifs de sécurité.",
      cta: { label: "Voir la base", tab: "db" },
    });
  }

  for (const runtime of bundle.runtimes) {
    if (!isDeprecatedEngine(runtime.type, service)) continue;
    const served = bundle.attachedDomains
      .filter((a) => a.runtimeId === runtime.id)
      .map((a) => a.domain)
      .filter((d): d is string => Boolean(d));
    out.push({
      icon: "warning",
      tone: "warn",
      text: `${runtimeLabel(runtime.type)} n'est plus maintenu`,
      detail:
        served.length > 0
          ? `Configuration « ${runtimeName(runtime)} », sert ${served.join(", ")}.`
          : `Configuration « ${runtimeName(runtime)} », utilisée par aucun multisite.`,
      cta: { label: "Voir l'exécution", tab: "exec" },
    });
  }

  const deprecatedCrons = bundle.crons.filter((c) =>
    isDeprecatedEngine(c.language, service),
  );
  if (deprecatedCrons.length > 0) {
    const n = deprecatedCrons.length;
    out.push({
      icon: "warning",
      tone: "warn",
      text: `${n} ${plural(n, "tâche planifiée", "tâches planifiées")} sur une version de PHP plus maintenue`,
      detail: deprecatedCrons.map((c) => c.description || c.command).join(", "),
      cta: { label: "Voir les tâches", tab: "cron" },
    });
  }

  const diskPct = quotaPercent(service.quotaUsed, service.quotaSize);
  if (diskPct !== null && diskPct >= QUOTA_ALERT_PERCENT) {
    const free = (toBytes(service.quotaSize) ?? 0) - (toBytes(service.quotaUsed) ?? 0);
    out.push({
      icon: "hard-drive",
      tone: "warn",
      text: `Espace disque occupé à ${Math.round(diskPct)} %`,
      detail: `${formatBytes(Math.max(0, free))} disponibles. Les bases de données ont leur propre quota.`,
      cta: null,
    });
  }

  for (const db of bundle.databases) {
    const pct = quotaPercent(db.quotaUsed, db.quotaSize);
    if (pct === null || pct < QUOTA_ALERT_PERCENT) continue;
    out.push({
      icon: "database",
      tone: "warn",
      text: `${db.name} occupe ${Math.round(pct)} % de son quota`,
      detail: "Le quota d'une base est indépendant de l'espace disque de l'hébergement.",
      cta: { label: "Voir la base", tab: "db" },
    });
  }

  if (service.recommendedOffer && service.recommendedOffer !== service.offer) {
    out.push({
      icon: "lightbulb",
      tone: "info",
      text: `OVHcloud suggère l'offre ${service.recommendedOffer}`,
      detail: `Recommandation renvoyée par l'API pour remplacer ${service.offer}.`,
      cta: null,
    });
  }

  for (const update of service.updates) {
    out.push({
      icon: "arrows-clockwise",
      tone: "info",
      text: "Mise à jour proposée par OVHcloud",
      detail: update,
      cta: null,
    });
  }

  return out;
}

function renderAlerts(ctx: HostingContext): HTMLElement | null {
  const alerts = buildAlerts(ctx);
  if (alerts.length === 0) return null;

  return el(
    "div",
    { class: "host-alerts", attrs: { role: "status" } },
    alerts.map((a) => {
      const cta = a.cta;
      const content = [
        icon(a.icon, { size: 15 }),
        el("span", { class: "text", text: a.text }),
        el("span", { class: "detail", text: a.detail }),
        cta ? icon("arrow-right", { size: 14 }) : null,
      ];
      const cls = `host-alert is-${a.tone}`;
      if (!cta) {
        return el("div", { class: cls, attrs: { title: a.detail } }, content);
      }
      return el(
        "button",
        {
          class: `${cls} is-link`,
          attrs: { type: "button", title: `${a.detail} — ${cta.label}` },
          on: { click: () => ctx.goToTab(cta.tab) },
        },
        content,
      );
    }),
  );
}

function renderPartialErrors(ctx: HostingContext): HTMLElement | null {
  const errors = ctx.bundle.partialErrors;
  if (errors.length === 0) return null;
  return el("div", { class: "unsupported", attrs: { role: "status" } }, [
    icon("warning", { size: 16 }),
    el("div", {}, [
      el("div", {
        text: `Certaines données n'ont pas pu être chargées : ${errors.map((e) => e.part).join(", ")}.`,
      }),
      el("div", { class: "section-note", text: errors[0].message }),
    ]),
    button("Réessayer", {
      class: "btn btn-ghost",
      onClick: () => ctx.reload({ force: true }),
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Onglets
// ---------------------------------------------------------------------------

function renderTabs(ctx: HostingContext): HTMLElement {
  const { state } = ctx;
  const running = runningHostingTasks(ctx);

  const tabs: { key: HostingTab; label: string; n: number }[] = [
    { key: "sites", label: "Multisites", n: 0 },
    { key: "users", label: "FTP & SSH", n: 0 },
    { key: "db", label: "Bases de données", n: 0 },
    { key: "exec", label: "Exécution", n: 0 },
    { key: "cron", label: "Tâches planifiées", n: 0 },
    { key: "ops", label: "Opérations", n: running },
  ];

  return el(
    "div",
    {
      class: "tabs",
      attrs: { role: "tablist", "aria-label": "Sections de l'hébergement" },
    },
    tabs.map((t) =>
      el(
        "button",
        {
          class: "tab",
          attrs: {
            type: "button",
            role: "tab",
            id: `htab-${t.key}`,
            "aria-selected": state.tab === t.key,
            "aria-controls": "htabpanel",
            tabindex: state.tab === t.key ? "0" : "-1",
          },
          on: {
            click: () => ctx.goToTab(t.key),
            keydown: (ev) => {
              const order = tabs.map((x) => x.key);
              const at = order.indexOf(state.tab);
              if (ev.key === "ArrowRight") {
                ev.preventDefault();
                ctx.goToTab(order[(at + 1) % order.length]);
              } else if (ev.key === "ArrowLeft") {
                ev.preventDefault();
                ctx.goToTab(order[(at - 1 + order.length) % order.length]);
              }
            },
          },
        },
        [
          el("span", { text: t.label }),
          t.n > 0 ? el("span", { class: "tag tag-accent", text: String(t.n) }) : null,
        ],
      ),
    ),
  );
}

function renderActiveTab(ctx: HostingContext): HTMLElement {
  const { state } = ctx;
  const panel = el("div", {
    attrs: {
      id: "htabpanel",
      role: "tabpanel",
      "aria-labelledby": `htab-${state.tab}`,
      tabindex: "0",
    },
    style: { display: "flex", flexDirection: "column", gap: "var(--space-9)" },
  });

  switch (state.tab) {
    case "sites":
      panel.appendChild(renderSitesTab(ctx));
      break;
    case "users":
      panel.appendChild(renderUsersTab(ctx));
      break;
    case "db":
      panel.appendChild(renderDatabasesTab(ctx));
      break;
    case "exec":
      panel.appendChild(renderExecTab(ctx));
      break;
    case "cron":
      panel.appendChild(renderCronTab(ctx));
      break;
    case "ops":
      panel.appendChild(renderHostingOpsTab(ctx));
      break;
  }

  return panel;
}

/**
 * Onglet « Bases de données ».
 *
 * Deux informations que la console officielle enterre sont ici en tête de ligne :
 *
 * - **`versionSupport` et `databaseServiceDeprecated`** : c'est l'API elle-même
 *   qui dit qu'une version ne reçoit plus de correctifs. Une base en MySQL 5.6
 *   dépréciée mérite un avertissement lisible et la marche à suivre, pas une
 *   colonne de plus ;
 * - **la date de péremption d'une sauvegarde** : chaque `dump` porte une
 *   `deletionDate` automatique. Une sauvegarde qui disparaît demain ne vaut pas
 *   celle qui reste un mois, et c'est le compte à rebours qui le dit.
 *
 * Le quota d'une base est indépendant de l'espace disque de l'hébergement, et
 * c'est encore un `UnitAndValue` : la jauge passe par `quotaPercent`, jamais par
 * une division de valeurs brutes.
 */

import type { Database, DatabaseDump } from "../../ovh-api";
import { createDatabaseDump, describeFailure, loadDatabaseDumps } from "../data";
import { button, el } from "../dom";
import { icon, spinner } from "../icons";
import {
  daysUntil,
  dbEngineLabel,
  dbModeLabel,
  dbStateLabel,
  dbStatusLabel,
  dumpTypeLabel,
  formatBytes,
  formatCapacity,
  formatDate,
  formatDateTime,
  hostingRefusalMessage,
  isDatabaseBusy,
  plural,
  QUOTA_ALERT_PERCENT,
  quotaPercent,
  toBytes,
  versionSupportLabel,
} from "../labels";
import { toast, toastError } from "../toast";
import { copyValue } from "./copy";
import type { HostingContext } from "./hosting-context";
import { databaseAllowance } from "./hosting-state";
import { capabilityEmptyState } from "./hosting-notice";

export function renderDatabasesTab(ctx: HostingContext): HTMLElement {
  const n = ctx.bundle.databases.length;
  // `capabilities.databases[].available` est le nombre de bases incluses dans
  // l'offre : c'est la seule source, `HostingService` ne le porte pas.
  const allowance = databaseAllowance(ctx.bundle.capabilities);
  // `databaseEngines: 0` — ou une allocation nulle — veut dire que l'offre n'en
  // comprend aucune : ni tableau ni bouton, un message.
  const engines = ctx.bundle.capabilities?.databaseEngines;
  const forbidden = allowance === 0 || engines === 0;

  if (forbidden && n === 0) {
    return el("section", { attrs: { "aria-label": "Bases de données" } }, [
      capabilityEmptyState({
        icon: "database",
        title: "Bases de données indisponibles",
        reason:
          "Cette offre n'en comprend aucune : l'API refuserait la création, et il n'y en aura aucune à lister.",
        unlock:
          "Le nombre de bases incluses est déclaré par l'offre, dans ses capacités.",
      }),
    ]);
  }

  return el("section", { attrs: { "aria-label": "Bases de données" } }, [
    el("div", { class: "host-bar" }, [
      el("span", {
        class: "section-note",
        text: forbidden
          ? "Cette offre ne comprend aucune base de données."
          : `${formatCapacity(n, allowance)} ${plural(n, "base")} sur cet hébergement`,
      }),
      el("div", { class: "spacer" }),
      // La création de base n'est pas exposée par le backend : le bouton reste
      // visible avec la raison plutôt que de disparaître sans explication.
      button("Créer une base", {
        class: "btn btn-primary",
        icon: icon("plus"),
        disabled: true,
        title: forbidden
          ? "Cette offre ne comprend aucune base de données."
          : allowance !== null && n >= allowance
            ? `Le nombre de bases incluses dans l'offre (${allowance}) est déjà atteint.`
            : "La création d'une base n'est pas encore exposée par le backend : aucune commande ne la couvre.",
      }),
    ]),
    ...ctx.bundle.databases.map((db) => renderDatabase(ctx, db)),
    n === 0
      ? el("div", {
          class: "placeholder",
          text: forbidden
            ? "Cette offre ne comprend aucune base de données."
            : "Aucune base sur cet hébergement.",
        })
      : null,
  ]);
}

/**
 * La commande de connexion, prête à coller.
 *
 * Elle ne contient pas le mot de passe — l'API ne le rend pas, et `-p` sans
 * valeur le fait demander à l'invite, ce qui est de toute façon le bon réflexe.
 */
function connectionCommand(db: Database): string {
  const shortName = db.name.split(".")[0];
  const server = db.server ?? db.name;
  if (db.type === "postgresql") {
    return `psql -h ${server} -p ${db.port} -U ${db.user} ${shortName}`;
  }
  return `mysql -h ${server} -P ${db.port} -u ${db.user} -p ${shortName}`;
}

function renderDatabase(ctx: HostingContext, db: Database): HTMLElement {
  const { state } = ctx;
  const deprecated = db.versionSupport === "deprecated" || db.databaseServiceDeprecated;
  const pct = quotaPercent(db.quotaUsed, db.quotaSize);
  const busy = isDatabaseBusy(db.status);
  const open = state.dbOpen.has(db.name);
  const engine = dbEngineLabel(db.type);

  return el("div", { class: "db-card" }, [
    el("div", { class: "db-head" }, [
      el("div", { class: "db-identity" }, [
        el("span", { class: "mono db-name", text: db.name }),
        el("div", { class: "db-meta" }, [
          el("span", {
            class: deprecated ? "tag tag-danger" : "tag tag-neutral",
            text: `${engine} ${db.version}${
              deprecated ? ` · ${versionSupportLabel("deprecated")}` : ""
            }`,
          }),
          el("span", { text: dbStateLabel(db.state) }),
          el("span", { text: "·" }),
          el("span", { text: dbModeLabel(db.mode) }),
        ]),
      ]),
      el("div", { class: "db-quota" }, [
        el("span", {
          class: "num",
          text: `${formatBytes(toBytes(db.quotaUsed))} sur ${formatBytes(toBytes(db.quotaSize))}`,
        }),
        el("span", { class: "host-gauge" }, [
          el("span", {
            class:
              pct !== null && pct >= QUOTA_ALERT_PERCENT ? "bar is-warn" : "bar",
            style: { width: `${pct ?? 0}%` },
          }),
        ]),
      ]),
      el("div", { class: "db-actions" }, [
        db.guiURL
          ? el("a", {
              class: "btn btn-ghost",
              text: "Interface web",
              attrs: {
                href: db.guiURL,
                target: "_blank",
                rel: "noreferrer noopener",
                title: db.guiURL,
              },
            })
          : null,
        button("Connexion", {
          class: "btn btn-ghost",
          icon: icon("terminal-window", { size: 15 }),
          title: "Copier la commande de connexion",
          onClick: () => copyValue(connectionCommand(db), "Commande de connexion"),
        }),
        button(`Sauvegardes · ${db.dumps}`, {
          class: "btn btn-secondary",
          icon: icon(open ? "caret-up" : "caret-down", { size: 13 }),
          attrs: { "aria-expanded": open },
          onClick: () => toggleDumps(ctx, db),
        }),
      ]),
    ]),
    deprecated ? renderDeprecationNotice(engine, db) : null,
    busy
      ? el("div", { class: "db-busy" }, [
          spinner(15),
          dbStatusLabel(db.status) ?? db.status,
        ])
      : null,
    open ? renderDumps(ctx, db) : null,
  ]);
}

/**
 * L'avertissement de version dépréciée, avec la marche à suivre.
 *
 * Aucune route ne migre une base : dire « c'est déprécié » sans dire comment en
 * sortir ne sert à rien, et l'enchaînement sauvegarde → nouvelle base → import
 * est le seul chemin réellement possible avec cette API.
 */
function renderDeprecationNotice(engine: string, db: Database): HTMLElement {
  const reason = db.databaseServiceDeprecated
    ? `Le service qui héberge ${db.name} est marqué déprécié par l'API`
    : `${engine} ${db.version} est marquée dépréciée par l'API`;
  return el("div", { class: "db-warn" }, [
    icon("warning", { size: 16 }),
    el("span", {
      text: `${reason} et ne reçoit plus de correctifs de sécurité. Pour migrer : sauvegardez cette base, créez-en une dans une version stable, puis importez-y la sauvegarde.`,
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Sauvegardes
// ---------------------------------------------------------------------------

/**
 * Ouvre le volet et charge les sauvegardes au premier dépliage.
 *
 * `GET …/dump` ne rend que des identifiants : les charger au chargement de la
 * page coûterait des appels pour une liste que personne n'a demandé à voir.
 */
function toggleDumps(ctx: HostingContext, db: Database): void {
  const { state, bundle } = ctx;
  if (state.dbOpen.has(db.name)) {
    state.dbOpen.delete(db.name);
    ctx.rerender();
    return;
  }

  state.dbOpen.add(db.name);
  if (bundle.dumps[db.name] === undefined && !state.dbLoading.has(db.name)) {
    state.dbLoading.add(db.name);
    void loadDatabaseDumps(bundle.serviceName, db.name)
      .then(() => {
        state.dbLoading.delete(db.name);
        ctx.reload();
      })
      .catch((e) => {
        state.dbLoading.delete(db.name);
        toastError(hostingRefusalMessage(describeFailure(e).message));
        ctx.rerender();
      });
  }
  ctx.rerender();
}

function renderDumps(ctx: HostingContext, db: Database): HTMLElement {
  const { state, bundle } = ctx;
  const dumps = bundle.dumps[db.name];
  const loading = state.dbLoading.has(db.name);
  const busy = isDatabaseBusy(db.status);
  const busyKey = `dump:${db.name}`;
  const creating = state.busy.has(busyKey);

  const rows: (Node | null)[] = [];
  if (loading) {
    rows.push(
      el("div", { class: "dump-row is-busy" }, [spinner(14), " Lecture des sauvegardes…"]),
    );
  } else if (dumps === undefined) {
    rows.push(
      el("div", { class: "dump-row" }, [
        el("span", { class: "section-note", text: "Sauvegardes non chargées." }),
      ]),
    );
  } else if (dumps.length === 0) {
    rows.push(
      el("div", { class: "dump-row" }, [
        el("span", { class: "section-note", text: "Aucune sauvegarde disponible." }),
      ]),
    );
  } else {
    for (const dump of sortedByDate(dumps)) rows.push(renderDumpRow(dump));
  }

  return el("div", { class: "db-dumps" }, [
    ...rows,
    el("div", { class: "dump-footer" }, [
      button(creating ? "Envoi…" : "Sauvegarder maintenant", {
        class: "btn btn-secondary",
        icon: creating ? spinner(15) : icon("plus"),
        disabled: busy || creating,
        title: busy
          ? "Une opération est déjà en cours sur cette base."
          : undefined,
        onClick: () => {
          state.busy.add(busyKey);
          ctx.rerender();
          void createDatabaseDump(bundle.serviceName, db.name)
            .then(() => {
              state.busy.delete(busyKey);
              toast("Sauvegarde lancée. Suivi dans Opérations.");
              ctx.reload({ force: true });
              ctx.trackTasks();
            })
            .catch((e) => {
              state.busy.delete(busyKey);
              toastError(hostingRefusalMessage(describeFailure(e).message));
              ctx.rerender();
            });
        },
      }),
      el("span", {
        class: "section-note",
        text: "Chaque sauvegarde porte une date de suppression automatique renvoyée par l'API : elle n'est pas gardée indéfiniment.",
      }),
    ]),
  ]);
}

function sortedByDate(dumps: DatabaseDump[]): DatabaseDump[] {
  return [...dumps].sort((a, b) => {
    const ta = Date.parse(a.creationDate);
    const tb = Date.parse(b.creationDate);
    // Une date illisible passe en dernier plutôt que de renvoyer NaN au tri.
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return tb - ta;
  });
}

/**
 * Une sauvegarde, et surtout ce qu'il lui reste à vivre.
 *
 * `deletionDate` n'est pas une option : l'API la pose seule. Le compte à rebours
 * est donc l'information principale de la ligne, pas une date de plus.
 */
function renderDumpRow(dump: DatabaseDump): HTMLElement {
  const left = daysUntil(dump.deletionDate);
  const expiry =
    left === null
      ? `Suppression automatique le ${formatDate(dump.deletionDate)}`
      : left <= 0
        ? "Supprimée automatiquement aujourd'hui"
        : `Supprimée automatiquement le ${formatDate(dump.deletionDate)} · dans ${left} ${plural(left, "jour")}`;

  return el("div", { class: "dump-row" }, [
    el("span", { class: "dump-type", text: dumpTypeLabel(dump.type) }),
    el("span", { class: "dump-date num", text: formatDateTime(dump.creationDate) }),
    el("span", { class: left !== null && left <= 2 ? "dump-left is-warn" : "dump-left" }, [
      icon("timer", { size: 14 }),
      expiry,
    ]),
    // La restauration existe côté API mais aucune commande ne l'expose : plutôt
    // que de masquer le bouton, on dit pourquoi il ne fait rien.
    button("Restaurer", {
      class: "btn btn-ghost",
      disabled: true,
      title:
        "La restauration d'une sauvegarde n'est pas encore exposée par le backend : aucune commande ne la couvre.",
    }),
  ]);
}

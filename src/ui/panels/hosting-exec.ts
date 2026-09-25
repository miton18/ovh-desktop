/**
 * Onglet « Exécution » — les configurations d'exécution et les variables
 * d'environnement.
 *
 * Deux contraintes de l'API décident de cet écran :
 *
 * - **la même version s'écrit de trois façons.** `Service.phpVersions` dit `8.0`,
 *   `runtime.type` dit `phpfpm-8.0`, `cron.language` dit `php8.0`. Ces chaînes ne
 *   se comparent jamais entre elles : on affiche un libellé unique, et la
 *   correspondance se fait par numéro de version ;
 * - **une valeur de variable ne se relit jamais.** `EnvVar.value` est typée
 *   `password` par l'API quel que soit son `type` déclaré. Aucun champ n'est donc
 *   pré-rempli, et rien ne laisse croire qu'on pourrait retrouver une valeur.
 */

import { KNOWN_ENV_VAR_TYPES, type EnvVar, type Runtime } from "../../ovh-api";
import { createEnvVar, deleteEnvVar, describeFailure } from "../data";
import { button, el } from "../dom";
import { icon } from "../icons";
import { formatCapacity, hostingRefusalMessage, runtimeLabel } from "../labels";
import { toast, toastError } from "../toast";
import type { HostingContext } from "./hosting-context";
import { capabilityEmptyState, CLOUD_WEB_UNLOCK } from "./hosting-notice";
import {
  canAdd,
  envFormError,
  isDeprecatedEngine,
  pendingTaskFor,
  runtimeName,
} from "./hosting-state";

export function renderExecTab(ctx: HostingContext): DocumentFragment {
  const out = document.createDocumentFragment();
  const runtimes = canAdd(ctx.bundle.capabilities, "runtimes", ctx.bundle.runtimes.length);
  const envVars = canAdd(ctx.bundle.capabilities, "envVars", ctx.bundle.envVars.length);

  // Les deux blocs de l'onglet sont hors de l'offre : un seul message, pas deux
  // états vides l'un sous l'autre. L'onglet reste visible — un onglet qui
  // s'évapore selon l'offre ne dit pas pourquoi.
  if (runtimes.limit === 0 && envVars.limit === 0) {
    out.appendChild(
      capabilityEmptyState({
        title: "Rien à configurer sur cette offre",
        reason:
          "Cette offre n'autorise ni configuration d'exécution ni variable d'environnement. La version de PHP qui sert chaque site est imposée, et se lit dans la colonne « Exécution » de l'onglet Multisites.",
        unlock: CLOUD_WEB_UNLOCK,
      }),
    );
    return out;
  }

  out.appendChild(renderRuntimes(ctx));
  out.appendChild(renderEnvVars(ctx));
  return out;
}

// ---------------------------------------------------------------------------
// Configurations d'exécution
// ---------------------------------------------------------------------------

/** Le compteur n'apparaît que quand l'offre pose une limite chiffrée utile. */
function runtimeNote(ctx: HostingContext): string {
  const add = canAdd(ctx.bundle.capabilities, "runtimes", ctx.bundle.runtimes.length);
  if (add.limit !== null) {
    return `Chaque multisite en référence une par son identifiant · ${formatCapacity(ctx.bundle.runtimes.length, add.limit)}.`;
  }
  return "Chaque multisite en référence une par son identifiant.";
}

function renderRuntimes(ctx: HostingContext): HTMLElement {
  const { bundle } = ctx;
  const add = canAdd(bundle.capabilities, "runtimes", bundle.runtimes.length);

  if (add.limit === 0) {
    return el("section", { attrs: { "aria-label": "Configurations d'exécution" } }, [
      el("div", { class: "section-head" }, [
        el("h2", { text: "Configurations d'exécution", style: { fontSize: "16px" } }),
      ]),
      capabilityEmptyState({
        title: "Configuration d'exécution imposée",
        reason:
          "Cette offre ne permet pas de configurer l'exécution : la version qui sert chaque site est fixée, et se lit dans la colonne « Exécution » de l'onglet Multisites.",
        unlock: CLOUD_WEB_UNLOCK,
      }),
    ]);
  }

  return el("section", { attrs: { "aria-label": "Configurations d'exécution" } }, [
    el("div", { class: "section-head" }, [
      el("h2", { text: "Configurations d'exécution", style: { fontSize: "16px" } }),
      el("span", { class: "section-note", text: runtimeNote(ctx) }),
    ]),
    el("div", { class: "table-wrap" }, [
      el("table", { class: "table" }, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", { text: "Nom" }),
            el("th", { text: "Langage" }),
            el("th", { text: "Dossier public" }),
            el("th", { text: "Environnement" }),
            el("th", { text: "Multisites servis" }),
            el("th", {}, [
              el("span", { class: "visually-hidden", text: "Actions" }),
            ]),
          ]),
        ]),
        el(
          "tbody",
          {},
          bundle.runtimes.map((r) => renderRuntimeRow(ctx, r)),
        ),
      ]),
      bundle.runtimes.length === 0
        ? el("div", { class: "placeholder", text: "Aucune configuration d'exécution." })
        : null,
    ]),
  ]);
}

function renderRuntimeRow(ctx: HostingContext, runtime: Runtime): HTMLTableRowElement {
  const { bundle } = ctx;
  const deprecated = isDeprecatedEngine(runtime.type, bundle.service);
  const served = bundle.attachedDomains
    .filter((a) => a.runtimeId === runtime.id)
    .map((a) => a.domain)
    .filter((d): d is string => Boolean(d));

  return el("tr", {}, [
    el("td", {}, [
      el("div", { class: "site-cell" }, [
        el("span", { text: runtimeName(runtime) }),
        runtime.isDefault
          ? el("span", { class: "tag tag-accent", text: "Par défaut" })
          : null,
      ]),
    ]),
    el("td", {}, [
      el("div", { class: "site-cell" }, [
        // Le `title` garde la valeur brute de l'API : le libellé normalisé ne
        // doit pas empêcher de retrouver `phpfpm-8.0` quand on en a besoin.
        el("span", { text: runtimeLabel(runtime.type), attrs: { title: runtime.type } }),
        deprecated
          ? el("span", { class: "tag tag-danger", text: "Plus maintenu" })
          : null,
      ]),
    ]),
    el("td", {}, [
      el("span", {
        class: "mono",
        text: runtime.publicDir ? `/${runtime.publicDir}` : "—",
      }),
    ]),
    el("td", { text: runtime.appEnv || "—" }),
    el("td", {}, [
      el("span", {
        class: served.length > 0 ? "mono" : "mono text-muted",
        text: served.length > 0 ? served.join(", ") : "Aucun",
      }),
    ]),
    el("td", {}, [
      el("div", { class: "rec-actions" }, [
        runtime.isDefault
          ? null
          : // Aucune commande n'expose la modification d'un runtime : le bouton
            // reste visible avec la raison plutôt que de disparaître.
            button("Définir par défaut", {
              class: "btn btn-ghost",
              disabled: true,
              title:
                "La modification d'une configuration d'exécution n'est pas encore exposée par le backend : aucune commande ne la couvre.",
            }),
      ]),
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// Variables d'environnement
// ---------------------------------------------------------------------------

function renderEnvVars(ctx: HostingContext): HTMLElement {
  const { bundle, state } = ctx;
  // C'est ici que l'API répondait « this account is not allowed to create
  // EnvVar » : la capacité est connue d'avance, et à zéro il n'y a pas de bouton
  // à griser — il n'y a rien du tout, et il faut le dire.
  const add = canAdd(bundle.capabilities, "envVars", bundle.envVars.length);

  const head = el("div", { class: "section-head" }, [
    el("h2", { text: "Variables d'environnement", style: { fontSize: "16px" } }),
    add.limit === 0
      ? null
      : el("span", {
          class: "section-note",
          text: "L'API ne renvoie jamais une valeur, quel que soit son type : elle se remplace, elle ne se relit pas.",
        }),
  ]);

  if (add.limit === 0) {
    return el("section", { attrs: { "aria-label": "Variables d'environnement" } }, [
      head,
      capabilityEmptyState({
        title: "Variables d'environnement indisponibles",
        reason: "Cette offre n'en accepte aucune : l'API refuserait la création.",
        unlock: CLOUD_WEB_UNLOCK,
      }),
    ]);
  }

  return el("section", { attrs: { "aria-label": "Variables d'environnement" } }, [
    el("div", { class: "host-bar" }, [
      head,
      el("div", { class: "spacer" }),
      add.allowed ? null : el("span", { class: "section-note", text: add.reason }),
      button("Ajouter une variable", {
        class: "btn btn-primary",
        icon: icon("plus"),
        disabled: state.envForm.open || !add.allowed,
        title: add.allowed ? undefined : add.reason,
        onClick: () => {
          state.envForm.open = true;
          ctx.rerender();
          document.querySelector<HTMLInputElement>(".env-create input")?.focus();
        },
      }),
    ]),
    state.envForm.open ? renderEnvForm(ctx) : null,
    el("div", { class: "stack-rows" }, [
      ...bundle.envVars.map((v) => renderEnvRow(ctx, v)),
      bundle.envVars.length === 0
        ? el("div", { class: "placeholder", text: "Aucune variable définie." })
        : null,
    ]),
  ]);
}

function renderEnvRow(ctx: HostingContext, variable: EnvVar): HTMLElement {
  const { bundle, state } = ctx;
  const pending = pendingTaskFor(bundle, variable.key);
  const busyKey = `env:${variable.key}`;
  const busy = state.busy.has(busyKey) || pending !== null;

  return el("div", { class: busy ? "env-row is-pending" : "env-row" }, [
    el("span", { class: "mono env-key", text: variable.key }),
    el("span", { class: "tag tag-neutral mono", text: variable.type }),
    // Jamais de champ pré-rempli : la valeur n'existe pas côté client, et un
    // champ vide qui ressemble à un champ modifiable serait un mensonge.
    el("span", {
      class: "env-hidden",
      text: "••••••••••",
      attrs: { title: "L'API ne renvoie jamais la valeur d'une variable." },
    }),
    el("div", { class: "rec-actions" }, [
      pending
        ? el("span", { class: "section-note", text: pending.label })
        : null,
      pending
        ? null
        : button("Remplacer la valeur", {
            class: "btn btn-ghost",
            icon: icon("arrows-clockwise", { size: 15 }),
            disabled: true,
            title:
              "La modification d'une variable n'est pas exposée par le backend : seules la création et la suppression le sont. Supprimez la variable puis recréez-la.",
          }),
      pending
        ? null
        : button("", {
            class: "btn btn-ghost btn-icon",
            icon: icon("trash"),
            title: `Supprimer ${variable.key}`,
            ariaLabel: `Supprimer ${variable.key}`,
            disabled: busy,
            onClick: () => {
              state.busy.add(busyKey);
              ctx.rerender();
              void deleteEnvVar(bundle.serviceName, variable.key)
                .then(() => {
                  state.busy.delete(busyKey);
                  toast(`Suppression de ${variable.key} lancée`);
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
    ]),
  ]);
}

function renderEnvForm(ctx: HostingContext): HTMLElement {
  const { bundle, state } = ctx;
  const form = state.envForm;

  const errorBox = el("div", { class: "form-error", attrs: { hidden: true } });
  const addBtn = button("Ajouter", {
    class: "btn btn-primary",
    icon: icon("plus"),
    onClick: () => void add(),
  });

  function revalidate(): void {
    const err = envFormError(form, bundle);
    errorBox.textContent = err;
    errorBox.hidden = err === "";
    addBtn.disabled = form.key.trim() === "" || form.value === "" || err !== "";
  }

  const keyInput = el("input", {
    class: "input mono",
    attrs: {
      type: "text",
      placeholder: "NOM_DE_VARIABLE",
      "aria-label": "Nom de la variable",
      spellcheck: "false",
      value: form.key,
    },
    on: {
      input: (ev) => {
        const field = ev.currentTarget as HTMLInputElement;
        // L'API attend un nom en majuscules : on le pose plutôt que de le
        // reprocher après coup.
        form.key = field.value.toUpperCase();
        field.value = form.key;
        revalidate();
      },
    },
  });

  const typeSelect = el(
    "select",
    {
      class: "input",
      attrs: { "aria-label": "Type de la variable" },
      on: {
        change: (ev) => {
          form.kind = (ev.currentTarget as HTMLSelectElement).value;
          revalidate();
        },
      },
    },
    KNOWN_ENV_VAR_TYPES.map((value) =>
      el("option", { text: value, attrs: { value, selected: value === form.kind } }),
    ),
  );

  const valueInput = el("input", {
    class: "input mono",
    attrs: {
      // `password` même pour une variable `string` : l'API la traite comme un
      // secret, l'interface ne fait pas autrement.
      type: "password",
      placeholder: "Valeur",
      "aria-label": "Valeur de la variable",
      autocomplete: "off",
      spellcheck: "false",
      value: form.value,
    },
    on: {
      input: (ev) => {
        form.value = (ev.currentTarget as HTMLInputElement).value;
        revalidate();
      },
    },
  });

  async function add(): Promise<void> {
    if (envFormError(form, bundle) !== "") return;
    const key = form.key.trim();
    addBtn.disabled = true;
    try {
      await createEnvVar(bundle.serviceName, key, form.value, form.kind);
      state.envForm = { open: false, key: "", kind: "string", value: "" };
      toast(`Variable ${key} envoyée. Suivi dans Opérations.`);
      ctx.reload({ force: true });
      ctx.trackTasks();
    } catch (e) {
      toastError(hostingRefusalMessage(describeFailure(e).message));
      revalidate();
    }
  }

  revalidate();

  return el("div", { class: "env-create panel-accent" }, [
    el("div", { class: "user-create-row" }, [
      keyInput,
      typeSelect,
      valueInput,
      addBtn,
      button("Annuler", {
        class: "btn btn-secondary",
        onClick: () => {
          state.envForm.open = false;
          ctx.rerender();
        },
      }),
    ]),
    errorBox,
    el("div", {
      class: "section-note",
      text: "La valeur ne sera plus lisible après l'envoi : notez-la maintenant si vous en avez besoin ailleurs.",
    }),
  ]);
}

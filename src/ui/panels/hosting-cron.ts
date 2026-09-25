/**
 * Onglet « Tâches planifiées ».
 *
 * `Cron.frequency` est une **chaîne crontab brute** : l'API ne la valide pas et
 * ne la relit pas pour nous. Sans traduction, on planifie à l'aveugle — d'où la
 * relecture en français sous le champ, et dans le tableau à côté de l'expression.
 *
 * `Cron.language` porte encore une troisième orthographe des versions (`php8.0`,
 * là où l'hébergement dit `8.0` et un runtime `phpfpm-8.0`). On n'en compare
 * jamais les chaînes : la correspondance se fait par numéro de version, ce qui
 * permet de signaler une tâche qui tourne sur un PHP que l'API dit périmé.
 */

import type { Cron } from "../../ovh-api";
import { createCron, deleteCron, describeFailure } from "../data";
import { button, el } from "../dom";
import { icon } from "../icons";
import {
  cronDescription,
  hostingRefusalMessage,
  isEndOfLifeSupport,
  runtimeLabel,
  versionOf,
} from "../labels";
import { toast, toastError } from "../toast";
import type { HostingContext } from "./hosting-context";
import { capabilityEmptyState } from "./hosting-notice";
import {
  capabilityFlag,
  cronFormError,
  isDeprecatedEngine,
  pendingTaskFor,
} from "./hosting-state";

/** Le statut d'un cron qu'on vient de créer : actif, sinon il ne sert à rien. */
const CRON_ENABLED = "enabled";

export function renderCronTab(ctx: HostingContext): HTMLElement {
  const { bundle, state } = ctx;
  // `crontab` est un booléen d'offre : une offre fournie avec un domaine
  // n'accepte aucune tâche planifiée, et l'API répondrait 400.
  const allowed = capabilityFlag(
    bundle.capabilities,
    "crontab",
    "Cette offre n'accepte pas de tâche planifiée.",
  );

  // Capacité absente : ni tableau ni bouton, un message à la place. Il n'y aura
  // jamais de tâche à voir ici, et un bouton grisé ne dirait pas pourquoi.
  if (!allowed.allowed) {
    return el("section", { attrs: { "aria-label": "Tâches planifiées" } }, [
      capabilityEmptyState({
        icon: "clock",
        title: "Tâches planifiées indisponibles",
        reason:
          "Cette offre n'accepte aucune tâche planifiée : l'API refuserait la création, et il n'y en aura aucune à lister.",
        unlock:
          "Les offres qui les autorisent le déclarent dans leurs capacités — les offres fournies avec un nom de domaine ne le font pas.",
      }),
    ]);
  }

  return el("section", { attrs: { "aria-label": "Tâches planifiées" } }, [
    el("div", { class: "host-bar" }, [
      el("div", { class: "spacer" }),
      button("Nouvelle tâche planifiée", {
        class: "btn btn-primary",
        icon: icon("plus"),
        disabled: state.cronForm.open,
        onClick: () => {
          state.cronForm.open = true;
          ctx.rerender();
          document.querySelector<HTMLInputElement>(".cron-form input")?.focus();
        },
      }),
    ]),
    state.cronForm.open ? renderForm(ctx) : null,
    el("div", { class: "table-wrap" }, [
      el("table", { class: "table" }, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", { text: "Commande" }),
            el("th", { text: "Fréquence" }),
            el("th", { text: "Langage" }),
            el("th", { text: "Erreurs envoyées à" }),
            el("th", {}, [
              el("span", { class: "visually-hidden", text: "Actions" }),
            ]),
          ]),
        ]),
        el(
          "tbody",
          {},
          bundle.crons.map((c) => renderCronRow(ctx, c)),
        ),
      ]),
      bundle.crons.length === 0
        ? el("div", { class: "placeholder", text: "Aucune tâche planifiée." })
        : null,
    ]),
  ]);
}

function renderCronRow(ctx: HostingContext, cron: Cron): HTMLTableRowElement {
  const { bundle, state } = ctx;
  const deprecated = isDeprecatedEngine(cron.language, bundle.service);
  const described = cronDescription(cron.frequency);
  const pending = pendingTaskFor(bundle, cron.command);
  const busyKey = `cron:${cron.id}`;
  const busy = state.busy.has(busyKey) || pending !== null;

  return el("tr", { class: busy ? "is-pending" : "" }, [
    el("td", {}, [
      el("div", { class: "cron-command" }, [
        el("span", { class: "mono", text: cron.command }),
        cron.description
          ? el("span", { class: "section-note", text: cron.description })
          : null,
        cron.status !== CRON_ENABLED
          ? el("span", { class: "tag tag-muted", text: cron.status })
          : null,
      ]),
    ]),
    el("td", {}, [
      el("div", { class: "cron-freq" }, [
        el("span", { text: described ?? "Expression non reconnue" }),
        el("span", { class: "mono section-note", text: cron.frequency }),
      ]),
    ]),
    el("td", {}, [
      el("div", { class: "site-cell" }, [
        el("span", {
          text: runtimeLabel(cron.language),
          attrs: { title: cron.language },
        }),
        deprecated
          ? el("span", { class: "tag tag-danger", text: "Plus maintenu" })
          : null,
      ]),
    ]),
    el("td", {}, [
      el("span", { class: "text-muted", text: cron.email ?? "—" }),
    ]),
    el("td", {}, [
      el("div", { class: "rec-actions" }, [
        pending
          ? el("span", { class: "section-note", text: pending.label })
          : button("", {
              class: "btn btn-ghost btn-icon",
              icon: icon("trash"),
              title: "Supprimer la tâche",
              ariaLabel: `Supprimer la tâche ${cron.command}`,
              disabled: busy,
              onClick: () => {
                state.busy.add(busyKey);
                ctx.rerender();
                void deleteCron(bundle.serviceName, cron.id)
                  .then(() => {
                    state.busy.delete(busyKey);
                    toast("Suppression de la tâche lancée");
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
    ]),
  ]);
}

/**
 * Les versions de PHP réellement planifiables.
 *
 * `capabilities.languages.php` dit ce que l'offre accepte, `Service.phpVersions`
 * dit ce que l'hébergement installe et ce qui est encore maintenu. On croise les
 * deux **par numéro de version** — les deux listes n'ont pas la même orthographe
 * — et on retombe sur l'hébergement seul si le croisement ne donne rien, plutôt
 * que de présenter une liste vide.
 */
function allowedPhpVersions(ctx: HostingContext): { version: string; support: string }[] {
  const installed = ctx.bundle.service.phpVersions;
  const declared = ctx.bundle.capabilities?.languages?.php;
  if (!declared || declared.length === 0) return installed;
  const allowed = new Set(declared.map((entry) => versionOf(entry) ?? entry));
  const kept = installed.filter((p) => allowed.has(p.version));
  return kept.length > 0 ? kept : installed;
}

/**
 * Les autres familles que l'offre accepte, nommées sans être proposées.
 *
 * `cron.language` compte 27 valeurs et cette version ne connaît avec certitude
 * que l'orthographe des versions PHP (`php8.3`). Proposer un `nodejs` mal
 * orthographié produirait un refus de l'API : on dit donc que l'offre l'accepte,
 * sans prétendre savoir l'écrire.
 */
function otherLanguagesNote(ctx: HostingContext): string {
  const languages = ctx.bundle.capabilities?.languages;
  if (!languages) return "";
  const families: [string, string[]][] = [
    ["Node.js", languages.nodejs],
    ["Python", languages.python],
    ["Ruby", languages.ruby],
  ];
  const present = families.filter(([, list]) => list.length > 0).map(([name]) => name);
  if (present.length === 0) return "";
  return `Cette offre accepte aussi ${present.join(", ")}, non proposés ici : l'orthographe exacte attendue par l'API pour ces langages n'est pas connue de cette version.`;
}

function renderForm(ctx: HostingContext): HTMLElement {
  const { bundle, state } = ctx;
  const service = bundle.service;
  const form = state.cronForm;

  // La version proposée par défaut est la première que l'API ne dit pas périmée :
  // planifier sur un PHP en fin de vie ne devrait pas être le chemin le plus court.
  const versions = allowedPhpVersions(ctx);
  const supported = versions.filter((p) => !isEndOfLifeSupport(p.support));
  if (!form.language && (supported[0] ?? versions[0])) {
    form.language = `php${(supported[0] ?? versions[0]).version}`;
  }

  const errorBox = el("div", { class: "form-error", attrs: { hidden: true } });
  const freqNote = el("span", { class: "form-help" });
  const addBtn = button("Planifier", {
    class: "btn btn-primary",
    icon: icon("plus"),
    onClick: () => void add(),
  });

  function command(): string {
    return form.command.trim().replace(/^\/+/, "");
  }

  function revalidate(): void {
    const err = cronFormError(form);
    const raw = form.frequency.trim();
    const described = raw ? cronDescription(raw) : null;

    freqNote.textContent = !raw
      ? "minute · heure · jour du mois · mois · jour de semaine"
      : (described ??
        "Expression invalide : 5 champs attendus, par exemple 0 3 * * *");
    freqNote.classList.toggle("is-error", Boolean(raw) && described === null);

    errorBox.textContent = err;
    errorBox.hidden = err === "";
    addBtn.disabled = command() === "" || described === null || err !== "";
  }

  const commandInput = el("input", {
    attrs: {
      type: "text",
      placeholder: "www/cron.php",
      "aria-label": "Script à exécuter",
      spellcheck: "false",
      value: form.command,
    },
    on: {
      input: (ev) => {
        form.command = (ev.currentTarget as HTMLInputElement).value;
        revalidate();
      },
    },
  });

  const freqInput = el("input", {
    class: "input mono num",
    attrs: {
      type: "text",
      placeholder: "0 3 * * *",
      "aria-label": "Fréquence, au format crontab",
      spellcheck: "false",
      value: form.frequency,
    },
    on: {
      input: (ev) => {
        form.frequency = (ev.currentTarget as HTMLInputElement).value;
        revalidate();
      },
    },
  });

  const langSelect = el(
    "select",
    {
      class: "input",
      attrs: { "aria-label": "Langage d'exécution" },
      on: {
        change: (ev) => {
          form.language = (ev.currentTarget as HTMLSelectElement).value;
        },
      },
    },
    versions.map((p) =>
      el("option", {
        text: `PHP ${p.version}${isEndOfLifeSupport(p.support) ? " (plus maintenu)" : ""}`,
        attrs: { value: `php${p.version}`, selected: `php${p.version}` === form.language },
      }),
    ),
  );

  const descriptionInput = el("input", {
    class: "input",
    attrs: {
      type: "text",
      placeholder: "Facultatif",
      "aria-label": "Description",
      value: form.description,
    },
    on: {
      input: (ev) => {
        form.description = (ev.currentTarget as HTMLInputElement).value;
      },
    },
  });

  const emailInput = el("input", {
    class: "input",
    attrs: {
      type: "text",
      placeholder: "Facultatif · reçoit la sortie d'erreur",
      "aria-label": "Adresse qui reçoit les erreurs",
      spellcheck: "false",
      value: form.email,
    },
    on: {
      input: (ev) => {
        form.email = (ev.currentTarget as HTMLInputElement).value;
        revalidate();
      },
    },
  });

  async function add(): Promise<void> {
    const cmd = command();
    if (!cmd || cronDescription(form.frequency.trim()) === null) return;
    if (cronFormError(form) !== "") return;
    addBtn.disabled = true;
    try {
      await createCron(bundle.serviceName, {
        command: cmd,
        // L'API garde la chaîne telle quelle : on normalise les espaces pour que
        // ce qui est relu soit ce qui a été compris.
        frequency: form.frequency.trim().split(/\s+/).join(" "),
        language: form.language,
        description: form.description.trim() || null,
        email: form.email.trim() || null,
        status: CRON_ENABLED,
      });
      state.cronForm = {
        open: false,
        command: "",
        frequency: "",
        language: "",
        description: "",
        email: "",
      };
      toast("Tâche planifiée envoyée. Suivi dans Opérations.");
      ctx.reload({ force: true });
      ctx.trackTasks();
    } catch (e) {
      toastError(hostingRefusalMessage(describeFailure(e).message));
      revalidate();
    }
  }

  revalidate();

  return el("div", { class: "cron-form panel-accent" }, [
    el("div", { class: "form-title", text: "Nouvelle tâche planifiée" }),
    el("div", { class: "form-grid" }, [
      el("span", { class: "form-key", text: "Script" }),
      el("div", { class: "prefixed-input" }, [
        el("span", { text: `${service.home}/` }),
        commandInput,
      ]),
      el("span", { class: "form-key", text: "Fréquence" }),
      el("div", { class: "cron-freq-field" }, [freqInput, freqNote]),
      el("span", { class: "form-key", text: "Langage" }),
      otherLanguagesNote(ctx)
        ? el("div", { class: "cron-freq-field" }, [
            langSelect,
            el("span", { class: "form-help", text: otherLanguagesNote(ctx) }),
          ])
        : langSelect,
      el("span", { class: "form-key", text: "Description" }),
      descriptionInput,
      el("span", { class: "form-key", text: "Erreurs envoyées à" }),
      emailInput,
    ]),
    errorBox,
    el("div", { class: "form-actions" }, [
      addBtn,
      button("Annuler", {
        class: "btn btn-secondary",
        onClick: () => {
          state.cronForm.open = false;
          ctx.rerender();
        },
      }),
    ]),
  ]);
}

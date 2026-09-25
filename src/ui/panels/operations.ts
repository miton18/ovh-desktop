/**
 * Onglet « Opérations » — les tâches asynchrones du domaine et de la zone.
 *
 * Les écritures OVH rendent des tâches, pas des résultats : cet onglet est donc
 * le seul endroit où l'on voit ce qui est réellement en train de se passer.
 *
 * Les boutons affichés sont exactement ceux que la tâche autorise :
 * `canAccelerate`, `canCancel`, `canRelaunch`. On ne propose jamais une action
 * que l'API refuserait — et on ne devine pas leur disponibilité d'après le
 * statut.
 */

import type { TaskAction } from "../../ovh-api";
import { actOnDomainTask, actOnZoneTask, describeFailure } from "../data";
import { button, el } from "../dom";
import { icon, spinner } from "../icons";
import {
  formatDateTime,
  formatElapsed,
  taskFunctionLabel,
  taskStatusPresentation,
} from "../labels";
import { toast, toastError } from "../toast";
import type { DomainContext } from "./context";

type Operation = {
  scope: "domain" | "zone";
  id: number;
  function: string;
  status: string;
  comment: string | null;
  creationDate: string;
  todoDate: string;
  doneDate: string | null;
  canAccelerate: boolean;
  canCancel: boolean;
  canRelaunch: boolean;
};

/**
 * Les deux listes de l'API n'en font qu'une à l'écran : l'utilisateur ne pense
 * pas en « tâche de domaine » et « tâche de zone ». Le périmètre reste porté par
 * `scope`, parce que les routes d'action sont distinctes.
 */
export function mergeOperations(ctx: DomainContext): Operation[] {
  const { bundle } = ctx;
  const all: Operation[] = [
    ...bundle.domainTasks.map((t) => ({
      scope: "domain" as const,
      id: t.id,
      function: t.function,
      status: t.status,
      comment: t.comment,
      creationDate: t.creationDate,
      todoDate: t.todoDate,
      doneDate: t.doneDate,
      canAccelerate: t.canAccelerate,
      canCancel: t.canCancel,
      canRelaunch: t.canRelaunch,
    })),
    ...bundle.zoneTasks.map((t) => ({
      scope: "zone" as const,
      id: t.id,
      function: t.function,
      status: t.status,
      comment: t.comment,
      creationDate: t.creationDate,
      todoDate: t.todoDate,
      doneDate: t.doneDate,
      canAccelerate: t.canAccelerate,
      canCancel: t.canCancel,
      canRelaunch: t.canRelaunch,
    })),
  ];

  return all.sort((a, b) => {
    const ta = Date.parse(a.creationDate);
    const tb = Date.parse(b.creationDate);
    // Une date illisible ne doit pas renvoyer NaN dans le tri : elle passe après.
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return tb - ta;
  });
}

export function renderOperationsTab(ctx: DomainContext): HTMLElement {
  const operations = mergeOperations(ctx);

  const body = el(
    "tbody",
    {},
    operations.map((op) => renderRow(ctx, op)),
  );

  return el("section", { attrs: { "aria-label": "Opérations" } }, [
    el("div", { class: "table-wrap" }, [
      el("table", { class: "table ops-table" }, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", { text: "Opération" }),
            el("th", { text: "Statut" }),
            el("th", { text: "Demandée" }),
            el("th", { text: "Terminée" }),
            el("th", {}, [el("span", { class: "visually-hidden", text: "Actions" })]),
          ]),
        ]),
        body,
      ]),
      operations.length === 0
        ? el("div", { class: "placeholder", text: "Aucune opération sur ce domaine." })
        : null,
    ]),
  ]);
}

/**
 * Une date d'opération, en durée écoulée quand elle est récente.
 *
 * On suit ici des tâches qui durent des minutes : « il y a 3 min » répond à la
 * question posée, là où un horodatage demande une soustraction. La date exacte
 * reste dans le `title` — elle n'est pas perdue, juste rangée.
 */
function renderDateCell(value: string | null): HTMLTableCellElement {
  if (!value) return el("td", {}, [el("span", { class: "ops-date", text: "—" })]);
  const { text, title } = formatElapsed(value);
  return el("td", {}, [el("span", { class: "ops-date", attrs: { title }, text })]);
}

function renderRow(ctx: DomainContext, op: Operation): HTMLTableRowElement {
  const { state } = ctx;
  const status = taskStatusPresentation(op.status);
  const busyKey = `task:${op.scope}:${op.id}`;
  const busy = state.busy.has(busyKey);

  const note =
    op.comment ??
    (op.status === "todo" && op.todoDate
      ? `Exécution prévue le ${formatDateTime(op.todoDate)}`
      : "");

  function act(action: TaskAction, message: string): void {
    state.busy.add(busyKey);
    ctx.rerender();
    const run =
      op.scope === "domain"
        ? actOnDomainTask(ctx.bundle.name, op.id, action)
        : actOnZoneTask(ctx.bundle.name, op.id, action);
    void run
      .then(() => {
        state.busy.delete(busyKey);
        toast(message);
        ctx.reload({ force: true });
        ctx.trackTasks();
      })
      .catch((e) => {
        state.busy.delete(busyKey);
        toastError(describeFailure(e).message);
        ctx.rerender();
      });
  }

  return el("tr", {}, [
    el("td", {}, [
      el("div", { class: "ops-fn" }, [
        el("span", { text: taskFunctionLabel(op.function) }),
        note
          ? el("span", {
              class: op.status === "error" ? "ops-note is-error" : "ops-note",
              text: note,
            })
          : null,
        el("span", {
          class: "ops-note",
          text: op.scope === "domain" ? "domaine" : "zone DNS",
        }),
      ]),
    ]),
    el("td", {}, [
      el("span", { class: `tag ${status.tagClass}` }, [
        // Une seule marque de mouvement : l'anneau pour « en cours », une icône
        // fixe pour les états qui n'évoluent plus.
        status.running ? spinner(12) : status.icon ? icon(status.icon, { size: 12 }) : null,
        status.label,
      ]),
    ]),
    renderDateCell(op.creationDate),
    renderDateCell(op.doneDate),
    el("td", {}, [
      el("div", { class: "ops-actions" }, [
        op.canAccelerate
          ? button("Accélérer", {
              class: "btn btn-ghost",
              disabled: busy,
              onClick: () => act("accelerate", "Accélération demandée"),
            })
          : null,
        op.canCancel
          ? button("Annuler", {
              class: "btn btn-ghost",
              disabled: busy,
              onClick: () => act("cancel", "Opération annulée"),
            })
          : null,
        op.canRelaunch
          ? button("Relancer", {
              class: "btn btn-secondary",
              disabled: busy,
              onClick: () => act("relaunch", "Opération relancée"),
            })
          : null,
      ]),
    ]),
  ]);
}

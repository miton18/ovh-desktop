/**
 * Onglet « Opérations » d'un hébergement.
 *
 * Les écritures rendent des tâches, pas des résultats : c'est le seul endroit où
 * l'on voit ce qui se passe réellement. Contrairement aux tâches de domaine,
 * `hosting.web.task` ne porte **ni `canCancel` ni `canAccelerate`** : une
 * opération d'hébergement ne s'annule pas et ne se relance pas. Il n'y a donc
 * aucune colonne d'actions — et la page le dit, pour qu'on ne cherche pas un
 * bouton absent.
 *
 * `objectId` nomme la ligne concernée : c'est ce qui permet de rattacher une
 * tâche au multisite ou à la base qu'elle touche, ici comme dans les autres
 * onglets.
 */

import { isTerminalHostingStatus, type HostingTask } from "../../ovh-api";
import { el } from "../dom";
import { icon, spinner } from "../icons";
import { formatElapsed, hostingTaskLabel, taskStatusPresentation } from "../labels";
import type { HostingContext } from "./hosting-context";

export function renderHostingOpsTab(ctx: HostingContext): HTMLElement {
  const tasks = sortedTasks(ctx.bundle.tasks);

  return el("section", { attrs: { "aria-label": "Opérations de l'hébergement" } }, [
    el("div", { class: "table-wrap" }, [
      el("table", { class: "table ops-table" }, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", { text: "Opération" }),
            el("th", { text: "Statut" }),
            el("th", { text: "Demandée" }),
            el("th", { text: "Terminée" }),
          ]),
        ]),
        el("tbody", {}, tasks.map(renderRow)),
      ]),
      tasks.length === 0
        ? el("div", {
            class: "placeholder",
            text: "Aucune opération sur cet hébergement.",
          })
        : null,
    ]),
    el("div", {
      class: "section-note",
      text: "Une opération d'hébergement ne s'annule pas et ne s'accélère pas : elle va jusqu'au bout.",
    }),
  ]);
}

function sortedTasks(tasks: HostingTask[]): HostingTask[] {
  return [...tasks].sort((a, b) => {
    const ta = Date.parse(a.startDate);
    const tb = Date.parse(b.startDate);
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return tb - ta;
  });
}

/**
 * Le statut d'une tâche d'hébergement.
 *
 * `init` n'a pas d'équivalent côté domaine : il vaut « pas encore commencée »,
 * exactement comme `todo`, et se présente donc pareil plutôt que de créer une
 * cinquième couleur pour une nuance invisible.
 */
function statusOf(task: HostingTask): ReturnType<typeof taskStatusPresentation> {
  return taskStatusPresentation(task.status === "init" ? "todo" : task.status);
}

function dateCell(value: string | null): HTMLTableCellElement {
  if (!value) return el("td", {}, [el("span", { class: "ops-date", text: "—" })]);
  const { text, title } = formatElapsed(value);
  return el("td", {}, [el("span", { class: "ops-date", attrs: { title }, text })]);
}

function renderRow(task: HostingTask): HTMLTableRowElement {
  const status = statusOf(task);
  const running = !isTerminalHostingStatus(task.status);

  return el("tr", {}, [
    el("td", {}, [
      el("div", { class: "ops-fn" }, [
        el("span", { text: hostingTaskLabel(task.function) }),
        task.objectId
          ? el("span", { class: "ops-note mono", text: task.objectId })
          : null,
      ]),
    ]),
    el("td", {}, [
      el("span", { class: `tag ${status.tagClass}` }, [
        running
          ? spinner(12)
          : status.icon
            ? icon(status.icon, { size: 12 })
            : null,
        status.label,
      ]),
    ]),
    dateCell(task.startDate),
    dateCell(task.doneDate),
  ]);
}

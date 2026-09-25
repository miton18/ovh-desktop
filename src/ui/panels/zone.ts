/**
 * Onglet « Zone DNS » : le tableau des enregistrements et leur saisie.
 *
 * Deux contraintes de l'API décident de la forme de cet écran, et ne doivent pas
 * être gommées :
 *
 * - **une écriture publie la zone dans la foulée.** Il n'y a donc ni brouillon
 *   ni bannière de publication : rien dans l'API ne permettrait de savoir, au
 *   chargement suivant, qu'une publication reste due — `isDeployed` décrit la
 *   santé de la zone, pas un état de brouillon. Ce qui reste affiché, c'est
 *   l'avertissement d'une zone qui ne répond pas ;
 * - **le type d'un enregistrement ne se modifie pas.** Le changer impose une
 *   suppression puis une création, donc un nouvel identifiant. L'interface
 *   l'annonce avant de le faire, elle ne le fait pas en douce.
 */

import { toast, toastError } from "../toast";
import { button, el, frag } from "../dom";
import { icon, spinner } from "../icons";
import {
  formatDuration,
  recordTypeOptions,
  targetHint,
  TXT_ALIASES,
} from "../labels";
import type { RecordCreate } from "../../ovh-api";
import {
  applyRecordEdit,
  describeFailure,
  refreshZoneStatus,
  ZonePublishPending,
  type ZoneEdit,
} from "../data";
import type { DomainContext } from "./context";
import {
  computeZoneRows,
  countByType,
  editableTypeOf,
  editorIsSubmittable,
  filterZoneRows,
  isTxtAlias,
  parsedSubDomain,
  parsedTtl,
  recordEditorError,
  txtFlavour,
  type RecordDraft,
  type RecordEditor,
  type ZoneRow,
} from "./state";
import { renderDynHostSection } from "./dynhost";

/**
 * `ttl` est obligatoire dans `RecordCreate`. La valeur 0 est la convention OVH
 * pour « garde le TTL de la zone » : c'est ce qu'on envoie quand le champ est
 * laissé vide, plutôt que de recopier le TTL du SOA et de le figer.
 */
const INHERIT_TTL = 0;

const BADGES: Record<string, [label: string, tagClass: string]> = {
  new: ["Nouveau", "tag-accent"],
  mod: ["Modifié", "tag-outline"],
  del: ["Supprimé", "tag-neutral"],
  dyn: ["DynHost", "tag-neutral"],
};

export function renderZoneTab(ctx: DomainContext): DocumentFragment {
  return frag(renderRecordsSection(ctx), renderDynHostSection(ctx));
}

// ---------------------------------------------------------------------------
// Section des enregistrements
// ---------------------------------------------------------------------------

function renderRecordsSection(ctx: DomainContext): HTMLElement {
  const { bundle, state } = ctx;
  const allRows = computeZoneRows(bundle);
  const shown = filterZoneRows(allRows, state);

  return el("section", { attrs: { "aria-label": "Enregistrements de la zone DNS" } }, [
    renderToolbar(ctx, allRows),
    renderZoneState(ctx),
    state.newRecord ? renderNewRecordForm(ctx, state.newRecord) : null,
    renderTable(ctx, shown),
  ]);
}

function renderToolbar(ctx: DomainContext, allRows: ZoneRow[]): HTMLElement {
  const { state } = ctx;

  const search = el("div", { class: "search-field" }, [
    icon("magnifying-glass", { size: 15 }),
    el("input", {
      class: "input",
      attrs: {
        type: "search",
        placeholder: "Sous-domaine ou cible",
        "aria-label": "Filtrer les enregistrements",
        spellcheck: "false",
        value: state.filterQuery,
      },
      on: {
        input: (ev) => {
          state.filterQuery = (ev.currentTarget as HTMLInputElement).value;
          // Redessin différé : on garde le focus dans le champ en le
          // reconstruisant à l'identique, curseur en fin de saisie.
          ctx.rerender();
          const next = document.querySelector<HTMLInputElement>(
            '.search-field input[type="search"]',
          );
          next?.focus();
          next?.setSelectionRange(next.value.length, next.value.length);
        },
      },
    }),
  ]);

  const chip = (label: string, type: string, n: number): HTMLElement =>
    el(
      "button",
      {
        class: "chip",
        attrs: { type: "button", "aria-pressed": state.filterType === type },
        on: {
          click: () => {
            state.filterType = state.filterType === type ? "" : type;
            ctx.rerender();
          },
        },
      },
      [el("span", { text: label }), el("span", { class: "n", text: String(n) })],
    );

  const chips = el("div", { class: "chips", attrs: { role: "group", "aria-label": "Filtrer par type" } }, [
    chip("Tous", "", allRows.length),
    ...countByType(allRows).map((c) => chip(c.type, c.type, c.n)),
  ]);

  return el("div", { class: "zone-toolbar" }, [
    search,
    chips,
    el("div", { class: "spacer" }),
    button("Ajouter un enregistrement", {
      class: "btn btn-primary",
      icon: icon("plus"),
      disabled: state.newRecord !== null,
      onClick: () => {
        state.editor = null;
        state.newRecord = { fieldType: "A", subDomain: "", ttl: "", target: "" };
        ctx.rerender();
        document.querySelector<HTMLInputElement>(".rec-form input")?.focus();
      },
    }),
  ]);
}

/**
 * Écrit l'enregistrement chez OVHcloud, puis relit la zone.
 *
 * L'écriture et la publication vont ensemble : c'est ce que l'utilisateur croit
 * faire en validant, et rien dans l'API ne permettrait de retenir qu'une
 * publication reste due.
 */
async function applyAndReload(
  ctx: DomainContext,
  edit: ZoneEdit,
  verb: string,
): Promise<void> {
  ctx.state.writing = true;
  ctx.rerender();
  try {
    await applyRecordEdit(ctx.bundle.name, edit);
    toast(`Enregistrement ${verb} et zone publiée`);
  } catch (e) {
    // La publication peut échouer après une écriture réussie : le dire
    // exactement, sinon on laisse croire que la modification est perdue.
    if (e instanceof ZonePublishPending) {
      toastError(
        `Enregistrement ${verb}, mais la publication a échoué : ${e.reason}. Rejouez la modification pour la republier.`,
      );
    } else {
      toastError(`Enregistrement non ${verb} : ${describeFailure(e).message}`);
    }
  }
  ctx.state.writing = false;
  ctx.reload({ force: true });
  void refreshZoneStatus(ctx.bundle.name);
}

/** Changement de type : suppression puis création, dans cet ordre. */
async function retypeAndReload(
  ctx: DomainContext,
  id: number,
  record: RecordCreate,
): Promise<void> {
  ctx.state.writing = true;
  ctx.rerender();
  try {
    await applyRecordEdit(ctx.bundle.name, { op: "delete", id });
    await applyRecordEdit(ctx.bundle.name, { op: "create", record });
    toast(`Enregistrement remplacé par un ${record.fieldType}`);
  } catch (e) {
    if (e instanceof ZonePublishPending) {
      toastError(
        `Enregistrement remplacé, mais la publication a échoué : ${e.reason}. Rejouez la modification pour la republier.`,
      );
    } else {
      toastError(`Changement de type refusé : ${describeFailure(e).message}`);
    }
  }
  ctx.state.writing = false;
  ctx.reload({ force: true });
  void refreshZoneStatus(ctx.bundle.name);
}

/**
 * L'état de la zone — un seul signal, et il est grave.
 *
 * `isDeployed: false` ne veut pas dire « des modifications attendent une
 * publication » : la zone n'est pas opérationnelle, elle ne répond pas. Il n'y a
 * pas de bannière de publication en face, parce que chaque écriture publie la
 * zone dans la foulée : afficher « à jour » ou « en attente » demanderait de
 * mémoriser une référence que l'API ne donne pas.
 */
function renderZoneState(ctx: DomainContext): HTMLElement | null {
  const { bundle, state } = ctx;
  const status = bundle.zoneStatus;

  if (state.writing) {
    return el("div", { class: "zone-state is-busy" }, [
      spinner(14),
      "Écriture puis publication de la zone en cours…",
    ]);
  }

  if (!status || status.isDeployed) return null;

  return el("div", { class: "zone-states" }, [
    el("div", { class: "zone-state is-error" }, [
      icon("warning", { size: 16 }),
      "Cette zone n'est pas déployée : elle ne répond pas. Vérifie sa configuration chez OVHcloud.",
      ...(status.errors ?? []).map((e) => el("span", { class: "rec-error", text: e })),
      ...(status.warnings ?? []).map((w) => el("span", { class: "text-muted", text: w })),
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// Ajout d'un enregistrement
// ---------------------------------------------------------------------------

/**
 * Le formulaire d'ajout, dans un panneau au-dessus du tableau.
 *
 * Il ne vit pas dans une ligne de tableau : une création n'a pas de ligne à
 * remplacer, et la saisir entre les colonnes rendait le sous-domaine
 * incompréhensible — c'est ici qu'on peut montrer le nom complet, zone comprise,
 * pendant la frappe.
 */
function renderNewRecordForm(ctx: DomainContext, draft: RecordDraft): HTMLElement {
  const { bundle, state } = ctx;
  const zoneTtl = bundle.soa?.ttl ?? null;

  const errorBox = el("div", { class: "form-error", attrs: { hidden: true } });
  const saveBtn = button("Ajouter", {
    class: "btn btn-primary",
    icon: icon("plus"),
    onClick: () => save(),
  });
  const aliasNote = el("div", { class: "form-help" });

  /** L'éditeur et le formulaire partagent la même validation. */
  function asEditor(): RecordEditor {
    return {
      id: null,
      tempId: null,
      subDomain: draft.subDomain,
      fieldType: draft.fieldType,
      ttl: draft.ttl,
      target: draft.target,
      originalType: null,
      changingType: true,
    };
  }

  function revalidate(): void {
    const editor = asEditor();
    const err = recordEditorError(editor);
    errorBox.textContent = err;
    errorBox.hidden = err === "";
    saveBtn.disabled = !editorIsSubmittable(editor);
    // Un alias de confort produit un TXT : le dire avant, pas après.
    aliasNote.textContent = isTxtAlias(draft.fieldType)
      ? `${draft.fieldType} est une saisie assistée : l'enregistrement créé sera un ${TXT_ALIASES[draft.fieldType]}.`
      : "";
    aliasNote.hidden = !isTxtAlias(draft.fieldType);
  }

  function cancel(): void {
    state.newRecord = null;
    ctx.rerender();
  }

  function save(): void {
    const editor = asEditor();
    if (!editorIsSubmittable(editor)) return;
    state.newRecord = null;
    void applyAndReload(
      ctx,
      {
        op: "create",
        record: {
          fieldType: editor.fieldType,
          target: editor.target.trim(),
          subDomain: parsedSubDomain(editor),
          ttl: parsedTtl(editor) ?? INHERIT_TTL,
        },
      },
      "ajouté",
    );
  }

  function onKey(ev: KeyboardEvent): void {
    if (ev.key === "Enter") {
      ev.preventDefault();
      save();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      cancel();
    }
  }

  const subInput = el("input", {
    attrs: {
      type: "text",
      placeholder: "@",
      "aria-label": "Sous-domaine",
      spellcheck: "false",
      value: draft.subDomain,
    },
    on: {
      input: (ev) => {
        draft.subDomain = (ev.currentTarget as HTMLInputElement).value;
        revalidate();
      },
      keydown: onKey,
    },
  });

  const targetInput = el("input", {
    class: "input mono",
    attrs: {
      type: "text",
      placeholder: targetHint(draft.fieldType),
      "aria-label": "Cible",
      spellcheck: "false",
      value: draft.target,
    },
    on: {
      input: (ev) => {
        draft.target = (ev.currentTarget as HTMLInputElement).value;
        revalidate();
      },
      keydown: onKey,
    },
  });

  const ttlInput = el("input", {
    class: "input num",
    attrs: {
      type: "text",
      inputmode: "numeric",
      placeholder: zoneTtl ? `zone · ${formatDuration(zoneTtl)}` : "TTL de la zone",
      "aria-label": "TTL en secondes",
      value: draft.ttl,
    },
    on: {
      input: (ev) => {
        draft.ttl = (ev.currentTarget as HTMLInputElement).value;
        revalidate();
      },
      keydown: onKey,
    },
  });

  const typeSelect = el(
    "select",
    {
      class: "input",
      attrs: { "aria-label": "Type d'enregistrement" },
      on: {
        change: (ev) => {
          draft.fieldType = (ev.currentTarget as HTMLSelectElement).value;
          // Confort de la console OVH : un DMARC vit sous `_dmarc`.
          if (draft.fieldType === "DMARC" && !draft.subDomain.trim()) {
            draft.subDomain = "_dmarc";
            subInput.value = "_dmarc";
          }
          targetInput.placeholder = targetHint(draft.fieldType);
          revalidate();
        },
      },
    },
    recordTypeOptions().map((o) =>
      el("option", {
        text: o.label,
        attrs: { value: o.value, selected: o.value === draft.fieldType },
      }),
    ),
  );

  revalidate();

  return el("div", { class: "rec-form panel-accent" }, [
    el("div", { class: "form-title", text: "Nouvel enregistrement" }),
    el("div", { class: "form-grid" }, [
      el("span", { class: "form-key", text: "Type" }),
      typeSelect,
      el("span", { class: "form-key", text: "Sous-domaine" }),
      // Le nom complet est montré pendant la frappe : c'est lui qui répondra,
      // pas le seul sous-domaine saisi.
      el("div", { class: "suffixed-input" }, [
        subInput,
        el("span", { text: `.${bundle.name}` }),
      ]),
      el("span", { class: "form-key", text: "Cible" }),
      targetInput,
      el("span", { class: "form-key", text: "TTL" }),
      el("div", { class: "cron-freq-field" }, [
        ttlInput,
        el("span", {
          class: "form-help",
          text: "En secondes. Vide : TTL de la zone.",
        }),
      ]),
    ]),
    aliasNote,
    errorBox,
    el("div", { class: "form-actions" }, [
      saveBtn,
      button("Annuler", { class: "btn btn-secondary", onClick: cancel }),
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// Tableau
// ---------------------------------------------------------------------------

function renderTable(ctx: DomainContext, rows: ZoneRow[]): HTMLElement {
  const { state } = ctx;
  const body = el("tbody");

  for (const row of rows) {
    if (
      state.editor &&
      ((state.editor.id !== null && state.editor.id === row.id && row.state !== "dyn") ||
        (state.editor.tempId !== null && state.editor.tempId === row.tempId))
    ) {
      for (const node of editorRows(ctx, state.editor)) body.appendChild(node);
      continue;
    }
    body.appendChild(viewRow(ctx, row));
  }

  const table = el("table", { class: "table" }, [
    el("thead", {}, [
      el("tr", {}, [
        el("th", { text: "Sous-domaine", style: { width: "24%" } }),
        el("th", { text: "Type", style: { width: "130px" } }),
        el("th", { text: "TTL", style: { width: "110px" } }),
        el("th", { text: "Cible" }),
        el("th", { style: { width: "92px" } }, [
          el("span", { class: "visually-hidden", text: "Actions" }),
        ]),
      ]),
    ]),
    body,
  ]);

  return el("div", { class: "table-wrap" }, [
    table,
    body.childElementCount === 0
      ? el("div", {
          class: "placeholder",
          text: "Aucun enregistrement ne correspond au filtre.",
        })
      : null,
  ]);
}

function viewRow(ctx: DomainContext, row: ZoneRow): HTMLTableRowElement {
  const { bundle, state } = ctx;
  const zoneTtl = bundle.soa?.ttl ?? null;
  const badge = BADGES[row.state];
  const via = txtFlavour(row);
  const editable = row.state === "" || row.state === "new" || row.state === "mod";

  const classes = ["rec-row"];
  if (row.state === "del") classes.push("is-deleted");

  return el("tr", { class: classes.join(" ") }, [
    el("td", {}, [
      el("div", { class: "rec-sub-cell" }, [
        el("span", { class: "rec-sub", text: row.subDomain || "@" }),
        badge ? el("span", { class: `tag ${badge[1]} rec-badge`, text: badge[0] }) : null,
      ]),
    ]),
    el("td", {}, [
      el("div", { class: "rec-type-cell" }, [
        el("span", { class: "tag tag-neutral", text: row.fieldType }),
        via ? el("span", { class: "rec-via", text: via }) : null,
      ]),
    ]),
    el("td", {}, [
      el("span", {
        class: row.ttl ? "rec-ttl" : "rec-ttl is-inherited",
        text: row.ttl
          ? formatDuration(row.ttl)
          : zoneTtl
            ? `zone · ${formatDuration(zoneTtl)}`
            : "TTL de la zone",
      }),
    ]),
    el("td", {}, [
      el("div", { class: "rec-target-cell" }, [
        el("span", { class: "rec-target", text: row.target }),
        renderHostingLink(ctx, row.target),
      ]),
    ]),
    el("td", {}, [
      el("div", { class: "rec-actions" }, [
        editable
          ? button("", {
              class: "btn btn-ghost btn-icon",
              icon: icon("pencil"),
              title: "Modifier",
              ariaLabel: `Modifier ${row.subDomain || "@"} ${row.fieldType}`,
              onClick: () => {
                state.editor = editorFor(row);
                ctx.rerender();
                focusFirstEditorInput();
              },
            })
          : null,
        editable
          ? button("", {
              class: "btn btn-ghost btn-icon",
              icon: icon("trash"),
              title: "Supprimer",
              ariaLabel: `Supprimer ${row.subDomain || "@"} ${row.fieldType}`,
              onClick: () => {
                if (row.id === null) return;
                state.editor = null;
                void applyAndReload(ctx, { op: "delete", id: row.id }, "supprimé");
              },
            })
          : null,
        row.state === "dyn"
          ? el(
              "span",
              {
                class: "rec-locked",
                attrs: {
                  title: "Mis à jour par un client DynHost, non modifiable ici",
                  "aria-label": "Mis à jour par un client DynHost, non modifiable ici",
                  role: "img",
                },
              },
              [icon("lock-simple")],
            )
          : null,
      ]),
    ]),
  ]);
}

function editorFor(row: ZoneRow): RecordEditor {
  const type = editableTypeOf(row);
  return {
    id: row.state === "new" ? null : row.id,
    tempId: row.tempId,
    subDomain: row.subDomain ?? "",
    fieldType: type,
    ttl: row.ttl ? String(row.ttl) : "",
    target: row.target,
    originalType: type,
    changingType: row.state === "new",
  };
}

/**
 * Les lignes de l'éditeur : la saisie, plus éventuellement l'avertissement de
 * changement de type et le message d'erreur.
 *
 * La validation est mise à jour à la main pendant la frappe, sans redessiner :
 * un redessin ferait perdre le focus et la position du curseur.
 */
function editorRows(ctx: DomainContext, editor: RecordEditor): HTMLTableRowElement[] {
  const { bundle, state } = ctx;
  const zoneTtl = bundle.soa?.ttl ?? null;
  const isNew = editor.id === null && editor.tempId === null;
  const typeIsChangeable = isNew || editor.changingType;

  const errorCell = el("td", { class: "rec-error", attrs: { colspan: "5" } });
  const errorRow = el("tr", {}, [errorCell]);

  const saveBtn = button("", {
    class: "btn btn-primary btn-icon",
    icon: icon("check"),
    title: "Ajouter au brouillon (Entrée)",
    ariaLabel: "Valider l'enregistrement",
    onClick: () => void save(),
  });

  function revalidate(): void {
    const err = recordEditorError(editor);
    errorCell.textContent = err;
    errorRow.hidden = err === "";
    saveBtn.disabled = !editorIsSubmittable(editor);
  }

  function onKey(ev: KeyboardEvent): void {
    if (ev.key === "Enter") {
      ev.preventDefault();
      void save();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      cancel();
    }
  }

  function cancel(): void {
    state.editor = null;
    ctx.rerender();
  }

  function save(): void {
    if (!editorIsSubmittable(editor)) return;
    const subDomain = parsedSubDomain(editor);
    const ttl = parsedTtl(editor);
    const target = editor.target.trim();
    const fieldType = editor.fieldType;
    const retyped =
      editor.id !== null &&
      editor.originalType !== null &&
      editor.originalType !== fieldType;

    state.editor = null;

    if (editor.id === null) {
      void applyAndReload(
        ctx,
        { op: "create", record: { fieldType, target, subDomain, ttl: ttl ?? INHERIT_TTL } },
        "ajouté",
      );
      return;
    }

    if (retyped) {
      // Le type d'un enregistrement ne se modifie pas : l'API impose une
      // suppression puis une création, donc un nouvel identifiant. L'écran l'a
      // annoncé avant d'en arriver là.
      void retypeAndReload(ctx, editor.id, {
        fieldType,
        target,
        subDomain,
        ttl: ttl ?? INHERIT_TTL,
      });
      return;
    }

    void applyAndReload(ctx, { op: "update", id: editor.id, record: { target, subDomain, ttl } }, "modifié");
  }

  const subInput = el("input", {
    class: "input editor-focus",
    attrs: {
      type: "text",
      placeholder: "@",
      "aria-label": "Sous-domaine",
      spellcheck: "false",
      value: editor.subDomain,
      style: "font-family:var(--font-mono)",
    },
    on: {
      input: (ev) => {
        editor.subDomain = (ev.currentTarget as HTMLInputElement).value;
        revalidate();
      },
      keydown: onKey,
    },
  });

  const targetInput = el("input", {
    class: "input",
    attrs: {
      type: "text",
      placeholder: targetHint(editor.fieldType),
      "aria-label": "Cible",
      spellcheck: "false",
      value: editor.target,
      style: "font-family:var(--font-mono)",
    },
    on: {
      input: (ev) => {
        editor.target = (ev.currentTarget as HTMLInputElement).value;
        revalidate();
      },
      keydown: onKey,
    },
  });

  const ttlInput = el("input", {
    class: "input num",
    attrs: {
      type: "text",
      inputmode: "numeric",
      placeholder: zoneTtl ? `zone · ${formatDuration(zoneTtl)}` : "TTL de la zone",
      title: "En secondes. Vide : TTL de la zone.",
      "aria-label": "TTL en secondes",
      value: editor.ttl,
    },
    on: {
      input: (ev) => {
        editor.ttl = (ev.currentTarget as HTMLInputElement).value;
        revalidate();
      },
      keydown: onKey,
    },
  });

  const typeCell = el("td");
  if (typeIsChangeable) {
    const select = el(
      "select",
      {
        class: "input",
        attrs: { "aria-label": "Type d'enregistrement" },
        on: {
          change: (ev) => {
            const value = (ev.currentTarget as HTMLSelectElement).value;
            editor.fieldType = value;
            // Confort de la console OVH : un DMARC vit sous `_dmarc`.
            if (value === "DMARC" && !editor.subDomain.trim()) {
              editor.subDomain = "_dmarc";
              subInput.value = "_dmarc";
            }
            targetInput.placeholder = targetHint(value);
            revalidate();
          },
        },
      },
      recordTypeOptions().map((o) =>
        el("option", {
          text: o.label,
          attrs: { value: o.value, selected: o.value === editor.fieldType },
        }),
      ),
    );
    typeCell.appendChild(select);
  } else {
    typeCell.appendChild(
      el("div", { class: "rec-type-switch" }, [
        el("span", {
          class: "tag tag-neutral",
          text: editor.fieldType,
          style: { fontFamily: "var(--font-mono)" },
        }),
        el("button", {
          class: "link-button",
          text: "Changer le type",
          attrs: { type: "button" },
          on: {
            click: () => {
              editor.changingType = true;
              ctx.rerender();
            },
          },
        }),
      ]),
    );
  }

  const mainRow = el("tr", { class: "rec-row is-editing" }, [
    el("td", {}, [subInput]),
    typeCell,
    el("td", {}, [ttlInput]),
    el("td", {}, [targetInput]),
    el("td", {}, [
      el("div", { class: "rec-actions" }, [
        saveBtn,
        button("", {
          class: "btn btn-secondary btn-icon",
          icon: icon("x"),
          title: "Annuler (Échap)",
          ariaLabel: "Annuler la saisie",
          onClick: cancel,
        }),
      ]),
    ]),
  ]);

  const out: HTMLTableRowElement[] = [mainRow];

  // L'avertissement n'a de sens que pour un enregistrement déjà envoyé : lui
  // seul sera réellement supprimé puis recréé.
  if (editor.id !== null && editor.changingType && editor.originalType) {
    const original = editor.originalType;
    out.push(
      el("tr", { class: "rec-row is-editing" }, [
        el("td", { class: "rec-note", attrs: { colspan: "5" } }, [
          el("div", { class: "rec-note-row" }, [
            icon("warning", { size: 14 }),
            el("span", {
              text: `Le type d'un enregistrement ne se modifie pas. L'enregistrement ${original} sera supprimé et un nouveau créé, avec un nouvel identifiant.`,
            }),
            button(`Garder ${original}`, {
              class: "btn btn-ghost",
              onClick: () => {
                editor.changingType = false;
                editor.fieldType = original;
                ctx.rerender();
              },
            }),
          ]),
        ]),
      ]),
    );
  }

  out.push(errorRow);
  revalidate();

  // Un alias de confort produit un TXT : le dire avant, pas après.
  if (isTxtAlias(editor.fieldType)) {
    out.push(
      el("tr", { class: "rec-row is-editing" }, [
        el("td", { class: "rec-note", attrs: { colspan: "5" } }, [
          el("span", {
            text: `${editor.fieldType} est une saisie assistée : l'enregistrement créé sera un ${TXT_ALIASES[editor.fieldType]}.`,
          }),
        ]),
      ]),
    );
  }

  return out;
}

/** Place le curseur dans le premier champ de l'éditeur qui vient d'apparaître. */
function focusFirstEditorInput(): void {
  const input = document.querySelector<HTMLInputElement>(".editor-focus");
  input?.focus();
  input?.select();
}

/**
 * Le raccourci vers l'hébergement que sert cet enregistrement.
 *
 * Il n'apparaît que si la cible est **réellement** une adresse d'un hébergement
 * du compte : sinon il n'y a rien à ouvrir, et un bouton mort vaut moins que pas
 * de bouton.
 */
function renderHostingLink(ctx: DomainContext, target: string): HTMLElement | null {
  const key = target.toLowerCase().replace(/\.$/, "");
  const found = ctx.hostings.get(key);
  if (!found) return null;
  return button("", {
    class: "btn btn-ghost btn-icon",
    icon: icon("arrow-square-out", { size: 14 }),
    title: `Ouvrir l'hébergement ${found.title}`,
    ariaLabel: `Ouvrir l'hébergement ${found.title}`,
    onClick: () => ctx.openHosting(found.serviceName),
  });
}

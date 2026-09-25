/**
 * Sélecteur de produit — le champ de la barre du haut, ouvrable par `/` ou ⌘K.
 *
 * Avec 200 domaines, une liste déroulante classique ne sert à rien : c'est une
 * palette de recherche, au clavier de bout en bout (flèches, Entrée, Échap).
 */

import { button, el, highlight } from "../dom";
import { icon } from "../icons";
import type { ProductSummary } from "../data";

export type PickerModel = {
  /** Libellé de la famille, pour le texte du champ de recherche. */
  sectionLabel: string;
  items: ProductSummary[];
  selectedId: string | null;
  icon: Parameters<typeof icon>[0];
  onPick(id: string): void;
};

type PickerState = {
  open: boolean;
  query: string;
  highlighted: number;
};

export type Picker = {
  root: HTMLElement;
  /** Ouvre la palette et place le curseur dans la recherche. */
  open(): void;
  close(): void;
  /** Reconstruit le champ après un changement de sélection ou de liste. */
  update(model: PickerModel): void;
};

export function createPicker(initial: PickerModel): Picker {
  let model = initial;
  const state: PickerState = { open: false, query: "", highlighted: 0 };

  const root = el("div", { class: "picker" });

  function matches(): ProductSummary[] {
    const q = state.query.trim().toLowerCase();
    if (!q) return model.items;
    return model.items.filter(
      (i) => i.id.toLowerCase().includes(q) || i.offer.toLowerCase().includes(q),
    );
  }

  function open(): void {
    state.open = true;
    state.query = "";
    state.highlighted = Math.max(
      0,
      model.items.findIndex((i) => i.id === model.selectedId),
    );
    draw();
    root.querySelector<HTMLInputElement>(".picker-search input")?.focus();
  }

  function close(): void {
    state.open = false;
    state.query = "";
    state.highlighted = 0;
    draw();
  }

  function pick(id: string): void {
    close();
    model.onPick(id);
  }

  function drawList(list: ProductSummary[]): HTMLElement {
    const container = el("div", {
      class: "picker-list",
      attrs: { role: "listbox", "aria-label": `Vos ${model.sectionLabel.toLowerCase()}` },
    });

    list.forEach((item, index) => {
      const current = item.id === model.selectedId;
      const classes = ["picker-option"];
      if (index === state.highlighted) classes.push("is-highlighted");
      if (!item.ok) classes.push("is-warn");

      container.appendChild(
        el(
          "button",
          {
            class: classes.join(" "),
            attrs: {
              type: "button",
              role: "option",
              "aria-selected": current,
              id: `picker-option-${index}`,
            },
            on: {
              click: () => pick(item.id),
              mouseenter: () => {
                state.highlighted = index;
                for (const [i, node] of [
                  ...container.querySelectorAll(".picker-option"),
                ].entries()) {
                  node.classList.toggle("is-highlighted", i === index);
                }
              },
            },
          },
          [
            el("span", { class: "dot" }),
            el("span", { class: "picker-option-text" }, [
              el("span", { class: "picker-option-name" }, [
                highlight(item.id, state.query.trim()),
              ]),
              el("span", { class: "picker-option-offer", text: item.offer }),
            ]),
            !item.ok && item.status
              ? el("span", { class: "tag tag-outline", text: item.status })
              : null,
            current ? icon("check", { size: 16 }) : null,
          ],
        ),
      );
    });

    if (list.length === 0) {
      container.appendChild(
        el("div", {
          class: "placeholder",
          text: `Aucun résultat pour « ${state.query} »`,
        }),
      );
    }

    return container;
  }

  function drawPanel(): HTMLElement {
    const list = matches();

    const search = el("input", {
      attrs: {
        type: "text",
        placeholder: `Rechercher parmi vos ${model.sectionLabel.toLowerCase()}`,
        "aria-label": `Rechercher parmi vos ${model.sectionLabel.toLowerCase()}`,
        spellcheck: "false",
        autocomplete: "off",
        role: "combobox",
        "aria-expanded": "true",
        "aria-controls": "picker-list",
        "aria-activedescendant": `picker-option-${state.highlighted}`,
        value: state.query,
      },
      on: {
        input: (ev) => {
          state.query = (ev.currentTarget as HTMLInputElement).value;
          state.highlighted = 0;
          draw();
          const next = root.querySelector<HTMLInputElement>(".picker-search input");
          next?.focus();
          next?.setSelectionRange(next.value.length, next.value.length);
        },
        keydown: (ev) => {
          const current = matches();
          if (ev.key === "ArrowDown") {
            ev.preventDefault();
            state.highlighted = (state.highlighted + 1) % Math.max(1, current.length);
            draw();
            root.querySelector<HTMLInputElement>(".picker-search input")?.focus();
          } else if (ev.key === "ArrowUp") {
            ev.preventDefault();
            state.highlighted =
              (state.highlighted - 1 + current.length) % Math.max(1, current.length);
            draw();
            root.querySelector<HTMLInputElement>(".picker-search input")?.focus();
          } else if (ev.key === "Enter") {
            ev.preventDefault();
            const target = current[state.highlighted];
            if (target) pick(target.id);
          } else if (ev.key === "Escape") {
            ev.preventDefault();
            close();
            root.querySelector<HTMLButtonElement>(".picker-trigger")?.focus();
          }
        },
      },
    });

    return el("div", {}, [
      // Un clic à côté referme : le scrim n'est pas décoratif.
      el("div", { class: "picker-scrim", on: { click: close } }),
      el("div", { class: "picker-panel elev-lg" }, [
        el("div", { class: "picker-search" }, [
          icon("magnifying-glass", { size: 16 }),
          search,
          el("span", {
            class: "picker-count",
            text: `${list.length} / ${model.items.length}`,
          }),
        ]),
        drawList(list),
        el("div", { class: "picker-footer" }, [
          el("span", { text: "↑ ↓ naviguer" }),
          el("span", { text: "↵ ouvrir" }),
          el("span", { text: "échap fermer" }),
        ]),
      ]),
    ]);
  }

  function draw(): void {
    const label = model.selectedId ?? "Aucun produit";
    const trigger = el(
      "button",
      {
        class: "picker-trigger",
        attrs: {
          type: "button",
          "aria-haspopup": "listbox",
          "aria-expanded": state.open,
          disabled: model.items.length === 0 ? true : null,
        },
        on: { click: () => (state.open ? close() : open()) },
      },
      [
        icon(model.icon, { size: 16 }),
        el("span", { class: "picker-trigger-name", text: label }),
        el("span", { class: "kbd", text: "/" }),
        icon("caret-up-down", { size: 16 }),
      ],
    );

    root.replaceChildren(trigger);
    if (state.open) root.appendChild(drawPanel());
  }

  draw();

  return {
    root,
    open,
    close,
    update(next: PickerModel) {
      model = next;
      draw();
    },
  };
}

/** Le bouton de déconnexion de la barre latérale, extrait pour la lisibilité. */
export function logoutButton(onClick: () => void): HTMLElement {
  return button("", {
    class: "btn btn-ghost btn-icon",
    icon: icon("sign-out", { size: 18 }),
    title: "Se déconnecter",
    ariaLabel: "Se déconnecter",
    onClick,
  });
}

/**
 * La page d'un produit d'une famille autre que les domaines.
 *
 * Le backend n'expose que `/domain` : cette vue n'a donc de contenu qu'en mode
 * « données d'exemple ». En mode normal, elle dit ce qui manque plutôt que
 * d'afficher une page vide — la famille n'apparaît d'ailleurs pas dans la barre
 * latérale tant qu'elle n'est pas branchée.
 */

import { button, el } from "../dom";
import { icon } from "../icons";
import type { ProductDetail } from "../data";

export function renderProductPage(
  detail: ProductDetail | null,
  sectionLabel: string,
): DocumentFragment {
  const out = document.createDocumentFragment();

  if (!detail) {
    out.appendChild(
      el("div", { class: "unsupported" }, [
        icon("prohibit", { size: 16 }),
        `Les ${sectionLabel.toLowerCase()} ne sont pas encore exposés par le backend : seuls les domaines le sont.`,
      ]),
    );
    return out;
  }

  out.appendChild(
    el("div", { class: "page-head" }, [
      el("h1", { class: "page-title", text: detail.id }),
      el("div", { class: "page-head-actions" }, [
        el("span", {
          class: `tag ${detail.ok ? "tag-state-ok" : "tag-state-warn"}`,
          text: detail.status,
        }),
        ...detail.secondary.map((a) =>
          button(a.label, { class: "btn btn-secondary", icon: icon(a.icon) }),
        ),
        detail.primary
          ? button(detail.primary.label, {
              class: "btn btn-primary",
              icon: icon(detail.primary.icon),
            })
          : null,
      ]),
    ]),
  );

  if (detail.infos.length > 0) {
    out.appendChild(
      el(
        "div",
        { class: "infos-grid" },
        detail.infos.map((f) =>
          el("div", { class: "card info-card" }, [
            el("div", { class: "info-key", text: f.k }),
            el("div", { class: "info-value", text: f.v }),
          ]),
        ),
      ),
    );
  }

  if (detail.table) {
    const table = detail.table;
    out.appendChild(
      el("section", {}, [
        el("h2", { text: table.title }),
        el("div", { class: "table-wrap" }, [
          el("table", { class: "table" }, [
            el("thead", {}, [
              el(
                "tr",
                {},
                table.cols.map((c) => el("th", { text: c })),
              ),
            ]),
            el(
              "tbody",
              {},
              table.rows.map((row) =>
                el(
                  "tr",
                  {},
                  row.map((cell) => el("td", { class: "num", text: cell })),
                ),
              ),
            ),
          ]),
        ]),
      ]),
    );
  }

  return out;
}

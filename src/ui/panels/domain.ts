/**
 * La page d'un domaine : en-tête, serveurs DNS, onglets.
 *
 * L'en-tête porte deux choses que la maquette met volontairement au-dessus des
 * onglets, parce qu'elles concernent le domaine entier :
 *
 * - l'**activité en cours** : les écritures rendent des tâches, et il faut
 *   pouvoir aller les voir sans les chercher ;
 * - les **serveurs DNS**, dont l'enregistrement **écrase toute la liste**. D'où
 *   la vue avant/après obligatoire avant d'appliquer : un serveur omis est un
 *   serveur supprimé, et ça ne se découvre pas après coup.
 */

import {
  meContactName,
  contactNameOf,
  describeFailure,
  nicHandleOf,
  replaceNameServers,
} from "../data";
import { button, el, frag } from "../dom";
import { icon, spinner } from "../icons";
import {
  dnssecShortLabel,
  domainStateLabel,
  formatDate,
  formatPeriod,
  isHealthyDomainState,
  lockShortLabel,
  plural,
  renewalStateLabel,
  suspensionStateLabel,
} from "../labels";
import { toast, toastError } from "../toast";
import type { DomainContext } from "./context";
import { isValidHost, type DomainTab } from "./state";
import { renderZoneTab } from "./zone";
import { renderRegistryTab } from "./registry";
import { renderContactsTab } from "./contacts";
import { mergeOperations, renderOperationsTab } from "./operations";

const MAX_NAME_SERVERS = 5;

export function renderDomainPage(ctx: DomainContext): DocumentFragment {
  return frag(
    renderHeader(ctx),
    renderPartialErrors(ctx),
    renderTabs(ctx),
    renderActiveTab(ctx),
  );
}

// ---------------------------------------------------------------------------
// En-tête
// ---------------------------------------------------------------------------

function renderHeader(ctx: DomainContext): HTMLElement {
  const { bundle } = ctx;
  const service = bundle.service;
  const healthy =
    isHealthyDomainState(service.state) && service.suspensionState === "not_suspended";

  const operations = mergeOperations(ctx);
  const running = operations.filter((o) => o.status === "doing" || o.status === "todo").length;
  const failed = operations.filter((o) => o.status === "error" || o.status === "problem").length;
  const activityParts = [
    running > 0 ? `${running} ${plural(running, "opération")} en cours` : "",
    failed > 0 ? `${failed} ${plural(failed, "échec")}` : "",
  ].filter(Boolean);

  const statusLabel =
    service.suspensionState === "suspended"
      ? `${domainStateLabel(service.state)} · ${suspensionStateLabel(service.suspensionState)}`
      : domainStateLabel(service.state);

  return el("div", { class: "domain-head" }, [
    el("div", { class: "domain-head-row" }, [
      el("h1", { class: "page-title", text: bundle.name }),
      // Vert pour « rien à faire », contour accentué pour « il y a à voir ». La
      // teinte de succès n'est pas une variante de l'accent : c'est ce qui
      // permet de distinguer les deux d'un coup d'œil.
      el("span", {
        class: `tag ${healthy ? "tag-state-ok" : "tag-state-warn"}`,
        text: statusLabel,
      }),
      el("div", { class: "spacer" }),
      activityParts.length > 0
        ? button(activityParts.join(" · "), {
            class: "btn btn-ghost activity-btn",
            icon:
              running > 0
                ? spinner(15)
                : icon("warning", { size: 15, className: "text-muted" }),
            onClick: () => ctx.goToTab("ops"),
          })
        : null,
    ]),
    renderSummaryCards(ctx),
    renderNameServers(ctx),
  ]);
}

/**
 * Les cartes de synthèse du domaine.
 *
 * Elles remplacent la ligne d'expiration, qui empilait trois informations sans
 * hiérarchie et ne menait nulle part. Chaque carte est un bouton vers l'onglet
 * où l'on agit sur ce qu'elle montre : lire « Renouvellement · Manuel » et
 * devoir chercher où le changer était le vrai défaut.
 */
function renderSummaryCards(ctx: DomainContext): HTMLElement {
  const { bundle } = ctx;
  const service = bundle.service;
  const renew = bundle.serviceInfo?.renew;
  const healthy =
    isHealthyDomainState(service.state) && service.suspensionState === "not_suspended";

  const renewValue = renew
    ? renew.deleteAtExpiration
      ? "Suppression"
      : `${renew.automatic ? "Auto" : "Manuel"} · ${formatPeriod(renew.period ?? 12)}`
    : renewalStateLabel(service.renewalState);

  // Le statut DNSSEC affiché est celui de la zone quand il a pu être lu : c'est
  // celui que l'onglet Registre bascule.
  const dnssecStatus = bundle.zoneDnssec?.status ?? service.dnssecState;

  const ownerId = service.contactOwner.id;
  // Ordre de préférence : la fiche `/me/contact` (la seule qui porte un vrai
  // nom), puis la liste des contacts du domaine, puis l'identifiant brut — qui
  // ne veut rien dire pour personne, mais vaut mieux qu'une case vide.
  const owner =
    meContactName(ownerId) ??
    contactNameOf(bundle, ownerId) ??
    nicHandleOf(bundle, ownerId) ??
    ownerId;

  const cards: {
    k: string;
    v: string;
    tone?: "muted" | "warn";
    tab: DomainTab;
  }[] = [
    {
      k: "Expiration",
      v: formatDate(service.expirationDate),
      tone: healthy ? undefined : "warn",
      tab: "registry",
    },
    { k: "Renouvellement", v: renewValue, tab: "registry" },
    {
      k: "DNSSEC",
      v: dnssecShortLabel(dnssecStatus, service.dnssecSupported),
      tone: service.dnssecSupported ? undefined : "muted",
      tab: "registry",
    },
    {
      k: "Protection transfert",
      v: lockShortLabel(service.transferLockStatus),
      tone: service.transferLockStatus === "unavailable" ? "muted" : undefined,
      tab: "registry",
    },
    { k: "Propriétaire", v: owner, tab: "contacts" },
  ];

  return el(
    "div",
    { class: "summary-cards" },
    cards.map((c) =>
      el(
        "button",
        {
          class: "card summary-card",
          attrs: { type: "button", title: `${c.k} — aller à l'onglet correspondant` },
          on: { click: () => ctx.goToTab(c.tab) },
        },
        [
          el("span", { class: "k", text: c.k }),
          el("span", {
            class: c.tone ? `v is-${c.tone}` : "v",
            text: c.v,
          }),
        ],
      ),
    ),
  );
}

function renderPartialErrors(ctx: DomainContext): HTMLElement | null {
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
// Serveurs DNS
// ---------------------------------------------------------------------------

function nameServerLabel(index: number): string {
  if (index === 0) return "Primaire";
  if (index === 1) return "Secondaire";
  return `Serveur ${index + 1}`;
}

function renderNameServers(ctx: DomainContext): HTMLElement {
  const { state } = ctx;
  if (!state.ns) return renderNameServersView(ctx);
  return state.ns.step === "edit" ? renderNameServersEdit(ctx) : renderNameServersConfirm(ctx);
}

function renderNameServersView(ctx: DomainContext): HTMLElement {
  const { bundle, state } = ctx;
  // `toDelete` signale une suppression demandée mais pas encore effective : tant
  // qu'elle court, une nouvelle écriture n'a pas de sens.
  const pending = bundle.nameServers.some((n) => n.toDelete);
  const hosts = bundle.nameServers.length > 0
    ? bundle.nameServers
    : (bundle.zone?.nameServers ?? []).map((host, i) => ({
        id: -1 - i,
        host,
        ip: null,
        isUsed: true,
        toDelete: false,
      }));

  return el("div", { class: "ns-line" }, [
    el("span", { class: "ns-label", text: "Serveurs DNS" }),
    ...hosts.map((n, i) =>
      el(
        "span",
        {
          class: n.toDelete ? "ns-item is-pending" : "ns-item",
          attrs: {
            title: [
              nameServerLabel(i),
              n.isUsed ? "utilisé" : "déclaré, non utilisé",
              n.toDelete ? "suppression demandée" : null,
              n.ip ? `IP ${n.ip}` : null,
            ]
              .filter(Boolean)
              .join(" · "),
          },
        },
        [el("span", { class: "dot" }), el("span", { class: "mono", text: n.host })],
      ),
    ),
    hosts.length === 0
      ? el("span", { class: "section-note", text: "Aucun serveur déclaré." })
      : null,
    pending
      ? el("span", { class: "section-note", text: "Mise à jour en cours au registre…" })
      : button("", {
          class: "btn btn-ghost btn-icon",
          icon: icon("pencil", { size: 15 }),
          title: "Modifier les serveurs DNS",
          ariaLabel: "Modifier les serveurs DNS",
          attrs: { style: "width:28px;height:28px" },
          onClick: () => {
            state.ns = { step: "edit", hosts: hosts.map((n) => n.host) };
            ctx.rerender();
          },
        }),
  ]);
}

function currentHosts(ctx: DomainContext): string[] {
  const { bundle } = ctx;
  if (bundle.nameServers.length > 0) return bundle.nameServers.map((n) => n.host);
  return bundle.zone?.nameServers ?? [];
}

function cleanedDrafts(hosts: string[]): string[] {
  return hosts.map((h) => h.trim().toLowerCase().replace(/\.$/, ""));
}

function draftError(hosts: string[]): string {
  const clean = cleanedDrafts(hosts);
  if (clean.length === 0) return "Renseignez au moins un serveur.";
  if (clean.some((h) => !h)) return "Renseignez chaque serveur.";
  if (clean.some((h) => !isValidHost(h))) return "Nom d'hôte invalide.";
  if (new Set(clean).size !== clean.length) return "Les serveurs doivent être différents.";
  return "";
}

function renderNameServersEdit(ctx: DomainContext): HTMLElement {
  const { state } = ctx;
  const editor = state.ns;
  if (!editor) return el("div");

  const current = cleanedDrafts(currentHosts(ctx));

  const errorBox = el("div", { class: "ns-indent ns-error", attrs: { hidden: true } });
  const reviewBtn = button("Vérifier les changements", {
    class: "btn btn-primary",
    onClick: () => review(),
  });

  function unchanged(): boolean {
    const clean = cleanedDrafts(editor!.hosts);
    return clean.length === current.length && clean.every((h, i) => h === current[i]);
  }

  function revalidate(): void {
    const err = draftError(editor!.hosts);
    errorBox.textContent = err;
    // Le message n'apparaît pas pendant la frappe du premier caractère : on
    // attend que chaque champ soit non vide pour parler d'invalidité.
    errorBox.hidden = err === "" || cleanedDrafts(editor!.hosts).some((h) => !h);
    reviewBtn.disabled = err !== "" || unchanged();
    reviewBtn.title = unchanged() ? "Aucun changement à vérifier." : "";
  }

  function review(): void {
    if (draftError(editor!.hosts) !== "" || unchanged()) return;
    editor!.step = "confirm";
    ctx.rerender();
  }

  function cancel(): void {
    state.ns = null;
    ctx.rerender();
  }

  function onKey(ev: KeyboardEvent): void {
    if (ev.key === "Enter") {
      ev.preventDefault();
      review();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      cancel();
    }
  }

  const rows = editor.hosts.map((host, index) =>
    el("div", { class: "ns-draft-row" }, [
      el("span", { class: "ns-draft-label", text: nameServerLabel(index) }),
      el("input", {
        class: "input",
        attrs: {
          type: "text",
          placeholder: "ns1.exemple.fr",
          "aria-label": `${nameServerLabel(index)} — nom d'hôte`,
          spellcheck: "false",
          value: host,
        },
        on: {
          input: (ev) => {
            editor.hosts[index] = (ev.currentTarget as HTMLInputElement).value;
            revalidate();
          },
          keydown: onKey,
        },
      }),
      button("", {
        class: "btn btn-ghost btn-icon",
        icon: icon("minus-circle"),
        title: "Retirer",
        ariaLabel: `Retirer le ${nameServerLabel(index).toLowerCase()}`,
        disabled: editor.hosts.length < 2,
        onClick: () => {
          editor.hosts = editor.hosts.filter((_, i) => i !== index);
          ctx.rerender();
        },
      }),
    ]),
  );

  revalidate();

  return el("div", { class: "panel-accent" }, [
    el("div", {
      class: "warn-text",
      text: "La liste envoyée remplace toute la configuration au registre. Un serveur retiré ici n'est plus déclaré.",
    }),
    ...rows,
    editor.hosts.length < MAX_NAME_SERVERS
      ? el("div", { class: "ns-indent" }, [
          button("Ajouter un serveur", {
            class: "btn btn-ghost",
            icon: icon("plus"),
            onClick: () => {
              editor.hosts = [...editor.hosts, ""];
              ctx.rerender();
            },
          }),
        ])
      : null,
    errorBox,
    el("div", { class: "ns-indent row" }, [
      reviewBtn,
      button("Annuler", { class: "btn btn-secondary", onClick: cancel }),
    ]),
  ]);
}

function renderNameServersConfirm(ctx: DomainContext): HTMLElement {
  const { bundle, state } = ctx;
  const editor = state.ns;
  if (!editor) return el("div");

  const current = cleanedDrafts(currentHosts(ctx));
  const next = cleanedDrafts(editor.hosts);

  const diff = [
    ...current.map((host) =>
      next.includes(host)
        ? { sign: "", host, note: "inchangé", cls: "" }
        : { sign: "−", host, note: "ne sera plus déclaré", cls: "is-removed" },
    ),
    ...next
      .filter((host) => !current.includes(host))
      .map((host) => ({ sign: "+", host, note: "ajouté", cls: "is-added" })),
  ];

  async function apply(): Promise<void> {
    state.nsBusy = true;
    ctx.rerender();
    try {
      await replaceNameServers(
        bundle.name,
        // `ip` n'est requis que pour un serveur situé dans la zone qu'il sert :
        // les glue records se gèrent dans l'onglet Registre, pas ici.
        next.map((host) => ({ host, ip: null })),
      );
      state.ns = null;
      state.nsBusy = false;
      toast("Demande envoyée au registre. Suivi dans Opérations.");
      ctx.reload({ force: true });
      ctx.trackTasks();
    } catch (e) {
      state.nsBusy = false;
      toastError(describeFailure(e).message);
      ctx.rerender();
    }
  }

  return el("div", { class: "panel-accent" }, [
    el("div", {
      text: "Nouvelle configuration des serveurs DNS",
      style: { fontSize: "14px", fontWeight: "500" },
    }),
    el(
      "div",
      { class: "ns-diff" },
      diff.map((d) =>
        el("div", { class: `ns-diff-row ${d.cls}`.trim() }, [
          el("span", { class: "sign", text: d.sign }),
          el("span", { class: "host", text: d.host }),
          el("span", { class: "note", text: d.note }),
        ]),
      ),
    ),
    el("div", {
      class: "warn-text",
      text: "La propagation au registre prend quelques minutes. Suivi dans Opérations.",
    }),
    el("div", { class: "ns-indent row", style: { paddingLeft: "0" } }, [
      button(state.nsBusy ? "Envoi…" : "Appliquer", {
        class: "btn btn-primary",
        disabled: state.nsBusy,
        icon: state.nsBusy ? spinner(16) : undefined,
        onClick: () => void apply(),
      }),
      button("Retour", {
        class: "btn btn-secondary",
        disabled: state.nsBusy,
        onClick: () => {
          editor.step = "edit";
          ctx.rerender();
        },
      }),
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// Onglets
// ---------------------------------------------------------------------------

function renderTabs(ctx: DomainContext): HTMLElement {
  const { state } = ctx;
  const operations = mergeOperations(ctx);
  const running = operations.filter((o) => o.status === "doing" || o.status === "todo").length;

  const tabs: { key: DomainTab; label: string; n: number }[] = [
    // L'écriture est immédiate : il n'y a plus de modification « en attente »
    // côté interface à compter ici.
    { key: "zone", label: "Zone DNS", n: 0 },
    { key: "registry", label: "Registre", n: 0 },
    { key: "contacts", label: "Contacts", n: 0 },
    { key: "ops", label: "Opérations", n: running },
  ];

  return el(
    "div",
    { class: "tabs", attrs: { role: "tablist", "aria-label": "Sections du domaine" } },
    tabs.map((t) =>
      el(
        "button",
        {
          class: "tab",
          attrs: {
            type: "button",
            role: "tab",
            id: `tab-${t.key}`,
            "aria-selected": state.tab === t.key,
            "aria-controls": "tabpanel",
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

function renderActiveTab(ctx: DomainContext): HTMLElement {
  const { state } = ctx;
  const panel = el("div", {
    attrs: {
      id: "tabpanel",
      role: "tabpanel",
      "aria-labelledby": `tab-${state.tab}`,
      tabindex: "0",
    },
    style: { display: "flex", flexDirection: "column", gap: "var(--space-9)" },
  });

  switch (state.tab) {
    case "zone":
      panel.appendChild(renderZoneTab(ctx));
      break;
    case "registry":
      panel.appendChild(renderRegistryTab(ctx));
      break;
    case "contacts":
      panel.appendChild(renderContactsTab(ctx));
      break;
    case "ops":
      panel.appendChild(renderOperationsTab(ctx));
      break;
  }

  return panel;
}

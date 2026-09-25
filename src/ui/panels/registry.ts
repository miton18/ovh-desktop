/**
 * Onglet « Registre » : ce qui se passe chez le registre de l'extension.
 *
 * Tout ici dépend de ce que le registre accepte, et l'interface doit le dire :
 * `transferLockStatus` peut valoir `unavailable`, `dnssecSupported` peut être
 * faux, `hostSupported` / `glueRecordIpv6Supported` / `glueRecordMultiIpSupported`
 * bornent les glue records. **On grise avec la raison affichée, on ne masque
 * jamais sans explication** : un bouton absent ne dit pas pourquoi.
 */

import {
  createGlueRecord,
  deleteGlueRecord,
  describeFailure,
  setRenew,
  setTransferLock,
  setZoneDnssec,
} from "../data";
import { button, el, frag, switchButton, switchField } from "../dom";
import { icon } from "../icons";
import {
  dnssecPresentation,
  formatDate,
  formatPeriod,
  lockPresentation,
  type TogglePresentation,
} from "../labels";
import { toast, toastError } from "../toast";
import type { DomainContext } from "./context";
import { isValidHost, isValidIpv4, looksLikeIpv6 } from "./state";

export function renderRegistryTab(ctx: DomainContext): DocumentFragment {
  return frag(renderSettings(ctx), renderGlueSection(ctx));
}

// ---------------------------------------------------------------------------
// Verrou, DNSSEC, renouvellement
// ---------------------------------------------------------------------------

function renderSettings(ctx: DomainContext): HTMLElement {
  return el("section", { attrs: { "aria-label": "Réglages au registre" } }, [
    el("div", { class: "stack" }, [
      renderLockRow(ctx),
      renderDnssecRow(ctx),
      ...renderRenewRows(ctx),
    ]),
  ]);
}

/**
 * Une ligne pilotée par interrupteur : titre, état courant, et la bascule.
 *
 * `reason` n'est affiché que quand la bascule n'est pas proposable et que la
 * raison n'est pas déjà dans la description — l'utilisateur doit toujours savoir
 * pourquoi un interrupteur ne répond pas.
 */
function renderToggleRow(options: {
  title: string;
  view: TogglePresentation;
  ariaLabel: string;
  reason?: string | null;
  onToggle: () => void;
}): HTMLElement {
  const { view } = options;
  return el("div", { class: "reg-row" }, [
    el("div", { class: "reg-row-text" }, [
      el("span", { text: options.title }),
      el("span", { text: view.description }),
    ]),
    switchField(
      view.label,
      switchButton({
        on: view.on,
        busy: view.busy,
        disabled: !view.actionable,
        ariaLabel: options.ariaLabel,
        title: view.actionable ? undefined : (options.reason ?? view.description),
        onToggle: options.onToggle,
      }),
    ),
    options.reason && !view.actionable
      ? el("span", { class: "reg-row-reason", text: options.reason })
      : null,
  ]);
}

function renderLockRow(ctx: DomainContext): HTMLElement {
  const { bundle, state } = ctx;
  const status = bundle.service.transferLockStatus;
  const view = lockPresentation(status);
  const busy = state.busy.has("lock");
  const nextStatus: "locked" | "unlocked" = view.on ? "unlocked" : "locked";

  return renderToggleRow({
    title: "Protection contre le transfert",
    ariaLabel: "Protection contre le transfert",
    view: busy ? { ...view, actionable: false, busy: true } : view,
    onToggle: () => {
      state.busy.add("lock");
      ctx.rerender();
      void setTransferLock(bundle.name, nextStatus)
        .then(() => {
          state.busy.delete("lock");
          toast(
            nextStatus === "locked"
              ? "Activation du verrou demandée au registre"
              : "Désactivation du verrou demandée au registre",
          );
          ctx.reload({ force: true });
          ctx.trackTasks();
        })
        .catch((e) => {
          state.busy.delete("lock");
          toastError(describeFailure(e).message);
          ctx.rerender();
        });
    },
  });
}

function renderDnssecRow(ctx: DomainContext): HTMLElement {
  const { bundle, state } = ctx;
  const supported = bundle.service.dnssecSupported;
  const busy = state.busy.has("dnssec");

  // C'est le statut de la ZONE qui se bascule, pas `dnssecState` du domaine :
  // `dnssecEnable`/`dnssecDisable` portent sur la zone, et seul ce statut-là
  // passe par `enableInProgress`. Sans lui, on n'a rien à basculer de façon sûre.
  const status = bundle.zoneDnssec?.status ?? bundle.service.dnssecState;
  const unreadable = supported && bundle.zoneDnssec === null;
  const base = dnssecPresentation(status, supported);
  const view =
    unreadable || busy ? { ...base, actionable: false, busy: busy && !unreadable } : base;

  return renderToggleRow({
    title: "DNSSEC",
    ariaLabel: "DNSSEC",
    view,
    reason: unreadable
      ? "Le statut DNSSEC de la zone n'a pas pu être lu : la bascule serait à l'aveugle."
      : null,
    onToggle: () => {
      const enable = !view.on;
      state.busy.add("dnssec");
      ctx.rerender();
      void setZoneDnssec(bundle.name, enable)
        .then(() => {
          state.busy.delete("dnssec");
          toast(
            enable
              ? "Activation de DNSSEC demandée. La signature prend quelques minutes."
              : "Désactivation de DNSSEC demandée au registre.",
          );
          ctx.reload({ force: true });
          ctx.trackTasks();
        })
        .catch((e) => {
          state.busy.delete("dnssec");
          toastError(describeFailure(e).message);
          ctx.rerender();
        });
    },
  });
}

function renderRenewRows(ctx: DomainContext): HTMLElement[] {
  const { bundle, state } = ctx;
  const info = bundle.serviceInfo;

  if (!info) {
    return [
      el("div", { class: "reg-row" }, [
        el("div", { class: "reg-row-text" }, [
          el("span", { text: "Renouvellement" }),
          el("span", {
            text: "Les informations de facturation n'ont pas pu être chargées.",
          }),
        ]),
      ]),
    ];
  }

  const renew = info.renew;
  const automatic = renew?.automatic === true;
  const deleteAtExpiration = renew?.deleteAtExpiration === true;
  const period = renew?.period ?? 12;
  const periods = info.possibleRenewPeriod ?? [period];
  const busy = state.busy.has("renew");

  const description = deleteAtExpiration
    ? `Sera supprimé le ${formatDate(info.expiration)}, sans renouvellement.`
    : automatic
      ? `Renouvelé automatiquement le ${formatDate(info.expiration)} pour ${formatPeriod(period)}.`
      : `Expire le ${formatDate(info.expiration)}. Paiement manuel requis avant cette date.`;

  /** Toute écriture passe par `renew` entier : c'est le seul bloc modifiable. */
  function apply(patch: Partial<NonNullable<typeof renew>>, message: string): void {
    state.busy.add("renew");
    ctx.rerender();
    void setRenew(bundle.name, {
      automatic,
      deleteAtExpiration,
      forced: renew?.forced ?? false,
      manualPayment: renew?.manualPayment ?? null,
      period,
      ...patch,
    })
      .then(() => {
        state.busy.delete("renew");
        toast(message);
        ctx.reload({ force: true });
      })
      .catch((e) => {
        state.busy.delete("renew");
        toastError(describeFailure(e).message);
        ctx.rerender();
      });
  }

  const modeSwitch = el(
    "div",
    { class: "seg", attrs: { role: "group", "aria-label": "Mode de renouvellement" } },
    [
      el("button", {
        class: "seg-opt",
        text: "Automatique",
        attrs: { type: "button", "aria-pressed": automatic, disabled: busy ? true : null },
        on: {
          click: () => {
            if (!automatic) apply({ automatic: true }, "Renouvellement automatique");
          },
        },
      }),
      el("button", {
        class: "seg-opt",
        text: "Manuel",
        attrs: { type: "button", "aria-pressed": !automatic, disabled: busy ? true : null },
        on: {
          click: () => {
            if (automatic) apply({ automatic: false }, "Renouvellement manuel");
          },
        },
      }),
    ],
  );

  const periodSelect = el(
    "select",
    {
      class: "input",
      attrs: {
        "aria-label": "Période de renouvellement",
        style: "width:110px",
        disabled: busy ? true : null,
      },
      on: {
        change: (ev) => {
          const months = Number((ev.currentTarget as HTMLSelectElement).value);
          apply({ period: months }, `Période de renouvellement : ${formatPeriod(months)}`);
        },
      },
    },
    periods.map((m) =>
      el("option", {
        text: formatPeriod(m),
        attrs: { value: String(m), selected: m === period },
      }),
    ),
  );

  const canDelete = info.canDeleteAtExpiration;

  return [
    el("div", { class: "reg-row" }, [
      el("div", { class: "reg-row-text" }, [
        el("span", { text: "Renouvellement" }),
        el("span", { text: description }),
      ]),
      modeSwitch,
      periodSelect,
    ]),
    renderToggleRow({
      title: "Supprimer le domaine à l'échéance",
      ariaLabel: "Supprimer le domaine à l'échéance",
      view: {
        label: deleteAtExpiration ? "Activée" : "Désactivée",
        description: canDelete
          ? deleteAtExpiration
            ? "Aucun renouvellement ne sera tenté."
            : "Le domaine est conservé tant qu'il est renouvelé."
          : "Non proposé pour cette extension.",
        on: deleteAtExpiration,
        actionable: canDelete && !busy,
        busy,
      },
      onToggle: () => {
        const on = !deleteAtExpiration;
        apply(
          { deleteAtExpiration: on },
          on
            ? "Suppression à l'échéance programmée"
            : "Suppression à l'échéance annulée",
        );
      },
    }),
  ];
}

// ---------------------------------------------------------------------------
// Glue records
// ---------------------------------------------------------------------------

function renderGlueSection(ctx: DomainContext): HTMLElement {
  const { bundle } = ctx;
  const supported = bundle.service.hostSupported;

  return el("section", { attrs: { "aria-label": "Glue records" } }, [
    el("div", { class: "section-head" }, [
      el("h2", { text: "Glue records", style: { fontSize: "16px" } }),
      el("span", {
        class: "section-note",
        text: "Publient l'IP d'un serveur DNS situé dans ce domaine.",
      }),
    ]),
    supported
      ? renderGlueList(ctx)
      : el("div", { class: "unsupported" }, [
          icon("prohibit", { size: 16 }),
          "Le registre de cette extension ne gère pas les glue records.",
        ]),
  ]);
}

function renderGlueList(ctx: DomainContext): HTMLElement {
  const { bundle, state } = ctx;
  const service = bundle.service;
  const zone = bundle.name;
  const multiIp = service.glueRecordMultiIpSupported;
  const ipv6 = service.glueRecordIpv6Supported;

  const rows = bundle.glueRecords.map((g) => {
    const busy = state.busy.has(`glue:${g.host}`);
    return el("div", { class: busy ? "stack-row is-pending" : "stack-row" }, [
      el("span", { class: "glue-host", text: g.host }),
      el("span", { class: "glue-ips", text: g.ips.join(", ") }),
      busy
        ? el("span", { class: "section-note", text: "Suppression en cours…" })
        : button("", {
            class: "btn btn-ghost btn-icon",
            icon: icon("trash"),
            title: "Supprimer",
            ariaLabel: `Supprimer le glue record ${g.host}`,
            onClick: () => {
              state.busy.add(`glue:${g.host}`);
              ctx.rerender();
              void deleteGlueRecord(zone, g.host)
                .then(() => {
                  state.busy.delete(`glue:${g.host}`);
                  toast(`Suppression de ${g.host} demandée au registre`);
                  ctx.reload({ force: true });
                  ctx.trackTasks();
                })
                .catch((e) => {
                  state.busy.delete(`glue:${g.host}`);
                  toastError(describeFailure(e).message);
                  ctx.rerender();
                });
            },
          }),
    ]);
  });

  const hostInput = el("input", {
    class: "input glue-host",
    attrs: {
      type: "text",
      placeholder: `ns1.${zone}`,
      "aria-label": "Nom du serveur",
      spellcheck: "false",
      value: state.glue.host,
    },
    on: {
      input: (ev) => {
        state.glue.host = (ev.currentTarget as HTMLInputElement).value;
        revalidate();
      },
    },
  });

  const ipsInput = el("input", {
    class: "input",
    attrs: {
      type: "text",
      placeholder: multiIp ? "203.0.113.10, 2001:db8::10" : "203.0.113.10",
      "aria-label": "Adresses IP",
      spellcheck: "false",
      style: "flex:1;min-width:200px;font-family:var(--font-mono)",
      value: state.glue.ips,
    },
    on: {
      input: (ev) => {
        state.glue.ips = (ev.currentTarget as HTMLInputElement).value;
        revalidate();
      },
    },
  });

  const addBtn = button("Ajouter", {
    class: "btn btn-secondary",
    icon: icon("plus"),
    onClick: () => void add(),
  });
  const errorBox = el("div", { class: "rec-error", attrs: { hidden: true } });

  function host(): string {
    return state.glue.host.trim().toLowerCase().replace(/\.$/, "");
  }

  function ips(): string[] {
    return state.glue.ips.split(/[\s,]+/).filter(Boolean);
  }

  /** Les règles viennent des capacités du registre, pas d'une heuristique. */
  function errorMessage(): string {
    const h = host();
    const list = ips();
    if (h && !h.endsWith(`.${zone}`)) return `Le serveur doit se trouver dans ${zone}.`;
    if (h && !isValidHost(h)) return "Nom d'hôte invalide.";
    if (h && bundle.glueRecords.some((g) => g.host === h)) {
      return "Ce serveur a déjà un glue record.";
    }
    if (list.length > 1 && !multiIp) {
      return "Une seule IP par serveur pour cette extension.";
    }
    if (list.some(looksLikeIpv6) && !ipv6) {
      return "IPv6 non accepté par ce registre.";
    }
    if (list.some((i) => !isValidIpv4(i) && !looksLikeIpv6(i))) {
      return "Adresse IP invalide.";
    }
    return "";
  }

  function revalidate(): void {
    const err = errorMessage();
    errorBox.textContent = err;
    errorBox.hidden = err === "";
    addBtn.disabled = !host() || ips().length === 0 || err !== "";
  }

  async function add(): Promise<void> {
    if (errorMessage() || !host() || ips().length === 0) return;
    addBtn.disabled = true;
    try {
      await createGlueRecord(zone, { host: host(), ips: ips() });
      state.glue = { host: "", ips: "" };
      toast("Création du glue record demandée au registre");
      ctx.reload({ force: true });
      ctx.trackTasks();
    } catch (e) {
      toastError(describeFailure(e).message);
      revalidate();
    }
  }

  revalidate();

  const capabilities = [
    ipv6 ? "IPv4 et IPv6 acceptés" : "IPv4 uniquement",
    multiIp ? "plusieurs IP par serveur, séparées par une virgule" : "une IP par serveur",
  ].join(" · ");

  return el("div", { class: "stack" }, [
    ...rows,
    el("div", { class: "stack-form" }, [
      el("div", { class: "stack-form-row" }, [hostInput, ipsInput, addBtn]),
      errorBox,
      el("div", { class: "section-note", text: `${capabilities}.` }),
    ]),
  ]);
}

/**
 * Onglet « Multisites » — les domaines servis par l'hébergement.
 *
 * C'est le seul écran du périmètre dont l'écriture **touche une autre section de
 * l'API** : sans `bypassDNSConfiguration`, attacher un domaine fait écrire
 * OVHcloud dans sa zone DNS, qui vit dans la famille Domaines. Une modification
 * invisible dans un autre écran est exactement ce qu'on veut éviter, d'où les
 * deux temps du formulaire — saisie, puis aperçu de ce qui va arriver à la zone,
 * enregistrement par enregistrement.
 *
 * Quatre issues sont possibles et se lisent avant de valider : rien ne change,
 * l'API n'écrit pas et c'est à l'utilisateur de le faire, l'API ne *peut* pas
 * écrire parce que la zone est ailleurs, ou l'API va écrire — et on montre quoi.
 */

import type { AttachedDomain, Record_ } from "../../ovh-api";
import {
  cachedZoneAddresses,
  createAttachedDomain,
  deleteAttachedDomain,
  describeFailure,
  loadZoneAddresses,
  updateAttachedDomain,
} from "../data";
import { button, el, switchButton } from "../dom";
import { icon, spinner } from "../icons";
import type { IconName } from "../icons";
import {
  formatCapacity,
  hostingRefusalMessage,
  ipCountryLabel,
  plural,
  runtimeLabel,
} from "../labels";
import { toast, toastError } from "../toast";
import { copyButton } from "./copy";
import type { HostingContext } from "./hosting-context";
import {
  canAdd,
  cleanDomain,
  cleanPath,
  defaultRuntime,
  dnsModeOf,
  ipsForLocation,
  isDeprecatedEngine,
  locationOptions,
  pendingTaskFor,
  runtimeName,
  runtimeOf,
  siteFormComplete,
  siteFormError,
  siteFormPayload,
  splitZone,
  wantedRecords,
  type DnsMode,
  type SiteForm,
} from "./hosting-state";

export function renderSitesTab(ctx: HostingContext): HTMLElement {
  ensureZonesLoaded(ctx);
  const n = ctx.bundle.attachedDomains.length;
  // Le nombre de domaines servis est une limite de l'offre : `attachedDomains: 1`
  // veut dire qu'un second sera refusé, et ça se dit avant d'essayer.
  const add = canAdd(ctx.bundle.capabilities, "attachedDomains", n);

  return el("section", { attrs: { "aria-label": "Multisites" } }, [
    el("div", { class: "host-bar" }, [
      el("span", {
        class: "section-note",
        text: [
          `${formatCapacity(n, add.limit)} ${plural(n, "domaine")} ${plural(n, "servi")} par cet hébergement`,
          recommendedNote(ctx),
        ]
          .filter(Boolean)
          .join(" · "),
      }),
      el("div", { class: "spacer" }),
      add.allowed
        ? null
        : el("span", { class: "section-note", text: add.reason }),
      button("Ajouter un multisite", {
        class: "btn btn-primary",
        icon: icon("plus"),
        disabled: ctx.state.site !== null || !add.allowed,
        title: add.allowed ? undefined : add.reason,
        onClick: () => openForm(ctx),
      }),
    ]),
    ctx.state.site ? renderForm(ctx, ctx.state.site) : null,
    renderTable(ctx),
  ]);
}

/**
 * Ce que l'offre **recommande**, distinct de ce qu'elle autorise.
 *
 * `sitesRecommended` vaut `-1` pour illimité : il n'y a alors rien à dire, et
 * l'afficher tel quel ne renseignerait personne.
 */
function recommendedNote(ctx: HostingContext): string {
  const recommended = ctx.bundle.capabilities?.sitesRecommended ?? null;
  if (recommended === null || recommended < 0) return "";
  if (recommended === 0) return "";
  return `${recommended} ${plural(recommended, "site")} recommandé${recommended > 1 ? "s" : ""} sur cette offre`;
}

/**
 * Charge en tâche de fond les adresses des zones concernées.
 *
 * Un appel filtré par type couvre toute une zone : le coût est de trois appels
 * par zone distincte, pas par multisite. Sans cette lecture, la colonne DNS ne
 * pourrait rien affirmer.
 */
function ensureZonesLoaded(ctx: HostingContext): void {
  const wanted = new Set<string>();
  for (const attached of ctx.bundle.attachedDomains) {
    if (!attached.domain) continue;
    const split = splitZone(attached.domain, ctx.zones);
    if (!split) continue;
    if (cachedZoneAddresses(split.zone) !== null) continue;
    if (ctx.state.zonesAttempted.has(split.zone)) continue;
    wanted.add(split.zone);
  }
  if (wanted.size === 0) return;

  for (const zone of wanted) ctx.state.zonesAttempted.add(zone);
  void Promise.allSettled([...wanted].map((zone) => loadZoneAddresses(zone))).then(
    () => ctx.rerender(),
  );
}

// ---------------------------------------------------------------------------
// Colonne DNS
// ---------------------------------------------------------------------------

type DnsStatus = {
  label: string;
  tone: "ok" | "warn" | "muted" | "unknown";
  title: string;
};

function recordsFor(records: Record_[], subDomain: string | null): Record_[] {
  return records.filter((r) => (r.subDomain ?? null) === subDomain);
}

/**
 * Le domaine pointe-t-il réellement vers cet hébergement.
 *
 * On ne se contente pas de dire « la zone est dans le compte » : c'est
 * l'enregistrement A qui décide si le site répond. Un CNAME est suivi une fois,
 * à l'intérieur de la même zone — au-delà, la réponse dépend d'un DNS qu'on ne
 * lit pas, et on ne l'affirme pas.
 */
function dnsStatus(ctx: HostingContext, attached: AttachedDomain): DnsStatus {
  const domain = attached.domain;
  if (!domain) {
    return { label: "—", tone: "muted", title: "Ce multisite n'a pas de domaine." };
  }

  const split = splitZone(domain, ctx.zones);
  if (!split) {
    return {
      label: "Zone hors compte",
      tone: "muted",
      title: "Le DNS de ce domaine est géré ailleurs : rien n'est vérifiable d'ici.",
    };
  }

  const records = cachedZoneAddresses(split.zone);
  if (records === null) {
    return {
      label: "…",
      tone: "unknown",
      title: `Lecture de la zone ${split.zone} en cours.`,
    };
  }

  let addresses = recordsFor(records, split.subDomain).filter(
    (r) => r.fieldType === "A",
  );
  let via = "";
  if (addresses.length === 0) {
    const cname = recordsFor(records, split.subDomain).find(
      (r) => r.fieldType === "CNAME",
    );
    const target = cname ? splitZone(cname.target, [split.zone]) : null;
    if (cname && target) {
      addresses = recordsFor(records, target.subDomain).filter(
        (r) => r.fieldType === "A",
      );
      via = ` via ${cname.target}`;
    }
  }

  if (addresses.length === 0) {
    return {
      label: "Aucune adresse",
      tone: "warn",
      title: `Aucun enregistrement A pour ${domain} dans la zone ${split.zone}.`,
    };
  }

  const wanted = ipsForLocation(ctx.bundle.service, attached.ipLocation).ip;
  if (wanted && addresses.some((r) => r.target === wanted)) {
    return { label: "Pointe ici", tone: "ok", title: `A ${wanted}${via}` };
  }
  return {
    label: `Pointe vers ${addresses[0].target}`,
    tone: "warn",
    title: `L'hébergement sert ${wanted ?? "une IP non renseignée"}, la zone ${split.zone} renvoie ailleurs${via}.`,
  };
}

// ---------------------------------------------------------------------------
// Tableau
// ---------------------------------------------------------------------------

function renderTable(ctx: HostingContext): HTMLElement {
  const body = el("tbody");
  for (const attached of ctx.bundle.attachedDomains) {
    body.appendChild(renderRow(ctx, attached));
    const confirm = renderDeleteConfirm(ctx, attached);
    if (confirm) body.appendChild(confirm);
  }

  return el("div", { class: "table-wrap" }, [
    el("table", { class: "table sites-table" }, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", { text: "Domaine" }),
          el("th", { text: "Dossier" }),
          el("th", { text: "Exécution" }),
          el("th", { text: "DNS" }),
          el("th", { text: "SSL" }),
          el("th", { text: "Pare-feu" }),
          el("th", { text: "CDN" }),
          el("th", { text: "IP" }),
          el("th", {}, [el("span", { class: "visually-hidden", text: "Actions" })]),
        ]),
      ]),
      body,
    ]),
    ctx.bundle.attachedDomains.length === 0
      ? el("div", {
          class: "placeholder",
          text: "Aucun domaine n'est servi par cet hébergement.",
        })
      : null,
  ]);
}

function renderRow(ctx: HostingContext, attached: AttachedDomain): HTMLTableRowElement {
  const { bundle, state } = ctx;
  const service = bundle.service;
  const domain = attached.domain ?? "—";
  const isDefault = attached.domain === service.defaultAttachedDomain;
  const runtime = runtimeOf(bundle, attached.runtimeId);
  const deprecated = runtime ? isDeprecatedEngine(runtime.type, service) : false;
  const dns = dnsStatus(ctx, attached);
  const pending = pendingTaskFor(bundle, attached.domain);
  const split = attached.domain ? splitZone(attached.domain, ctx.zones) : null;

  return el("tr", { class: pending ? "is-pending" : "" }, [
    el("td", {}, [
      el("div", { class: "site-domain" }, [
        el("span", { class: "mono", text: domain }),
        isDefault
          ? el("span", { class: "tag tag-neutral", text: "Principal" })
          : null,
        split
          ? button("", {
              class: "btn btn-ghost btn-icon",
              icon: icon("arrow-square-out", { size: 14 }),
              title: `Ouvrir ${split.zone} dans Domaines`,
              ariaLabel: `Ouvrir ${split.zone} dans Domaines`,
              onClick: () => ctx.openDomain(split.zone),
            })
          : null,
      ]),
    ]),
    el("td", {}, [el("span", { class: "mono", text: `/${attached.path ?? ""}` })]),
    el("td", {}, [
      el("div", { class: "site-cell" }, [
        el("span", { text: runtime ? runtimeLabel(runtime.type) : "—" }),
        deprecated
          ? el("span", { class: "tag tag-danger", text: "Plus maintenu" })
          : null,
      ]),
    ]),
    el("td", {}, [
      el("span", { class: `dns-status is-${dns.tone}`, attrs: { title: dns.title } }, [
        el("span", { class: "dot" }),
        el("span", { text: dns.label }),
      ]),
    ]),
    el("td", { text: attached.ssl ? "Actif" : "—" }),
    el("td", { text: attached.firewall === "active" ? "Actif" : "—" }),
    el("td", {
      text:
        service.hasCdn === true
          ? attached.cdn === "active"
            ? "Actif"
            : "—"
          : "Non inclus",
    }),
    el("td", { text: attached.ipLocation ? ipCountryLabel(attached.ipLocation) : "—" }),
    el("td", {}, [
      el("div", { class: "rec-actions" }, [
        pending
          ? el("span", { class: "section-note", text: pending.label })
          : button("", {
              class: "btn btn-ghost btn-icon",
              icon: icon("pencil", { size: 15 }),
              title: "Modifier",
              ariaLabel: `Modifier ${domain}`,
              onClick: () => openForm(ctx, attached),
            }),
        pending
          ? null
          : button("", {
              class: "btn btn-ghost btn-icon",
              icon: icon("link-break", { size: 15 }),
              title: isDefault
                ? "Le domaine principal ne se détache pas"
                : `Détacher ${domain}`,
              ariaLabel: `Détacher ${domain}`,
              disabled: isDefault || !attached.domain,
              onClick: () => {
                state.siteDelete = attached.domain;
                state.site = null;
                ctx.rerender();
              },
            }),
      ]),
    ]),
  ]);
}

/**
 * La confirmation de détachement, en ligne sous la ligne concernée.
 *
 * Elle dit surtout ce qui **ne** se passe pas : les fichiers restent, et la zone
 * DNS n'est pas nettoyée — l'API ne retire pas les enregistrements qu'elle a
 * écrits à l'attachement.
 */
function renderDeleteConfirm(
  ctx: HostingContext,
  attached: AttachedDomain,
): HTMLTableRowElement | null {
  const { state } = ctx;
  if (!attached.domain || state.siteDelete !== attached.domain) return null;
  const domain = attached.domain;
  const busyKey = `site:${domain}`;
  const busy = state.busy.has(busyKey);

  async function detach(): Promise<void> {
    state.busy.add(busyKey);
    ctx.rerender();
    try {
      await deleteAttachedDomain(ctx.bundle.serviceName, domain);
      state.busy.delete(busyKey);
      state.siteDelete = null;
      toast(`Détachement de ${domain} lancé. Suivi dans Opérations.`);
      ctx.reload({ force: true });
      ctx.trackTasks();
    } catch (e) {
      state.busy.delete(busyKey);
      toastError(hostingRefusalMessage(describeFailure(e).message));
      ctx.rerender();
    }
  }

  return el("tr", { class: "row-confirm" }, [
    el("td", { attrs: { colspan: "9" } }, [
      el("div", { class: "confirm-row" }, [
        el("span", {
          class: "text",
          text: `Détacher ${domain} ? Le dossier /${attached.path ?? ""} et ses fichiers restent sur l'hébergement. La zone DNS n'est pas modifiée : les enregistrements écrits à l'attachement restent en place.`,
        }),
        button(busy ? "Détachement…" : "Détacher", {
          class: "btn btn-primary",
          disabled: busy,
          icon: busy ? spinner(15) : undefined,
          onClick: () => void detach(),
        }),
        button("Annuler", {
          class: "btn btn-secondary",
          disabled: busy,
          onClick: () => {
            state.siteDelete = null;
            ctx.rerender();
          },
        }),
      ]),
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// Formulaire
// ---------------------------------------------------------------------------

function openForm(ctx: HostingContext, attached?: AttachedDomain): void {
  const { bundle, state } = ctx;
  const fallbackLocation = locationOptions(bundle.service, ["FR"])[0] ?? "FR";

  state.siteDelete = null;
  state.site = attached
    ? {
        mode: "edit",
        step: "edit",
        original: attached.domain,
        originalLocation: attached.ipLocation,
        domain: attached.domain ?? "",
        path: attached.path ?? "",
        runtimeId: attached.runtimeId,
        ipLocation: attached.ipLocation ?? fallbackLocation,
        ownLog: attached.ownLog ?? "",
        ssl: attached.ssl === true,
        firewall: attached.firewall === "active",
        cdn: attached.cdn === "active",
        bypass: false,
        dns: null,
        dnsLoading: false,
      }
    : {
        mode: "new",
        step: "edit",
        original: null,
        originalLocation: null,
        domain: "",
        path: "",
        runtimeId: defaultRuntime(bundle)?.id ?? null,
        ipLocation: fallbackLocation,
        ownLog: "",
        ssl: true,
        firewall: false,
        cdn: false,
        bypass: false,
        dns: null,
        dnsLoading: false,
      };
  ctx.rerender();
  document.querySelector<HTMLInputElement>(".site-form input")?.focus();
}

function renderForm(ctx: HostingContext, form: SiteForm): HTMLElement {
  return el("div", { class: "site-form panel-accent" }, [
    el("div", {
      class: "form-title",
      text: form.mode === "new" ? "Nouveau multisite" : `Modifier ${form.original}`,
    }),
    form.step === "edit" ? renderEditStep(ctx, form) : renderConfirmStep(ctx, form),
  ]);
}

function field(label: string, control: Node): Node[] {
  return [el("span", { class: "form-key", text: label }), control];
}

function renderEditStep(ctx: HostingContext, form: SiteForm): HTMLElement {
  const { bundle, state } = ctx;
  const service = bundle.service;

  const errorBox = el("div", { class: "form-error", attrs: { hidden: true } });
  const reviewBtn = button("Vérifier", {
    class: "btn btn-primary",
    onClick: () => void review(ctx, form),
  });

  function revalidate(): void {
    const err = siteFormError(form, bundle);
    errorBox.textContent = err;
    errorBox.hidden = err === "";
    reviewBtn.disabled = !siteFormComplete(form, bundle);
  }

  const domainInput = el("input", {
    class: "input mono",
    attrs: {
      type: "text",
      placeholder: "blog.exemple.fr",
      "aria-label": "Domaine à servir",
      spellcheck: "false",
      value: form.domain,
      // Le domaine est la clé de la route de modification : il ne se change pas
      // sur place, il se détache puis se rattache.
      disabled: form.mode === "edit",
    },
    on: {
      input: (ev) => {
        form.domain = (ev.currentTarget as HTMLInputElement).value;
        revalidate();
        refreshDnsHelp();
      },
    },
  });

  const pathInput = el("input", {
    attrs: {
      type: "text",
      placeholder: "www",
      "aria-label": "Dossier servi",
      spellcheck: "false",
      value: form.path,
    },
    on: {
      input: (ev) => {
        form.path = (ev.currentTarget as HTMLInputElement).value;
        revalidate();
      },
    },
  });

  const runtimeSelect = el(
    "select",
    {
      class: "input",
      attrs: { "aria-label": "Configuration d'exécution" },
      on: {
        change: (ev) => {
          form.runtimeId = Number((ev.currentTarget as HTMLSelectElement).value);
        },
      },
    },
    bundle.runtimes.map((r) =>
      el("option", {
        text: `${runtimeName(r)} · ${runtimeLabel(r.type)}${
          isDeprecatedEngine(r.type, service) ? " (plus maintenu)" : ""
        }`,
        attrs: { value: String(r.id), selected: r.id === form.runtimeId },
      }),
    ),
  );

  const locationSelect = el(
    "select",
    {
      class: "input",
      attrs: { "aria-label": "Localisation de l'IP" },
      on: {
        change: (ev) => {
          form.ipLocation = (ev.currentTarget as HTMLSelectElement).value;
          refreshDnsHelp();
        },
      },
    },
    locationOptions(service, [form.ipLocation]).map((code) => {
      const { ip } = ipsForLocation(service, code);
      return el("option", {
        text: `${ipCountryLabel(code)}${ip ? ` · ${ip}` : ""}`,
        attrs: { value: code, selected: code === form.ipLocation },
      });
    }),
  );

  const ownLogInput = el("input", {
    class: "input mono",
    attrs: {
      type: "text",
      placeholder: "Facultatif · domaine qui regroupe les logs",
      "aria-label": "Domaine des logs",
      spellcheck: "false",
      value: form.ownLog,
    },
    on: {
      input: (ev) => {
        form.ownLog = (ev.currentTarget as HTMLInputElement).value;
        revalidate();
      },
    },
  });

  const options: {
    key: "ssl" | "firewall" | "cdn";
    label: string;
    note: string;
    disabled: boolean;
  }[] = [
    { key: "ssl", label: "SSL", note: "Ajouté au certificat", disabled: false },
    {
      key: "firewall",
      label: "Pare-feu",
      note: "Filtrage applicatif",
      disabled: false,
    },
    {
      key: "cdn",
      label: "CDN",
      // `hasCdn` décide : proposer le CDN sans l'offre reviendrait à proposer une
      // action que l'API refusera.
      note: service.hasCdn === true ? "Inclus dans l'offre" : "Non inclus dans l'offre",
      disabled: service.hasCdn !== true,
    },
  ];

  const dnsHelp = el("span", { class: "form-help" });
  function refreshDnsHelp(): void {
    dnsHelp.textContent = dnsHelpText(ctx, form);
  }
  refreshDnsHelp();

  const bypassBox = el("input", {
    attrs: { type: "checkbox", checked: form.bypass },
    on: {
      change: (ev) => {
        form.bypass = (ev.currentTarget as HTMLInputElement).checked;
        refreshDnsHelp();
      },
    },
  });

  revalidate();

  return el("div", { class: "form-body" }, [
    el("div", { class: "form-grid" }, [
      ...field("Domaine", domainInput),
      ...field(
        "Dossier servi",
        el("div", { class: "prefixed-input" }, [
          el("span", { text: `${service.home}/` }),
          pathInput,
        ]),
      ),
      ...field("Exécution", runtimeSelect),
      ...field("Localisation de l'IP", locationSelect),
      ...field("Logs séparés", ownLogInput),
      ...field(
        "Options",
        el(
          "div",
          { class: "form-opts" },
          options.map((o) =>
            el("div", { class: "form-opt" }, [
              switchButton({
                on: form[o.key] && !o.disabled,
                ariaLabel: o.label,
                disabled: o.disabled,
                title: o.disabled ? o.note : undefined,
                onToggle: () => {
                  form[o.key] = !form[o.key];
                  ctx.rerender();
                },
              }),
              el("div", { class: "form-opt-text" }, [
                el("span", { text: o.label }),
                el("span", { class: "section-note", text: o.note }),
              ]),
            ]),
          ),
        ),
      ),
      ...field(
        "Zone DNS",
        el("div", { class: "form-dns" }, [
          el("label", { class: "checkbox-line" }, [
            bypassBox,
            "Ne pas modifier la zone DNS",
          ]),
          dnsHelp,
        ]),
      ),
    ]),
    errorBox,
    el("div", { class: "form-actions" }, [
      reviewBtn,
      button("Annuler", {
        class: "btn btn-secondary",
        onClick: () => {
          state.site = null;
          ctx.rerender();
        },
      }),
    ]),
  ]);
}

/**
 * Ce que la case « ne pas modifier la zone DNS » change, dit avant de la cocher.
 *
 * Le défaut de l'API est `false` : l'écriture a lieu. C'est contre-intuitif, et
 * c'est précisément pour ça que la phrase est là.
 */
function dnsHelpText(ctx: HostingContext, form: SiteForm): string {
  const domain = cleanDomain(form.domain);
  if (form.bypass) {
    return "Vous créerez vous-même les enregistrements A et AAAA, où que soit géré le DNS.";
  }
  const split = domain ? splitZone(domain, ctx.zones) : null;
  if (split) {
    const sub = split.subDomain ?? "@";
    return `L'API écrira dans la zone ${split.zone} de ce compte : les enregistrements A, AAAA ou CNAME de ${sub} seront remplacés.`;
  }
  if (domain && siteFormError(form, ctx.bundle) === "") {
    return `${domain} n'est pas une zone de ce compte. Cochez cette case : l'API ne pourra pas configurer son DNS.`;
  }
  return "Sans cette case, l'API modifie elle-même la zone DNS du domaine.";
}

// ---------------------------------------------------------------------------
// Étape de confirmation et aperçu DNS
// ---------------------------------------------------------------------------

/**
 * Passe à l'aperçu, et charge la zone concernée.
 *
 * La lecture n'a lieu qu'ici : pendant la frappe, le domaine est incomplet et
 * une lecture par caractère n'apprendrait rien.
 */
async function review(ctx: HostingContext, form: SiteForm): Promise<void> {
  if (!siteFormComplete(form, ctx.bundle)) return;
  form.step = "confirm";
  form.dns = null;
  form.dnsLoading = true;
  ctx.rerender();

  const split = splitZone(cleanDomain(form.domain), ctx.zones);
  if (!split) {
    form.dns = { zone: null, subDomain: null, existing: [], error: null };
    form.dnsLoading = false;
    ctx.rerender();
    return;
  }

  try {
    const records = await loadZoneAddresses(split.zone);
    form.dns = {
      zone: split.zone,
      subDomain: split.subDomain,
      existing: recordsFor(records, split.subDomain),
      error: null,
    };
  } catch (e) {
    // Sans la lecture, on ne peut pas montrer le avant/après. On le dit, et on
    // laisse l'utilisateur décider — on ne prétend pas qu'il n'y a rien.
    form.dns = {
      zone: split.zone,
      subDomain: split.subDomain,
      existing: [],
      error: describeFailure(e).message,
    };
  }
  form.dnsLoading = false;
  ctx.rerender();
}

type DnsLine = {
  sign: "" | "+" | "−";
  sub: string;
  type: string;
  target: string;
  tone: "keep" | "add" | "remove";
  copiable: boolean;
};

function dnsLines(ctx: HostingContext, form: SiteForm, mode: DnsMode): DnsLine[] {
  const wanted = wantedRecords(ctx.bundle.service, form.ipLocation);
  const sub = form.dns?.subDomain ?? cleanDomain(form.domain);
  const label = form.dns ? (form.dns.subDomain ?? "@") : sub;

  if (mode === "manual") {
    return wanted.map((w) => ({
      sign: "" as const,
      sub: label,
      type: w.fieldType,
      target: w.target,
      tone: "keep" as const,
      copiable: true,
    }));
  }
  if (mode !== "write" || !form.dns) return [];

  const existing = form.dns.existing;
  const out: DnsLine[] = existing.map((r) => {
    const kept = wanted.some((w) => w.fieldType === r.fieldType && w.target === r.target);
    return {
      sign: kept ? ("" as const) : ("−" as const),
      sub: label,
      type: r.fieldType,
      target: r.target,
      tone: kept ? ("keep" as const) : ("remove" as const),
      copiable: false,
    };
  });
  for (const w of wanted) {
    if (existing.some((r) => r.fieldType === w.fieldType && r.target === w.target)) {
      continue;
    }
    out.push({
      sign: "+",
      sub: label,
      type: w.fieldType,
      target: w.target,
      tone: "add",
      copiable: false,
    });
  }
  return out;
}

type DnsHeading = { icon: IconName; tone: string; title: string; text: string };

function dnsHeading(form: SiteForm, mode: DnsMode): DnsHeading {
  const domain = cleanDomain(form.domain);
  switch (mode) {
    case "none":
      return {
        icon: "check-circle",
        tone: "neutral",
        title: "La zone DNS n'est pas modifiée",
        text: "",
      };
    case "manual":
      return {
        icon: "hand-pointing",
        tone: "neutral",
        title: "Aucune écriture dans la zone DNS",
        text: "Pour que le site réponde, le domaine doit pointer vers ces adresses, là où son DNS est géré :",
      };
    case "blocked":
      return {
        icon: "prohibit",
        tone: "danger",
        title: `Le DNS de ${domain} n'est pas géré dans ce compte`,
        text: "L'API ne peut pas écrire dans cette zone. Revenez en arrière et cochez « Ne pas modifier la zone DNS ».",
      };
    default:
      return {
        icon: "warning",
        tone: "accent",
        title: `La zone ${form.dns?.zone ?? ""} sera modifiée`,
        text: "Ces changements apparaîtront dans Domaines › Zone DNS, avec une opération dans son journal.",
      };
  }
}

function renderConfirmStep(ctx: HostingContext, form: SiteForm): HTMLElement {
  const { bundle, state } = ctx;
  const service = bundle.service;
  const mode = dnsModeOf(form);
  const runtime = runtimeOf(bundle, form.runtimeId);
  const { ip } = ipsForLocation(service, form.ipLocation);
  const busy = state.busy.has("site:apply");

  const summary: [string, string][] = [
    ["Domaine", cleanDomain(form.domain)],
    ["Dossier servi", `${service.home}/${cleanPath(form.path)}`],
    [
      "Exécution",
      runtime ? `${runtimeName(runtime)} · ${runtimeLabel(runtime.type)}` : "—",
    ],
    [
      "Options",
      [
        form.ssl && "SSL",
        form.firewall && "pare-feu",
        form.cdn && service.hasCdn === true && "CDN",
      ]
        .filter(Boolean)
        .join(", ") || "Aucune",
    ],
    [
      "Localisation IP",
      `${ipCountryLabel(form.ipLocation)}${ip ? ` · ${ip}` : ""}`,
    ],
    ["Logs", form.ownLog.trim() || "Avec ceux de l'hébergement"],
  ];

  // Tant que la zone n'est pas lue, `dnsModeOf` conclurait « pas dans ce compte »
  // faute de réponse : on ne conclut rien, on dit qu'on lit.
  const heading = form.dnsLoading
    ? {
        icon: "circle-notch" as const,
        tone: "neutral",
        title: "Lecture de la zone DNS…",
        text: "",
      }
    : dnsHeading(form, mode);
  const lines = form.dnsLoading ? [] : dnsLines(ctx, form, mode);

  return el("div", { class: "form-body" }, [
    el(
      "div",
      { class: "form-summary" },
      summary.flatMap(([k, v]) => [
        el("span", { class: "form-key", text: k }),
        el("span", { text: v }),
      ]),
    ),
    el("div", { class: `dns-preview is-${heading.tone}` }, [
      el("div", { class: "dns-preview-head" }, [
        form.dnsLoading ? spinner(16) : icon(heading.icon, { size: 16 }),
        el("span", { text: heading.title }),
      ]),
      !form.dnsLoading && heading.text
        ? el("div", { class: "dns-preview-text", text: heading.text })
        : null,
      form.dns?.error
        ? el("div", {
            class: "form-error",
            text: `La zone n'a pas pu être lue : ${form.dns.error}. L'API écrira quand même si vous continuez.`,
          })
        : null,
      ...lines.map((line) =>
        el("div", { class: `dns-line is-${line.tone}` }, [
          el("span", { class: "sign", text: line.sign }),
          el("span", { class: "sub", text: line.sub }),
          el("span", { class: "type", text: line.type }),
          el("span", { class: "target", text: line.target }),
          line.copiable ? copyButton(line.target, "Adresse", { size: 14 }) : null,
        ]),
      ),
    ]),
    el("div", { class: "form-actions" }, [
      button(
        busy
          ? "Envoi…"
          : form.mode === "new"
            ? "Ajouter le multisite"
            : "Enregistrer",
        {
          class: "btn btn-primary",
          // `blocked` : l'appel échouerait. On ne propose pas une action refusée.
          disabled: busy || mode === "blocked" || form.dnsLoading,
          icon: busy ? spinner(15) : undefined,
          onClick: () => void apply(ctx, form, mode),
        },
      ),
      button("Retour", {
        class: "btn btn-secondary",
        disabled: busy,
        onClick: () => {
          form.step = "edit";
          ctx.rerender();
        },
      }),
    ]),
  ]);
}

async function apply(
  ctx: HostingContext,
  form: SiteForm,
  mode: DnsMode,
): Promise<void> {
  const { bundle, state } = ctx;
  if (mode === "blocked") return;

  const payload: AttachedDomain = siteFormPayload(form, bundle.service);
  const domain = cleanDomain(form.domain);
  state.busy.add("site:apply");
  ctx.rerender();

  try {
    if (form.mode === "new") {
      await createAttachedDomain(bundle.serviceName, payload);
    } else if (form.original) {
      await updateAttachedDomain(bundle.serviceName, form.original, payload);
    }
    state.busy.delete("site:apply");
    state.site = null;
    toast(
      mode === "write"
        ? `Envoyé · la zone ${form.dns?.zone ?? ""} va être mise à jour par l'API`
        : form.mode === "new"
          ? `Ajout de ${domain} lancé. Suivi dans Opérations.`
          : `Modification de ${domain} lancée.`,
    );
    ctx.reload({ force: true });
    ctx.trackTasks();
  } catch (e) {
    state.busy.delete("site:apply");
    toastError(hostingRefusalMessage(describeFailure(e).message));
    ctx.rerender();
  }
}

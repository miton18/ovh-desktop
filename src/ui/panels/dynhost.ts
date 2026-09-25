/**
 * DynHost — les identifiants qu'un routeur ou un NAS utilise pour pousser son IP.
 *
 * DynHost est un **second jeu d'enregistrements**, dans un espace séparé de
 * l'API : ses entrées n'apparaissent pas dans `records`. Elles sont montrées dans
 * le tableau de zone marquées « DynHost » et non modifiables, et gérées ici par
 * leurs identifiants.
 *
 * Le mot de passe commande la forme de ce panneau. L'API le prend à la création
 * (`dynhostLoginCreate`) et au remplacement (`dynhostLoginChangePassword`), mais
 * **ne le rend jamais** : il n'y a pas de « voir le mot de passe », seulement un
 * « en poser un nouveau ». L'interface est donc le dernier endroit où la valeur
 * existe, d'où le panneau de révélation — affiché une fois, avec de quoi copier
 * chaque élément et la commande complète qui s'en sert.
 *
 * Disponible seulement si `ZoneCapabilities.dynHost` le dit. Quand ce n'est pas
 * le cas, la section reste visible avec la raison : masquer sans expliquer
 * laisserait croire à un bug.
 */

import {
  changeDynHostPassword,
  createDynHostLogin,
  deleteDynHostLogin,
  describeFailure,
} from "../data";
import { button, el, frag } from "../dom";
import { icon } from "../icons";
import { toast, toastError } from "../toast";
import { copyButton } from "./copy";
import type { DomainContext } from "./context";
import {
  DYNHOST_PASSWORD_MIN,
  generatePassword,
  type DynHostReveal,
} from "./state";

/**
 * Le point d'entrée DynHost d'OVHcloud, celui que les clients dyndns des box et
 * des NAS attendent dans leur champ « serveur ». Ce n'est pas l'API publique :
 * c'est un service distinct, et il n'apparaît donc pas dans `ovh-api.ts`.
 */
const DYNHOST_SERVER = "dns.eu.ovhapis.com";

export function renderDynHostSection(ctx: DomainContext): HTMLElement {
  const { bundle } = ctx;
  const supported = bundle.zoneCapabilities?.dynHost === true;

  return el("section", { attrs: { "aria-label": "DynHost" } }, [
    el("div", { class: "section-head" }, [
      el("h2", { text: "DynHost", style: { fontSize: "16px" } }),
      el("span", {
        class: "section-note",
        text: "Identifiants qu'un routeur ou un NAS utilise pour mettre à jour son IP.",
      }),
    ]),
    supported
      ? frag(renderReveal(ctx), renderLogins(ctx))
      : renderUnsupported(bundle.zoneCapabilities === null),
  ]);
}

function renderUnsupported(unknown: boolean): HTMLElement {
  return el("div", { class: "unsupported" }, [
    icon("prohibit", { size: 16 }),
    unknown
      ? "Impossible de lire les capacités de la zone : DynHost ne peut pas être proposé sans savoir s'il est disponible."
      : "DynHost n'est pas proposé sur cette zone.",
  ]);
}

// ---------------------------------------------------------------------------
// Panneau de révélation
// ---------------------------------------------------------------------------

/**
 * L'hôte que ce login est autorisé à mettre à jour.
 *
 * Avec `*`, l'autorisation porte sur toute la zone : on ne peut pas nommer un
 * hôte à la place de l'utilisateur, on montre donc le gabarit à compléter.
 */
function revealHost(zone: string, subDomain: string): string {
  if (subDomain === "*") return `<sous-domaine>.${zone}`;
  return subDomain ? `${subDomain}.${zone}` : zone;
}

function revealField(key: string, value: string, what: string): HTMLElement {
  return el("div", { class: "reveal-field" }, [
    el("span", { class: "k", text: key }),
    el("span", { class: "v", text: value }),
    copyButton(value, what),
  ]);
}

function renderReveal(ctx: DomainContext): HTMLElement | null {
  const { bundle, state } = ctx;
  const reveal = state.dynReveal;
  if (!reveal) return null;

  const host = revealHost(bundle.name, reveal.subDomain);
  const curl = `curl -u '${reveal.login}:${reveal.password}' "https://${DYNHOST_SERVER}/nic/update?system=dyndns&hostname=${host}&myip=<IP>"`;

  return el("div", { class: "reveal", attrs: { role: "status" } }, [
    el("div", { class: "reveal-head" }, [
      icon("key", { size: 18 }),
      el("span", {
        class: "title",
        text: reveal.isNew
          ? `Identifiant ${reveal.login} créé`
          : `Nouveau mot de passe pour ${reveal.login}`,
      }),
      button("J'ai noté ces informations", {
        class: "btn btn-secondary",
        onClick: () => {
          state.dynReveal = null;
          ctx.rerender();
        },
      }),
    ]),
    el("div", {
      class: "reveal-warn",
      text: "Le mot de passe n'est affiché qu'une fois. Il ne pourra pas être récupéré, seulement remplacé.",
    }),
    el("div", { class: "reveal-fields" }, [
      revealField("Serveur", DYNHOST_SERVER, "Serveur"),
      revealField("Nom d'hôte", host, "Nom d'hôte"),
      revealField("Identifiant", reveal.login, "Identifiant"),
      revealField("Mot de passe", reveal.password, "Mot de passe"),
    ]),
    el("div", { class: "reveal-curl" }, [
      el("span", {
        class: "hint",
        text: "Sans client intégré au routeur, une requête suffit :",
      }),
      el("div", { class: "box" }, [
        el("code", { text: curl }),
        copyButton(curl, "Commande"),
      ]),
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// Liste des identifiants
// ---------------------------------------------------------------------------

/**
 * Ce qu'on peut dire honnêtement de l'âge d'un mot de passe.
 *
 * L'API n'expose aucune date de dernier changement. On n'affiche donc une heure
 * que pour les identifiants dont le mot de passe a été posé dans cette session —
 * la seule information qu'on possède réellement.
 */
function passwordNote(ctx: DomainContext, login: string): string {
  const at = ctx.state.dynPasswordSetAt.get(login);
  return at ? `Mot de passe défini à ${at}` : "Mot de passe non relisible";
}

function markPasswordSet(ctx: DomainContext, login: string): void {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  ctx.state.dynPasswordSetAt.set(login, `${hh}:${mm}`);
}

function renderLogins(ctx: DomainContext): HTMLElement {
  const { bundle } = ctx;

  return el("div", { class: "stack" }, [
    ...bundle.dynHostLogins.map((login) => renderLoginRow(ctx, login)),
    renderCreateForm(ctx),
  ]);
}

function renderLoginRow(
  ctx: DomainContext,
  login: { login: string; subDomain: string },
): HTMLElement {
  const { state } = ctx;
  const zone = ctx.bundle.name;
  const open = state.dynPassword?.login === login.login;
  const busy = state.busy.has(`dyn:${login.login}`);

  return el("div", { class: busy ? "dyn-row is-pending" : "dyn-row" }, [
    el("div", { class: "dyn-row-main" }, [
      el("span", { class: "dyn-login", text: login.login }),
      el("span", { class: "section-note", text: "Sous-domaine autorisé" }),
      el("span", { class: "dyn-sub", text: login.subDomain }),
      el("span", { class: "section-note", text: passwordNote(ctx, login.login) }),
      el("div", { class: "dyn-row-actions" }, [
        button("Nouveau mot de passe", {
          class: "btn btn-ghost",
          icon: icon("key", { size: 15 }),
          disabled: busy,
          onClick: () => {
            state.dynPassword = { login: login.login, value: "" };
            ctx.rerender();
            document
              .querySelector<HTMLInputElement>(".dyn-pw-form .input")
              ?.focus();
          },
        }),
        button("", {
          class: "btn btn-ghost btn-icon",
          icon: icon("trash"),
          title: "Supprimer l'identifiant",
          ariaLabel: `Supprimer l'identifiant ${login.login}`,
          disabled: busy,
          onClick: () => {
            state.busy.add(`dyn:${login.login}`);
            ctx.rerender();
            void deleteDynHostLogin(zone, login.login)
              .then(() => {
                state.busy.delete(`dyn:${login.login}`);
                state.dynPasswordSetAt.delete(login.login);
                // Le panneau de révélation d'un identifiant supprimé ne veut
                // plus rien dire : il part avec lui.
                if (state.dynReveal?.login === login.login) state.dynReveal = null;
                if (state.dynPassword?.login === login.login) state.dynPassword = null;
                toast(`${login.login} supprimé`);
                ctx.reload({ force: true });
              })
              .catch((e) => {
                state.busy.delete(`dyn:${login.login}`);
                toastError(describeFailure(e).message);
                ctx.rerender();
              });
          },
        }),
      ]),
    ]),
    open ? renderPasswordForm(ctx, login) : null,
  ]);
}

function renderPasswordForm(
  ctx: DomainContext,
  login: { login: string; subDomain: string },
): HTMLElement {
  const { state } = ctx;
  const zone = ctx.bundle.name;

  const input = el("input", {
    class: "input",
    attrs: {
      type: "text",
      placeholder: `${DYNHOST_PASSWORD_MIN} caractères minimum`,
      "aria-label": `Nouveau mot de passe pour ${login.login}`,
      autocomplete: "off",
      spellcheck: "false",
      value: state.dynPassword?.value ?? "",
    },
    on: {
      input: (ev) => {
        if (state.dynPassword) {
          state.dynPassword.value = (ev.currentTarget as HTMLInputElement).value;
        }
        revalidate();
      },
      keydown: (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          void save();
        } else if (ev.key === "Escape") {
          ev.preventDefault();
          cancel();
        }
      },
    },
  });

  const saveBtn = button("Remplacer", {
    class: "btn btn-primary",
    onClick: () => void save(),
  });

  function value(): string {
    return state.dynPassword?.value ?? "";
  }

  function revalidate(): void {
    saveBtn.disabled = value().length < DYNHOST_PASSWORD_MIN;
  }

  function cancel(): void {
    state.dynPassword = null;
    ctx.rerender();
  }

  async function save(): Promise<void> {
    const password = value();
    if (password.length < DYNHOST_PASSWORD_MIN) return;
    saveBtn.disabled = true;
    try {
      await changeDynHostPassword(zone, login.login, password);
      state.dynPassword = null;
      markPasswordSet(ctx, login.login);
      // Le panneau de révélation prend la place du message de succès : c'est la
      // seule fois où ce mot de passe sera lisible.
      state.dynReveal = {
        login: login.login,
        subDomain: login.subDomain,
        password,
        isNew: false,
      } satisfies DynHostReveal;
      ctx.reload({ force: true });
    } catch (e) {
      toastError(describeFailure(e).message);
      revalidate();
    }
  }

  revalidate();

  return el("div", { class: "dyn-pw-form" }, [
    input,
    button("Générer", {
      class: "btn btn-ghost",
      icon: icon("shuffle", { size: 15 }),
      onClick: () => {
        if (!state.dynPassword) return;
        state.dynPassword.value = generatePassword();
        ctx.rerender();
      },
    }),
    saveBtn,
    button("Annuler", { class: "btn btn-secondary", onClick: cancel }),
    el("span", {
      class: "section-note",
      text: "L'ancien mot de passe cesse de fonctionner immédiatement.",
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Création d'un identifiant
// ---------------------------------------------------------------------------

function renderCreateForm(ctx: DomainContext): HTMLElement {
  const { bundle, state } = ctx;
  const zone = bundle.name;

  const suffixInput = el("input", {
    attrs: {
      type: "text",
      placeholder: "suffixe",
      "aria-label": "Suffixe du login DynHost",
      spellcheck: "false",
      value: state.dyn.suffix,
    },
    on: {
      input: (ev) => {
        state.dyn.suffix = (ev.currentTarget as HTMLInputElement).value;
        revalidate();
      },
    },
  });

  const subInput = el("input", {
    class: "input",
    attrs: {
      type: "text",
      placeholder: "Sous-domaine, ou *",
      "aria-label": "Sous-domaine autorisé",
      spellcheck: "false",
      style: "width:170px;font-family:var(--font-mono)",
      value: state.dyn.subDomain,
    },
    on: {
      input: (ev) => {
        state.dyn.subDomain = (ev.currentTarget as HTMLInputElement).value;
        revalidate();
      },
    },
  });

  // Le mot de passe est requis par `dynhostLoginCreate` : sans lui, l'identifiant
  // créé serait inutilisable. Il reste en clair parce qu'il faut le relire pour
  // le recopier ailleurs — il n'est de toute façon affiché qu'une fois.
  const passwordInput = el("input", {
    class: "input",
    attrs: {
      type: "text",
      placeholder: `Mot de passe (${DYNHOST_PASSWORD_MIN} car. min.)`,
      "aria-label": "Mot de passe du login DynHost",
      autocomplete: "off",
      spellcheck: "false",
      value: state.dyn.password,
    },
    on: {
      input: (ev) => {
        state.dyn.password = (ev.currentTarget as HTMLInputElement).value;
        revalidate();
      },
    },
  });

  const preview = el("span", { class: "mono" });
  const createBtn = button("Créer l'identifiant", {
    class: "btn btn-secondary",
    icon: icon("plus"),
    onClick: () => void create(),
  });
  const errorBox = el("div", { class: "rec-error", attrs: { hidden: true } });

  function suffix(): string {
    return state.dyn.suffix.trim().toLowerCase();
  }

  function errorMessage(): string {
    const s = suffix();
    if (!s) return "";
    if (!/^[a-z0-9-]+$/.test(s)) {
      return "Le suffixe n'accepte que des lettres, des chiffres et des tirets.";
    }
    if (bundle.dynHostLogins.some((l) => l.login === `${zone}-${s}`)) {
      return "Cet identifiant existe déjà.";
    }
    if (state.dyn.password && state.dyn.password.length < DYNHOST_PASSWORD_MIN) {
      return `Le mot de passe doit faire au moins ${DYNHOST_PASSWORD_MIN} caractères.`;
    }
    return "";
  }

  function revalidate(): void {
    const s = suffix();
    preview.textContent = `${zone}-${s || "…"}`;
    const err = errorMessage();
    errorBox.textContent = err;
    errorBox.hidden = err === "";
    createBtn.disabled =
      !s ||
      !!err ||
      state.dyn.password.length < DYNHOST_PASSWORD_MIN ||
      !state.dyn.subDomain.trim();
  }

  async function create(): Promise<void> {
    const s = suffix();
    if (!s || errorMessage()) return;
    createBtn.disabled = true;
    const password = state.dyn.password;
    const subDomain = state.dyn.subDomain.trim() || "*";
    try {
      const created = await createDynHostLogin(zone, {
        loginSuffix: s,
        password,
        subDomain,
      });
      state.dyn = { suffix: "", subDomain: "", password: "" };
      markPasswordSet(ctx, created.login);
      state.dynReveal = {
        login: created.login,
        subDomain: created.subDomain || subDomain,
        password,
        isNew: true,
      } satisfies DynHostReveal;
      ctx.reload({ force: true });
    } catch (e) {
      toastError(describeFailure(e).message);
      revalidate();
    }
  }

  revalidate();

  return el("div", { class: "stack-form" }, [
    el("div", { class: "stack-form-row" }, [
      el("div", { class: "prefixed-input" }, [
        el("span", { text: `${zone}-` }),
        suffixInput,
      ]),
      subInput,
      el("div", { class: "dyn-pass-field" }, [
        passwordInput,
        button("", {
          class: "btn btn-ghost btn-icon",
          icon: icon("shuffle"),
          title: "Générer un mot de passe",
          ariaLabel: "Générer un mot de passe",
          onClick: () => {
            state.dyn.password = generatePassword();
            ctx.rerender();
          },
        }),
      ]),
      createBtn,
    ]),
    errorBox,
    el("div", { class: "dyn-preview" }, [
      "Identifiant complet : ",
      preview,
      " · le nom du domaine est ajouté automatiquement devant le suffixe. C'est avec cet identifiant et le mot de passe que l'appareil qui met à jour l'IP (box, NAS, script) s'authentifie.",
    ]),
  ]);
}

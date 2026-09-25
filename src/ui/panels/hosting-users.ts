/**
 * Onglet « FTP & SSH » — les comptes qui accèdent aux fichiers.
 *
 * Deux réglages qu'il ne faut surtout pas fusionner : `state` (`rw`/`off`) dit si
 * le compte est ouvert, `sshState` (`active`/`sftponly`/`none`) dit à quoi il a
 * droit. Un seul interrupteur pour les deux ferait croire qu'un compte fermé
 * garde son SFTP, ou qu'ouvrir un compte lui donne un shell.
 *
 * Le mot de passe, lui, ne figure **nulle part** dans le modèle : il se pose à la
 * création, il se remplace, il ne se relit jamais. Même traitement que DynHost —
 * un panneau de révélation affiché une fois, tout copiable, aucun champ
 * pré-rempli qui laisserait croire qu'on peut relire.
 */

import type { HostingUser } from "../../ovh-api";
import {
  changeHostingUserPassword,
  createHostingUser,
  deleteHostingUser,
  describeFailure,
  updateHostingUser,
} from "../data";
import { button, el, frag, switchButton } from "../dom";
import { icon } from "../icons";
import { KNOWN_SSH_STATES } from "../../ovh-api";
import { formatCapacity, hostingRefusalMessage, sshStatePresentation } from "../labels";
import { toast, toastError } from "../toast";
import { copyButton } from "./copy";
import type { HostingContext } from "./hosting-context";
import {
  canAdd,
  extraUserCount,
  FTP_PASSWORD_HINT,
  FTP_PASSWORD_RULE,
  ftpHost,
  generateFtpPassword,
  isValidFtpPassword,
  pendingTaskFor,
  shellAvailable,
  sshHost,
  userFormError,
  type HostingReveal,
} from "./hosting-state";

export function renderUsersTab(ctx: HostingContext): HTMLElement {
  const { bundle, state } = ctx;
  // `extraUsers` compte les comptes **en plus** du principal : il vaut zéro sur
  // la plupart des offres, et le compte principal existe quand même.
  const extras = extraUserCount(bundle);
  const add = canAdd(bundle.capabilities, "extraUsers", extras);

  return el("section", { attrs: { "aria-label": "Utilisateurs FTP et SSH" } }, [
    el("div", { class: "host-bar" }, [
      el("span", {
        class: "section-note",
        text: add.limit === 0
          ? "Compte principal seul : cette offre n'autorise aucun compte supplémentaire."
          : `${formatCapacity(extras, add.limit)} ${extras > 1 ? "comptes supplémentaires" : "compte supplémentaire"}, en plus du compte principal`,
      }),
      el("div", { class: "spacer" }),
      add.allowed ? null : el("span", { class: "section-note", text: add.reason }),
      button("Créer un utilisateur", {
        class: "btn btn-primary",
        icon: icon("plus"),
        disabled: state.userForm.open || !add.allowed,
        title: add.allowed ? undefined : add.reason,
        onClick: () => {
          state.userForm.open = true;
          ctx.rerender();
          document.querySelector<HTMLInputElement>(".user-create input")?.focus();
        },
      }),
    ]),
    state.userForm.open ? renderCreateForm(ctx) : null,
    renderReveal(ctx),
    el("div", { class: "stack-rows" }, [
      ...ctx.bundle.users.map((u) => renderUserRow(ctx, u)),
      ctx.bundle.users.length === 0
        ? el("div", { class: "placeholder", text: "Aucun utilisateur FTP." })
        : null,
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// Panneau de révélation
// ---------------------------------------------------------------------------

/**
 * Tout ce qu'il faut pour se connecter, une seule fois.
 *
 * Le serveur et le port viennent de `serviceManagementCredentials` quand l'API
 * les donne, et se déduisent du cluster sinon : personne ne devrait avoir à
 * chercher l'hôte FTP ailleurs au moment où il note le mot de passe.
 */
function revealFor(
  ctx: HostingContext,
  user: HostingUser,
  password: string,
  title: string,
): HostingReveal {
  const service = ctx.bundle.service;
  const ftp = user.serviceManagementCredentials.ftp;
  const ssh = user.serviceManagementCredentials.ssh;
  const ftpAddress = ftp.url ?? ftpHost(service);
  const sshAddress = ssh.url ?? sshHost(service);

  const rows: { k: string; v: string; copy: string }[] = [
    {
      k: "Serveur FTP",
      v: `${ftpAddress}${ftp.port ? ` · port ${ftp.port}` : ""}`,
      copy: ftpAddress,
    },
  ];
  if (shellAvailable(ctx.bundle) && user.sshState !== "none") {
    rows.push({
      k: "Serveur SSH",
      v: `${sshAddress}${ssh.port ? ` · port ${ssh.port}` : ""}`,
      copy: sshAddress,
    });
  }
  rows.push({ k: "Identifiant", v: user.login, copy: user.login });
  rows.push({ k: "Mot de passe", v: password, copy: password });

  return { title, rows };
}

function renderReveal(ctx: HostingContext): HTMLElement | null {
  const reveal = ctx.state.reveal;
  if (!reveal) return null;

  return el("div", { class: "reveal", attrs: { role: "status" } }, [
    el("div", { class: "reveal-head" }, [
      icon("key", { size: 18 }),
      el("span", { class: "title", text: reveal.title }),
      button("J'ai noté ces informations", {
        class: "btn btn-secondary",
        onClick: () => {
          ctx.state.reveal = null;
          ctx.rerender();
        },
      }),
    ]),
    el("div", {
      class: "reveal-warn",
      text: "Le mot de passe n'est affiché qu'une fois. L'API ne le renvoie jamais : il pourra seulement être remplacé.",
    }),
    el(
      "div",
      { class: "reveal-fields" },
      reveal.rows.map((row) =>
        el("div", { class: "reveal-field" }, [
          el("span", { class: "k", text: row.k }),
          el("span", { class: "v", text: row.v }),
          copyButton(row.copy, row.k),
        ]),
      ),
    ),
  ]);
}

/** L'heure d'un changement de mot de passe, quand on la connaît vraiment. */
function markPasswordSet(ctx: HostingContext, login: string): void {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  ctx.state.passwordSetAt.set(login, `${hh}:${mm}`);
}

function passwordNote(ctx: HostingContext, login: string): string {
  const at = ctx.state.passwordSetAt.get(login);
  return at ? `mot de passe défini à ${at}` : "mot de passe non relisible";
}

// ---------------------------------------------------------------------------
// Une ligne d'utilisateur
// ---------------------------------------------------------------------------

function renderUserRow(ctx: HostingContext, user: HostingUser): HTMLElement {
  const { bundle, state } = ctx;
  const pending = pendingTaskFor(bundle, user.login);
  const busyKey = `user:${user.login}`;
  const busy = state.busy.has(busyKey) || pending !== null;
  const open = state.userPassword?.login === user.login;
  const shellUsable = shellAvailable(bundle);

  /** Une écriture d'utilisateur prend l'objet entier : on renvoie le reste tel quel. */
  function write(patch: Partial<HostingUser>, message: string): void {
    state.busy.add(busyKey);
    ctx.rerender();
    void updateHostingUser(bundle.serviceName, { ...user, ...patch })
      .then(() => {
        state.busy.delete(busyKey);
        toast(message);
        ctx.reload({ force: true });
        ctx.trackTasks();
      })
      .catch((e) => {
        state.busy.delete(busyKey);
        toastError(hostingRefusalMessage(describeFailure(e).message));
        ctx.rerender();
      });
  }

  const accountOn = user.state === "rw";

  return el("div", { class: pending ? "user-row is-pending" : "user-row" }, [
    el("div", { class: "user-row-main" }, [
      el("div", { class: "user-identity" }, [
        el("div", { class: "user-login-line" }, [
          el("span", { class: "mono", text: user.login }),
          user.isPrimaryAccount
            ? el("span", { class: "tag tag-neutral", text: "Principal" })
            : null,
        ]),
        el("span", { class: "section-note" }, [
          "Dossier ",
          el("span", { class: "mono", text: user.home }),
          ` · ${passwordNote(ctx, user.login)}`,
        ]),
      ]),

      el("div", { class: "user-toggle" }, [
        el("span", { class: "section-note", text: "Compte" }),
        switchButton({
          on: accountOn,
          ariaLabel: `Compte ${user.login} actif`,
          busy,
          title: accountOn
            ? "Fermer le compte : plus aucun accès, FTP compris."
            : "Ouvrir le compte en lecture-écriture.",
          onToggle: () =>
            write(
              { state: accountOn ? "off" : "rw" },
              accountOn ? "Fermeture du compte demandée" : "Ouverture du compte demandée",
            ),
        }),
        el("span", {
          class: "user-toggle-label",
          text: accountOn ? "Ouvert" : "Fermé",
        }),
      ]),

      el("div", { class: "user-toggle" }, [
        el("span", { class: "section-note", text: "Shell" }),
        el(
          "div",
          {
            class: shellUsable ? "seg" : "seg is-disabled",
            attrs: { role: "group", "aria-label": `Accès SSH de ${user.login}` },
          },
          KNOWN_SSH_STATES.map((value) => {
            const p = sshStatePresentation(value);
            return el("button", {
              class: "seg-opt",
              text: p.label,
              attrs: {
                type: "button",
                "aria-pressed": user.sshState === value,
                title: shellUsable
                  ? p.note
                  : "Cette offre ne comprend pas d'accès SSH : les comptes restent limités au FTP.",
                disabled: busy || !shellUsable || user.sshState === value ? true : null,
              },
              on: {
                click: () =>
                  write({ sshState: value }, `Accès ${p.label} demandé pour ${user.login}`),
              },
            });
          }),
        ),
      ]),

      el("div", { class: "user-actions" }, [
        pending
          ? el("span", { class: "section-note", text: pending.label })
          : frag(
              button("Nouveau mot de passe", {
                class: "btn btn-ghost",
                icon: icon("key", { size: 15 }),
                disabled: busy,
                onClick: () => {
                  state.userPassword = { login: user.login, value: "" };
                  ctx.rerender();
                  document.querySelector<HTMLInputElement>(".user-pw-form input")?.focus();
                },
              }),
              button("", {
                class: "btn btn-ghost btn-icon",
                icon: icon("trash"),
                title: user.isPrimaryAccount
                  ? "Le compte principal ne se supprime pas"
                  : `Supprimer ${user.login}`,
                ariaLabel: `Supprimer ${user.login}`,
                disabled: busy || user.isPrimaryAccount,
                onClick: () => {
                  state.busy.add(busyKey);
                  ctx.rerender();
                  void deleteHostingUser(bundle.serviceName, user.login)
                    .then(() => {
                      state.busy.delete(busyKey);
                      state.passwordSetAt.delete(user.login);
                      if (state.userPassword?.login === user.login) {
                        state.userPassword = null;
                      }
                      toast(`Suppression de ${user.login} lancée`);
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
            ),
      ]),
    ]),
    open ? renderPasswordForm(ctx, user) : null,
  ]);
}

function renderPasswordForm(ctx: HostingContext, user: HostingUser): HTMLElement {
  const { bundle, state } = ctx;

  const input = el("input", {
    class: "input mono",
    attrs: {
      type: "text",
      placeholder: FTP_PASSWORD_HINT,
      "aria-label": `Nouveau mot de passe pour ${user.login}`,
      autocomplete: "off",
      spellcheck: "false",
      value: state.userPassword?.value ?? "",
    },
    on: {
      input: (ev) => {
        if (state.userPassword) {
          state.userPassword.value = (ev.currentTarget as HTMLInputElement).value;
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
    return state.userPassword?.value ?? "";
  }

  function revalidate(): void {
    saveBtn.disabled = !isValidFtpPassword(value());
  }

  function cancel(): void {
    state.userPassword = null;
    ctx.rerender();
  }

  async function save(): Promise<void> {
    const password = value();
    if (!isValidFtpPassword(password)) return;
    saveBtn.disabled = true;
    try {
      await changeHostingUserPassword(bundle.serviceName, user.login, password);
      state.userPassword = null;
      markPasswordSet(ctx, user.login);
      // Le panneau de révélation prend la place du message de succès : c'est la
      // seule fois où ce mot de passe sera lisible.
      state.reveal = revealFor(
        ctx,
        user,
        password,
        `Nouveau mot de passe pour ${user.login}`,
      );
      ctx.reload({ force: true });
      ctx.trackTasks();
    } catch (e) {
      toastError(hostingRefusalMessage(describeFailure(e).message));
      revalidate();
    }
  }

  revalidate();

  return el("div", { class: "user-pw-form" }, [
    input,
    button("Générer", {
      class: "btn btn-ghost",
      icon: icon("shuffle", { size: 15 }),
      onClick: () => {
        if (!state.userPassword) return;
        state.userPassword.value = generateFtpPassword();
        ctx.rerender();
        document.querySelector<HTMLInputElement>(".user-pw-form input")?.focus();
      },
    }),
    saveBtn,
    button("Annuler", { class: "btn btn-secondary", onClick: cancel }),
    el("span", { class: "section-note", text: FTP_PASSWORD_RULE }),
  ]);
}

// ---------------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------------

function renderCreateForm(ctx: HostingContext): HTMLElement {
  const { bundle, state } = ctx;
  const service = bundle.service;
  const form = state.userForm;
  const shellUsable = shellAvailable(bundle);

  const errorBox = el("div", { class: "form-error", attrs: { hidden: true } });
  const createBtn = button("Créer l'utilisateur", {
    class: "btn btn-primary",
    icon: icon("plus"),
    onClick: () => void create(),
  });

  function login(): string {
    return `${service.primaryLogin}-${form.suffix.trim().toLowerCase()}`;
  }

  function revalidate(): void {
    const err = userFormError(form, bundle);
    errorBox.textContent = err;
    errorBox.hidden = err === "";
    createBtn.disabled =
      form.suffix.trim() === "" || form.password === "" || err !== "";
  }

  const suffixInput = el("input", {
    attrs: {
      type: "text",
      placeholder: "suffixe",
      "aria-label": "Suffixe de l'identifiant",
      spellcheck: "false",
      value: form.suffix,
    },
    on: {
      input: (ev) => {
        form.suffix = (ev.currentTarget as HTMLInputElement).value;
        revalidate();
      },
    },
  });

  const homeInput = el("input", {
    class: "input mono",
    attrs: {
      type: "text",
      placeholder: "Dossier, / par défaut",
      "aria-label": "Dossier racine de l'utilisateur",
      spellcheck: "false",
      value: form.home,
    },
    on: {
      input: (ev) => {
        form.home = (ev.currentTarget as HTMLInputElement).value;
        revalidate();
      },
    },
  });

  const sshSelect = el(
    "select",
    {
      class: "input",
      attrs: {
        "aria-label": "Accès SSH",
        disabled: shellUsable ? null : true,
        title: shellUsable
          ? undefined
          : "Cette offre ne comprend pas d'accès SSH : les comptes restent limités au FTP.",
      },
      on: {
        change: (ev) => {
          form.sshState = (ev.currentTarget as HTMLSelectElement).value;
        },
      },
    },
    KNOWN_SSH_STATES.map((value) =>
      el("option", {
        text: sshStatePresentation(value).note,
        attrs: {
          value,
          selected: shellUsable ? value === form.sshState : value === "none",
        },
      }),
    ),
  );

  const passwordInput = el("input", {
    class: "input mono",
    attrs: {
      type: "text",
      placeholder: `Mot de passe · ${FTP_PASSWORD_HINT}`,
      "aria-label": "Mot de passe",
      autocomplete: "off",
      spellcheck: "false",
      value: form.password,
    },
    on: {
      input: (ev) => {
        form.password = (ev.currentTarget as HTMLInputElement).value;
        revalidate();
      },
    },
  });

  async function create(): Promise<void> {
    if (userFormError(form, bundle) !== "") return;
    const payload = {
      login: login(),
      password: form.password,
      home: form.home.trim() || "/",
      sshState: shellUsable ? form.sshState : "none",
      state: "rw",
    };
    createBtn.disabled = true;
    try {
      await createHostingUser(bundle.serviceName, payload);
      const password = payload.password;
      const created: HostingUser = {
        login: payload.login,
        home: payload.home,
        state: payload.state,
        sshState: payload.sshState,
        isPrimaryAccount: false,
        serviceManagementCredentials: {
          ftp: { url: null, port: null },
          ssh: { url: null, port: null },
        },
      };
      state.userForm = {
        open: false,
        suffix: "",
        home: "",
        sshState: "sftponly",
        password: "",
      };
      markPasswordSet(ctx, created.login);
      state.reveal = revealFor(ctx, created, password, `Utilisateur ${created.login} créé`);
      ctx.reload({ force: true });
      ctx.trackTasks();
    } catch (e) {
      toastError(hostingRefusalMessage(describeFailure(e).message));
      revalidate();
    }
  }

  revalidate();

  return el("div", { class: "user-create panel-accent" }, [
    el("div", { class: "user-create-row" }, [
      el("div", { class: "prefixed-input" }, [
        el("span", { text: `${service.primaryLogin}-` }),
        suffixInput,
      ]),
      homeInput,
      sshSelect,
      el("div", { class: "dyn-pass-field" }, [
        passwordInput,
        button("", {
          class: "btn btn-ghost btn-icon",
          icon: icon("shuffle"),
          title: "Générer un mot de passe",
          ariaLabel: "Générer un mot de passe",
          onClick: () => {
            form.password = generateFtpPassword();
            ctx.rerender();
          },
        }),
      ]),
      createBtn,
      button("Annuler", {
        class: "btn btn-secondary",
        onClick: () => {
          state.userForm.open = false;
          ctx.rerender();
        },
      }),
    ]),
    errorBox,
    el("div", {
      class: "section-note",
      text: shellUsable
        ? `Identifiant complet : ${login()}. Le compte FTP et l'accès shell sont deux réglages distincts : un compte fermé n'a plus aucun accès.`
        : "Cette offre ne comprend pas d'accès SSH : les comptes sont limités au FTP.",
    }),
  ]);
}

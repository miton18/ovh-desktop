/**
 * Gestion des comptes OVHcloud — menu **Comptes**.
 *
 * Un compte est la paire *racine + délégation* : un client OVHcloud a souvent
 * plusieurs NIC, et un NIC européen n'existe pas sur la racine canadienne. C'est
 * donc ici, et pas dans les réglages, qu'on choisit l'endpoint : au moment où
 * l'on crée le compte qui vivra dessus.
 *
 * Le menu applicatif liste déjà les comptes et permet d'en changer d'un clic.
 * Ce dialogue sert à ce qu'un menu fait mal : créer, renommer, supprimer, et
 * voir d'un coup d'œil lesquels restent à autoriser.
 */

import {
  accounts as api,
  auth,
  onMenuAction,
  type AccountInfo,
  type EndpointInfo,
} from "../ovh-api";
import { describeFailure } from "./data";
import { button, el } from "./dom";

export type AccountsHooks = {
  /**
   * Le compte actif ou la liste ont changé : l'appelant doit relire l'état et
   * réafficher l'écran qui convient.
   */
  onChanged: () => void;
};

let opener: ((focusAdd?: boolean) => void) | null = null;

/** Ouvre la gestion des comptes. Sans effet avant `installAccounts`. */
export function openAccounts(focusAdd = false): void {
  opener?.(focusAdd);
}

export function installAccounts(hooks: AccountsHooks): () => void {
  const overlay = el("div", { class: "settings-overlay" });
  document.body.appendChild(overlay);

  let open = false;
  let list: AccountInfo[] = [];
  let endpoints: EndpointInfo[] = [];
  let message: { text: string; tone: "error" | "info" } | null = null;
  let busy = false;
  let newEndpoint = "";
  let newLabel = "";
  let renaming: string | null = null;
  let unlisten: (() => void) | null = null;

  void onMenuAction((action) => {
    if (action === "account-add") show(true);
  }).then((un) => {
    unlisten = un;
  });

  async function show(focusAdd: boolean): Promise<void> {
    open = true;
    message = null;
    renaming = null;
    draw();
    await reload();
    if (endpoints.length === 0) {
      endpoints = await auth.endpoints().catch(() => []);
    }
    if (!newEndpoint) {
      // Par défaut, la racine du compte actif : on en ajoute rarement un sur
      // une autre que celle qu'on utilise déjà.
      newEndpoint = list.find((a) => a.active)?.endpoint.id ?? endpoints[0]?.id ?? "";
    }
    draw();
    if (focusAdd) {
      overlay.querySelector<HTMLElement>("[data-add-label]")?.focus();
    }
  }

  function close(): void {
    open = false;
    draw();
  }

  async function reload(): Promise<void> {
    try {
      list = await api.list();
    } catch (e) {
      message = { text: describeFailure(e).message, tone: "error" };
    }
  }

  /** Enchaîne une action, la recharge, et prévient l'appelant. */
  async function run(action: () => Promise<void>, success?: string): Promise<void> {
    busy = true;
    message = null;
    draw();
    try {
      await action();
      await reload();
      if (success) message = { text: success, tone: "info" };
      busy = false;
      draw();
      hooks.onChanged();
    } catch (e) {
      busy = false;
      message = { text: describeFailure(e).message, tone: "error" };
      draw();
    }
  }

  function stateBadge(account: AccountInfo): HTMLElement {
    if (account.pending) {
      return el("span", { class: "tag tag-outline", text: "À autoriser" });
    }
    if (!account.ready) {
      return el("span", { class: "tag tag-outline", text: "Non connecté" });
    }
    return el("span", {
      class: account.active ? "tag tag-accent" : "tag tag-neutral",
      text: account.active ? "Actif" : "Prêt",
    });
  }

  function accountRow(account: AccountInfo): HTMLElement {
    if (renaming === account.id) {
      const input = el("input", {
        class: "input",
        attrs: {
          type: "text",
          value: account.label,
          "aria-label": "Nom du compte",
          placeholder: account.nichandle ?? "Nom du compte",
        },
        on: {
          keydown: (ev) => {
            const key = (ev as KeyboardEvent).key;
            if (key === "Enter") {
              ev.preventDefault();
              const value = (ev.currentTarget as HTMLInputElement).value;
              renaming = null;
              void run(async () => {
                await api.rename(account.id, value);
              });
            } else if (key === "Escape") {
              ev.preventDefault();
              renaming = null;
              draw();
            }
          },
        },
      }) as HTMLInputElement;

      return el("div", { class: "account-row" }, [
        input,
        button("Enregistrer", {
          class: "btn btn-primary",
          onClick: () => {
            const value = input.value;
            renaming = null;
            void run(async () => {
              await api.rename(account.id, value);
            });
          },
        }),
        button("Annuler", {
          class: "btn btn-ghost",
          onClick: () => {
            renaming = null;
            draw();
          },
        }),
      ]);
    }

    return el("div", { class: `account-row${account.active ? " is-active" : ""}` }, [
      el("div", { class: "account-identity" }, [
        el("div", { class: "account-name", text: account.displayName }),
        el("div", {
          class: "account-meta",
          text: account.nichandle
            ? `${account.nichandle} · ${account.endpoint.label}`
            : account.endpoint.label,
        }),
      ]),
      stateBadge(account),
      account.active
        ? null
        : button("Utiliser", {
            class: "btn btn-secondary",
            disabled: busy,
            onClick: () =>
              void run(async () => {
                await api.select(account.id);
              }),
          }),
      button("Renommer", {
        class: "btn btn-ghost",
        disabled: busy,
        onClick: () => {
          renaming = account.id;
          draw();
        },
      }),
      button("Supprimer", {
        class: "btn btn-ghost account-remove",
        disabled: busy,
        onClick: () =>
          void run(async () => {
            await api.remove(account.id);
          }, `Compte ${account.displayName} supprimé.`),
      }),
    ]);
  }

  function addForm(): HTMLElement {
    const select = el("select", {
      class: "input",
      attrs: { "aria-label": "Racine de l'API" },
      on: {
        change: (ev) => {
          newEndpoint = (ev.currentTarget as HTMLSelectElement).value;
        },
      },
    }) as HTMLSelectElement;
    select.disabled = busy || endpoints.length === 0;
    for (const e of endpoints) {
      const option = el("option", {
        // La branche servie fait partie du choix : Kimsufi et So you Start
        // s'arrêtent à /1.0, et le découvrir plus tard ressemble à une panne.
        text: `${e.label} — ${e.branches.map((b) => `/${b}`).join(" ")}`,
        attrs: { value: e.id },
      }) as HTMLOptionElement;
      option.selected = e.id === newEndpoint;
      select.appendChild(option);
    }

    const labelInput = el("input", {
      class: "input",
      attrs: {
        type: "text",
        placeholder: "Nom (facultatif)",
        "aria-label": "Nom du compte",
        "data-add-label": "",
      },
      on: {
        input: (ev) => {
          newLabel = (ev.currentTarget as HTMLInputElement).value;
        },
      },
    });

    return el("div", { class: "account-add" }, [
      el("div", { class: "dialog-title", style: { fontSize: "15px" }, text: "Ajouter un compte" }),
      el("div", {
        class: "text-muted",
        style: { fontSize: "13px" },
        text: "Le compte est créé vide : l'autorisation se fait juste après, dans ton navigateur.",
      }),
      el("div", { class: "settings-form" }, [
        el("div", { class: "field" }, [el("label", { text: "Racine de l'API" }), select]),
        el("div", { class: "field" }, [el("label", { text: "Nom" }), labelInput]),
      ]),
      button("Créer le compte", {
        class: "btn btn-primary",
        disabled: busy || !newEndpoint,
        onClick: () =>
          void run(async () => {
            await api.add(newEndpoint, newLabel.trim() || undefined);
            newLabel = "";
          }, "Compte créé. Il reste à autoriser l'accès."),
      }),
    ]);
  }

  function draw(): void {
    overlay.replaceChildren();
    if (!open) return;

    const dialog = el(
      "div",
      {
        class: "dialog dialog-wide",
        attrs: { role: "dialog", "aria-modal": "true", "aria-label": "Comptes" },
      },
      [
        el("div", { class: "dialog-title", text: "Comptes" }),
        el("div", { class: "dialog-body" }, [
          list.length === 0
            ? el("div", {
                class: "text-muted",
                text: "Aucun compte enregistré pour l'instant.",
              })
            : el("div", { class: "account-list" }, list.map(accountRow)),
          message
            ? el("div", {
                class: message.tone === "error" ? "settings-error" : "text-muted",
                style: { fontSize: "13px" },
                text: message.text,
                attrs: { role: message.tone === "error" ? "alert" : "status" },
              })
            : null,
          el("hr", { class: "hr" }),
          addForm(),
        ]),
        el("div", { class: "dialog-actions" }, [
          button("Fermer", { class: "btn btn-secondary", onClick: () => close() }),
        ]),
      ],
    );

    overlay.appendChild(
      el(
        "div",
        {
          class: "dialog-backdrop",
          on: {
            click: (ev) => {
              if (ev.target === ev.currentTarget && !busy) close();
            },
          },
        },
        [dialog],
      ),
    );
  }

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape" && open && !busy) {
      ev.preventDefault();
      close();
    }
  };
  window.addEventListener("keydown", onKey);

  opener = (focusAdd = false) => void show(focusAdd);

  return () => {
    window.removeEventListener("keydown", onKey);
    unlisten?.();
    overlay.remove();
    opener = null;
  };
}

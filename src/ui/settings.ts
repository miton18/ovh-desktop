/**
 * Réglages de l'application OVHcloud — Fichier → Préférences… (`⌘/Ctrl + ,`).
 *
 * Volontairement hors des écrans : la maquette n'a pas de place pour ces
 * commandes, et elles doivent rester accessibles aussi bien avant la connexion
 * qu'une fois dans la console. Le dialogue se pose donc sur `document.body`,
 * au-dessus de l'écran monté, quel qu'il soit.
 *
 *  * Ce qui n'y est **pas** : le choix de la racine. Un endpoint appartient à un
 * compte — voir `ui/accounts.ts` et le menu Comptes — parce qu'un NIC européen
 * n'existe pas sur la racine canadienne. Le choisir ici, hors de tout compte,
 * n'aurait décrit aucune réalité.
 *
 * Ce qu'on y règle : **l'application** utilisée pour signer les appels, pour la
 * racine du compte actif. La console en embarque
 *   une, donc l'utilisateur n'a normalement rien à faire — mais fournir la
 *   sienne permet de cloisonner ses essais, de tracer ses propres appels dans
 *   son compte OVHcloud, et de travailler sur un endpoint autre que l'européen,
 *   où la clé embarquée ne vaut rien.
 */

import { auth, onMenuAction, type OvhStatus } from "../ovh-api";
import { describeFailure, setDataMode } from "./data";
import { button, el } from "./dom";

export type SettingsHooks = {
  /**
   * L'application ou la délégation a changé : l'appelant doit relire l'état et
   * réafficher l'écran qui convient.
   */
  onChanged: () => void;
  /** L'utilisateur a demandé le mode « données d'exemple ». */
  onSampleMode: () => void;
};

/**
 * Point d'entrée unique, installé une fois par `main.ts`. Le singleton permet à
 * n'importe quel écran d'ouvrir les réglages sans se faire passer le handle.
 */
let opener: (() => void) | null = null;

/** Ouvre les réglages. Sans effet si `installSettings` n'a pas encore tourné. */
export function openSettings(): void {
  opener?.();
}

/** Installe le dialogue et l'écoute du menu. Rend la fonction de démontage. */
export function installSettings(hooks: SettingsHooks): () => void {
  const overlay = el("div", { class: "settings-overlay" });
  document.body.appendChild(overlay);

  let open = false;
  let status: OvhStatus | null = null;
  let message: { text: string; tone: "error" | "info" } | null = null;
  let appKey = "";
  let appSecret = "";
  let createAppUrl: string | null = null;
  let unlisten: (() => void) | null = null;

  void onMenuAction((action) => {
    if (action === "settings") show();
  }).then((un) => {
    unlisten = un;
  });

  async function show(): Promise<void> {
    open = true;
    message = null;
    appKey = "";
    appSecret = "";
    draw();
    // L'état affiché vient de l'API, jamais d'une supposition locale.
    await reloadStatus();
    await reloadCreateAppUrl();
    draw();
  }

  /** L'URL dépend de l'endpoint : elle est relue à chaque bascule. */
  async function reloadCreateAppUrl(): Promise<void> {
    createAppUrl = await auth.createAppUrl().catch(() => null);
  }


  function close(): void {
    open = false;
    draw();
  }

  async function reloadStatus(): Promise<void> {
    try {
      status = await auth.status();
    } catch (e) {
      message = { text: describeFailure(e).message, tone: "error" };
    }
  }

  async function save(): Promise<void> {
    if (!appKey.trim() || !appSecret.trim()) return;
    message = null;
    try {
      await auth.setApplication(appKey.trim(), appSecret.trim());
      appKey = "";
      appSecret = "";
      await reloadStatus();
      message = {
        text: "Application enregistrée. Il reste à autoriser l'accès au compte.",
        tone: "info",
      };
      draw();
      hooks.onChanged();
    } catch (e) {
      message = { text: describeFailure(e).message, tone: "error" };
      draw();
    }
  }

  async function reset(): Promise<void> {
    message = null;
    try {
      await auth.resetApplication();
      await reloadStatus();
      message = { text: "Retour à l'application embarquée.", tone: "info" };
      draw();
      hooks.onChanged();
    } catch (e) {
      message = { text: describeFailure(e).message, tone: "error" };
      draw();
    }
  }


  function sourceLabel(): string {
    switch (status?.application) {
      case "embedded":
        return "Application embarquée dans O.V.H.";
      case "userSupplied":
        return "Application fournie par toi";
      case "missing":
        return "Aucune application disponible";
      default:
        return "État inconnu";
    }
  }

  function field(
    label: string,
    type: "text" | "password",
    onInput: (value: string) => void,
    sync: () => void,
  ): HTMLElement {
    return el("div", { class: "field" }, [
      el("label", { text: label }),
      el("input", {
        class: "input",
        attrs: { type, spellcheck: "false", autocomplete: "off", "aria-label": label },
        on: {
          input: (ev) => {
            onInput((ev.currentTarget as HTMLInputElement).value);
            sync();
          },
        },
      }),
    ]);
  }


  function draw(): void {
    overlay.replaceChildren();
    if (!open) return;

    const missing = status?.application === "missing";

    const saveBtn = button("Enregistrer", {
      class: "btn btn-primary",
      disabled: true,
      onClick: () => void save(),
    });
    const sync = () => {
      saveBtn.disabled = !appKey.trim() || !appSecret.trim();
    };

    const dialog = el(
      "div",
      {
        class: "dialog",
        attrs: {
          role: "dialog",
          "aria-modal": "true",
          "aria-label": "Réglages de l'application OVHcloud",
        },
      },
      [
        el("div", { class: "dialog-title", text: "Réglages" }),
        el("div", { class: "dialog-body" }, [
          el("div", { class: "settings-row" }, [
            el("span", {
              class: missing ? "tag tag-outline" : "tag tag-neutral",
              text: sourceLabel(),
            }),
            status
              ? el("span", {
                  class: "text-muted",
                  style: { fontSize: "12px" },
                  text: `API ${status.branch}`,
                })
              : null,
          ]),
          el("div", {
            text: "Une application est la paire clé + secret qui signe les appels. La console en embarque une : tu n'as normalement rien à saisir. Fournir la tienne cloisonne tes essais et fait apparaître tes appels sous ton propre compte OVHcloud.",
          }),
          createAppUrl
            ? el("div", {}, [
                el("span", { class: "text-muted", text: "Créer une application : " }),
                el("span", { class: "mono", style: { wordBreak: "break-all" }, text: createAppUrl }),
              ])
            : null,
          el("div", { class: "settings-form" }, [
            field("Application key", "text", (v) => {
              appKey = v;
            }, sync),
            // `password` : le secret ne doit pas rester lisible à l'écran.
            field("Application secret", "password", (v) => {
              appSecret = v;
            }, sync),
          ]),
          message
            ? el("div", {
                class: message.tone === "error" ? "settings-error" : "text-muted",
                style: { fontSize: "13px" },
                text: message.text,
                attrs: { role: message.tone === "error" ? "alert" : "status" },
              })
            : null,
          el("div", { class: "settings-row" }, [
            status?.application === "userSupplied"
              ? button("Revenir à l'application embarquée", {
                  class: "btn btn-ghost",
                  onClick: () => void reset(),
                })
              : null,
            button("Données d'exemple", {
              class: "btn btn-ghost",
              onClick: () => {
                setDataMode("sample");
                close();
                hooks.onSampleMode();
              },
            }),
          ]),
        ]),
        el("div", { class: "dialog-actions" }, [
          // Sans application, fermer laisserait une console inutilisable.
          missing
            ? null
            : button("Fermer", { class: "btn btn-secondary", onClick: () => close() }),
          saveBtn,
        ]),
      ],
    );

    const backdrop = el(
      "div",
      {
        class: "dialog-backdrop",
        on: {
          // Un clic à côté ferme, sauf si le dialogue est la seule issue.
          click: (ev) => {
            if (ev.target === ev.currentTarget && !missing) close();
          },
        },
      },
      [dialog],
    );

    overlay.appendChild(backdrop);
    dialog.querySelector<HTMLElement>("input, button")?.focus();
  }

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape" || !open) return;
    if (status?.application === "missing") return;
    ev.preventDefault();
    close();
  };
  window.addEventListener("keydown", onKey);

  opener = () => void show();

  return () => {
    window.removeEventListener("keydown", onKey);
    unlisten?.();
    overlay.remove();
    opener = null;
  };
}

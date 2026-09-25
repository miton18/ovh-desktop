/**
 * Notifications éphémères.
 *
 * Un toast confirme une action qui a réussi, ou dit pourquoi elle a échoué. Il
 * ne porte jamais une information qu'on ne retrouverait pas ailleurs à l'écran :
 * il disparaît, contrairement à l'onglet Opérations.
 */

import { button, el } from "./dom";
import { icon } from "./icons";

export type ToastOptions = {
  /** Une action de retour en arrière, quand elle est réellement possible. */
  undo?: { label: string; run: () => void };
  /** Durée d'affichage, en millisecondes. */
  duration?: number;
  tone?: "success" | "error";
};

let layer: HTMLElement | null = null;

function ensureLayer(): HTMLElement {
  if (layer && layer.isConnected) return layer;
  layer = el("div", {
    class: "toast-layer",
    // `polite` : un toast ne doit pas couper la lecture en cours.
    attrs: { role: "status", "aria-live": "polite" },
  });
  document.body.appendChild(layer);
  return layer;
}

export function toast(message: string, options: ToastOptions = {}): void {
  const tone = options.tone ?? "success";
  const duration = options.duration ?? (tone === "error" ? 8000 : 5000);

  const node = el(
    "div",
    { class: tone === "error" ? "toast is-error" : "toast" },
    [
      icon(tone === "error" ? "warning" : "check-circle", { size: 18 }),
      el("span", { class: "toast-message", text: message }),
      options.undo
        ? button(options.undo.label, {
            class: "btn btn-ghost",
            onClick: () => {
              options.undo?.run();
              dismiss();
            },
          })
        : null,
    ],
  );

  let timer = 0;
  function dismiss(): void {
    window.clearTimeout(timer);
    node.remove();
  }

  timer = window.setTimeout(dismiss, duration);
  ensureLayer().appendChild(node);
}

/** Raccourci pour les échecs : un ton distinct et plus de temps pour lire. */
export function toastError(message: string): void {
  toast(message, { tone: "error" });
}

/** Retire tous les toasts — au changement d'écran, par exemple. */
export function clearToasts(): void {
  if (layer) layer.replaceChildren();
}

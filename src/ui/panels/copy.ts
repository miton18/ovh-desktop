/**
 * Copier une valeur dans le presse-papiers.
 *
 * Mutualisé parce que tout le périmètre en dépend : un mot de passe FTP, une
 * adresse IP à recopier dans une zone DNS, une commande de connexion à une base.
 * Ces valeurs ne sont pas relisibles ailleurs — si la copie échoue, il faut le
 * dire, pas laisser croire qu'elle a eu lieu.
 */

import { button } from "../dom";
import { icon } from "../icons";
import { toast, toastError } from "../toast";

export function copyValue(value: string, what: string): void {
  void navigator.clipboard
    .writeText(value)
    .then(() => toast(`${what} copié`))
    .catch(() => toastError("Le presse-papiers n'est pas accessible."));
}

export function copyButton(
  value: string,
  what: string,
  options: { size?: number; class?: string } = {},
): HTMLButtonElement {
  return button("", {
    class: options.class ?? "btn btn-ghost btn-icon btn-copy",
    icon: icon("copy", { size: options.size ?? 15 }),
    title: "Copier",
    ariaLabel: `Copier ${what.toLowerCase()}`,
    onClick: () => copyValue(value, what),
  });
}

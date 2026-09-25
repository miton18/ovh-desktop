/**
 * L'état vide d'une fonction que l'offre n'a pas.
 *
 * Deux situations qu'il ne faut surtout pas rendre pareil :
 *
 * - **la capacité vaut `0` ou `false`** : la fonction n'existe pas pour cette
 *   offre. Un bouton grisé au-dessus d'un tableau vide laisse voir l'ombre de
 *   quelque chose qu'on ne pourra jamais avoir — on remplace donc le tableau
 *   **et** le bouton par ce bloc, qui dit pourquoi et ce qui la débloquerait ;
 * - **la limite est atteinte** : le tableau garde tout son sens, seul l'ajout se
 *   grise, avec son compteur. « 1 sur 1 » est actionnable, un bouton mort non.
 */

import { el } from "../dom";
import { icon } from "../icons";
import type { IconName } from "../icons";

export function capabilityEmptyState(options: {
  icon?: IconName;
  title: string;
  /** Pourquoi ce n'est pas disponible. */
  reason: string;
  /** Ce qui le débloquerait, quand on le sait. */
  unlock?: string;
}): HTMLElement {
  return el("div", { class: "capability-empty", attrs: { role: "status" } }, [
    icon(options.icon ?? "prohibit", { size: 20 }),
    el("div", { class: "capability-empty-text" }, [
      el("div", { class: "title", text: options.title }),
      el("div", { class: "reason", text: options.reason }),
      options.unlock ? el("div", { class: "unlock", text: options.unlock }) : null,
    ]),
  ]);
}

/** Ce qui débloque les fonctions réservées aux offres Cloud Web. */
export const CLOUD_WEB_UNLOCK =
  "Seules les offres Cloud Web les autorisent : c'est ce que répond l'API pour cette offre.";

/**
 * 02 Connexion — le parcours de délégation OVHcloud.
 *
 * **L'écran suit la maquette au mot près** : marque, « Espace client », le titre
 * sur deux lignes, la phrase de sous-titre, un seul bouton, la ligne de pied de
 * page. Rien d'autre. Tout ce que le protocole OVH impose en plus vit ailleurs :
 *
 * - le bouton unique change de libellé au fil des étapes — c'est exactement ce
 *   que le binding `loginLabel` de la maquette encode ;
 * - la gestion de l'application (clé + secret) vit dans les réglages globaux
 *   (`ui/settings.ts`), ouverts par Fichier → Préférences…. Cet écran ne les
 *   ouvre de lui-même que s'il n'y a aucune application : sans elle, aucune
 *   signature n'est possible et le bouton ne mènerait nulle part.
 *
 * Rappel du protocole : l'étape de validation sort de l'application, impossible
 * de savoir quand l'utilisateur a cliqué dans son navigateur. D'où le second
 * temps du bouton, « J'ai validé la page », plutôt qu'une attente aveugle.
 */

import { auth, isOvhError, type OvhStatus } from "../../ovh-api";

/**
 * Ce dont cet écran a besoin — pas tout `OvhStatus` : ni le compte ni l'endpoint,
 * qui demandent un appel réseau que le routeur évite avant la connexion.
 */
export type LoginState = Pick<
  OvhStatus,
  "application" | "hasConsumerKey" | "ready" | "branch"
> & {
  /** Une délégation attend d'être validée : on propose de la reprendre. */
  pendingConsumerKey: boolean;
};
import { describeFailure } from "../data";
import { append, button, el, wordmark } from "../dom";
import { icon, spinner } from "../icons";
import { openSettings } from "../settings";

export type LoginResult = { account: string | null };

type Step =
  /** Prêt à demander la délégation. */
  | { name: "idle" }
  /** `ovh_authorize` en cours. */
  | { name: "authorizing" }
  /** La page de validation est ouverte, on attend le retour de l'utilisateur. */
  | { name: "awaitingValidation"; validationUrl: string }
  /** `ovh_confirm_authorization` en cours. */
  | { name: "confirming"; validationUrl: string };

/**
 * Monte l'écran et rend le compte lié quand la délégation est active.
 *
 * `state` est l'état lu sans réseau au démarrage : il évite de redemander à
 * l'API ce qu'on sait déjà, et décide du libellé du bouton.
 */
export function mountLogin(host: HTMLElement, state: LoginState): Promise<LoginResult> {
  return new Promise<LoginResult>((resolve) => {
    const current: LoginState = state;
    let step: Step = { name: "idle" };
    let message: { text: string; tone: "error" | "info" } | null = null;

    const body = el("div", { class: "login-body" });

    const screen = el(
      "div",
      { class: "screen login", attrs: { "data-screen": "02-connexion" } },
      [
        el("div", { class: "login-left" }, [
          wordmark(),
          body,
          el("div", {
            class: "login-legal",
            text: "Console indépendante · Mentions légales · Confidentialité",
          }),
        ]),
        el("div", { class: "login-art", attrs: { "aria-hidden": "true" } }, [
          el("span", { text: "O.V.H." }),
        ]),
      ],
    );

    host.replaceChildren(screen);

    // Sans application, le bouton ne mène nulle part : on ouvre les réglages.
    if (current.application === "missing") openSettings();

    // -- Actions ----------------------------------------------------------

    async function authorize(): Promise<void> {
      step = { name: "authorizing" };
      message = null;
      draw();
      try {
        const request = await auth.authorize(true);
        step = { name: "awaitingValidation", validationUrl: request.validationUrl };
        message = {
          text: "Accorde l'accès dans le navigateur, puis reviens ici.",
          tone: "info",
        };
      } catch (e) {
        step = { name: "idle" };
        const failure = describeFailure(e);
        message = { text: failure.message, tone: "error" };
        // Sans application, aucune signature n'est possible : on ouvre les
        // réglages au lieu de laisser l'utilisateur deviner.
        if (failure.kind === "noApplication") openSettings();
      }
      draw();
    }

    async function confirm(validationUrl: string): Promise<void> {
      step = { name: "confirming", validationUrl };
      message = null;
      draw();
      try {
        const details = await auth.confirm();
        resolve({ account: details.account });
        return;
      } catch (e) {
        step = { name: "awaitingValidation", validationUrl };
        if (isOvhError(e) && e.kind === "pendingValidation") {
          message = {
            text: "La page n'a pas encore été validée. Accorde l'accès, puis réessaie.",
            tone: "info",
          };
        } else {
          message = { text: describeFailure(e).message, tone: "error" };
        }
      }
      draw();
    }

    // -- Rendu de l'écran : strictement la maquette ------------------------

    /**
     * Le libellé du bouton porte l'étape courante. C'est le `loginLabel` de la
     * maquette : un seul bouton, un libellé qui change.
     */
    function loginLabel(): string {
      switch (step.name) {
        case "authorizing":
          return "Connexion…";
        case "awaitingValidation":
          return "J'ai validé la page";
        case "confirming":
          return "Vérification…";
        case "idle":
          // Une délégation en attente de validation se reprend, elle ne se
          // recommence pas : la page de validation est toujours ouvrable.
          return current.pendingConsumerKey ? "Reprendre l'autorisation" : "Se connecter";
      }
    }

    function actions(): HTMLElement {
      const busy = step.name === "authorizing" || step.name === "confirming";
      const awaiting = step.name === "awaitingValidation" || step.name === "confirming";

      const primary = button(loginLabel(), {
        class: "btn btn-primary",
        disabled: busy,
        icon: busy
          ? spinner(18)
          : icon(awaiting ? "check" : "sign-in", { size: 18 }),
        onClick: () => {
          if (step.name === "awaitingValidation") void confirm(step.validationUrl);
          else if (step.name === "idle") void authorize();
        },
      });

      return el("div", { class: "login-actions" }, [
        primary,
        // Un second bouton n'apparaît que pour sortir d'une validation qui ne
        // vient pas : la maquette prévoit une rangée, pas un bouton isolé.
        awaiting
          ? button("Recommencer", {
              class: "btn btn-ghost",
              disabled: busy,
              onClick: () => void authorize(),
            })
          : null,
      ]);
    }

    function draw(): void {
      const children: (Node | null)[] = [
        el("div", { class: "card-kicker", text: "Espace client" }),
        el("h1", { html: "Tous vos produits,<br>une seule console." }),
        el("p", {
          text: "Serveurs, domaines, hébergements et services cloud, réunis au même endroit.",
        }),
        actions(),
        // Une seule ligne, et seulement quand il y a quelque chose à dire.
        message
          ? el("div", {
              class: message.tone === "error" ? "login-error" : "login-hint",
              text: message.text,
              attrs: { role: message.tone === "error" ? "alert" : "status" },
            })
          : null,
      ];

      body.replaceChildren();
      append(body, children);
    }

    draw();
  });
}

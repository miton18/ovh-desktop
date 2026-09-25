/**
 * 01 Splash — le chargement des produits, après l'authentification.
 *
 * Il ne sert pas à couvrir la lecture du statut : cette décision se prend sans
 * réseau, avant, grâce à `auth.statusLocal()`. Quelqu'un qui n'est pas connecté
 * voit directement l'écran de connexion, sans attente inutile.
 *
 * Ici, on est donc dans le cas où une délégation existe. Le splash couvre deux
 * choses : vérifier qu'elle est toujours valide auprès de l'API, et précharger
 * les premiers appels — la liste des domaines — pour que la console s'ouvre
 * déjà remplie. D'où le libellé « Chargement de vos produits… ».
 *
 * Une durée plancher évite le clignotement quand tout répond en 30 ms.
 */

import { auth } from "../../ovh-api";
import { button, el, wordmark } from "../dom";
import { describeFailure, listDomainNames } from "../data";

/** Durée minimale d'affichage, alignée sur l'animation de la maquette. */
const MIN_VISIBLE_MS = 1400;

export type SplashResult =
  /** Délégation valide et produits préchargés. */
  | { kind: "ready"; account: string | null }
  /** Délégation absente, expirée ou refusée : il faut (ré)autoriser. */
  | { kind: "login" }
  /** L'utilisateur a renoncé après un échec. */
  | { kind: "giveUp" };

export function mountSplash(host: HTMLElement): Promise<SplashResult> {
  const tagline = el("div", {
    class: "splash-tagline",
    text: "Une meilleure console pour vos serveurs, domaines et hébergements",
  });

  const bar = el("div", { class: "splash-bar" }, [el("span")]);
  const loading = el("div", {
    class: "splash-loading",
    text: "Chargement de vos produits…",
  });
  const errorBox = el("div", { class: "splash-error", attrs: { hidden: true } });

  const screen = el(
    "div",
    {
      class: "screen splash",
      attrs: { "data-screen": "01-splash" },
      style: { ["--splash-duration" as string]: `${MIN_VISIBLE_MS}ms` },
    },
    [
      el("h1", { style: { margin: "0" } }, [wordmark({ class: "splash-logo" })]),
      tagline,
      bar,
      loading,
      errorBox,
    ],
  );

  host.replaceChildren(screen);

  return new Promise<SplashResult>((resolve) => {
    const startedAt = Date.now();

    const finish = async (result: SplashResult): Promise<void> => {
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_VISIBLE_MS) {
        await new Promise((r) => setTimeout(r, MIN_VISIBLE_MS - elapsed));
      }
      resolve(result);
    };

    const attempt = async (): Promise<void> => {
      errorBox.hidden = true;
      errorBox.replaceChildren();
      try {
        const status = await auth.status();
        if (!status.ready) {
          // La clé est là mais l'API la refuse : réautoriser, sans erreur affichée.
          await finish({ kind: "login" });
          return;
        }

        // Préchargement : ce qui échoue ici n'empêche pas d'entrer dans la
        // console, qui sait afficher ses propres erreurs partielles.
        await listDomainNames().catch(() => []);

        await finish({ kind: "ready", account: status.account });
      } catch (e) {
        // Un échec n'est pas forcément un problème de compte : le trousseau peut
        // être verrouillé, ou le réseau absent. On ne renvoie pas vers la
        // connexion, qui n'y changerait rien.
        const failure = describeFailure(e);
        if (failure.needsAuth) {
          await finish({ kind: "login" });
          return;
        }
        bar.hidden = true;
        loading.hidden = true;
        errorBox.hidden = false;
        errorBox.replaceChildren(
          el("p", {
            text: `Impossible de charger vos produits : ${failure.message}`,
            style: { margin: "0 0 12px" },
          }),
          el("div", { style: { display: "flex", gap: "12px" } }, [
            button("Réessayer", {
              class: "btn btn-primary",
              onClick: () => {
                bar.hidden = false;
                loading.hidden = false;
                void attempt();
              },
            }),
            button("Aller à la connexion", {
              class: "btn btn-secondary",
              onClick: () => resolve({ kind: "giveUp" }),
            }),
          ]),
        );
      }
    };

    void attempt();
  });
}

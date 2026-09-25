/**
 * Point d'entrée du frontend : le routeur entre les trois écrans.
 *
 * L'ordre suit ce que l'utilisateur a à faire, pas ce que le code a à lire :
 *
 *   pas de délégation  →  02 Connexion            (immédiat, sans attente)
 *   délégation en place →  01 Splash  →  03 Console
 *
 * La première décision se prend **sans réseau** (`auth.statusLocal()`, qui ne lit
 * que le trousseau) : quelqu'un qui n'est pas connecté n'a aucune raison
 * d'attendre devant un écran de chargement. Le splash ne sert donc qu'à ce qu'il
 * annonce — vérifier la délégation et précharger les produits — avant d'ouvrir
 * une console déjà remplie.
 *
 * Aucun écran ne décide du suivant : chacun rend un résultat, et c'est ici qu'on
 * en tire la conséquence. Ça garde le parcours lisible en un seul endroit.
 */

import { attachConsole, error as logError, info } from "@tauri-apps/plugin-log";
import { auth, onAccountChanged, type LocalState } from "./ovh-api";
import { dataMode, describeFailure, setDataMode } from "./ui/data";
import { mountSplash } from "./ui/screens/splash";
import { mountLogin, type LoginState } from "./ui/screens/login";
import { mountConsole, type ConsoleHandle } from "./ui/screens/console";
import { installAccounts } from "./ui/accounts";
import { installSettings } from "./ui/settings";
import { clearToasts, toastError } from "./ui/toast";

const root = document.getElementById("app");
if (!root) throw new Error("conteneur #app introuvable");
const host = root;

/** La console installe des écouteurs globaux : il faut la démonter proprement. */
let consoleHandle: ConsoleHandle | null = null;

function teardownConsole(): void {
  consoleHandle?.destroy();
  consoleHandle = null;
  clearToasts();
}

/**
 * Monte la console. `account` est le nichandle réel, ou `null` en mode
 * « données d'exemple ».
 *
 * Le mode d'exemple est persisté dans le navigateur pour survivre à un
 * redémarrage. Conséquence à ne pas laisser passer : sans ce garde-fou, une
 * personne qui l'a essayé une fois puis s'est connectée pour de vrai continue de
 * voir des domaines fictifs sous son propre nom de compte. Un compte réel à
 * l'écran impose donc des données réelles.
 */
async function showConsole(account: string | null): Promise<void> {
  if (account !== null && dataMode() === "sample") {
    setDataMode("live");
    void info("compte réel connecté : sortie du mode données d'exemple");
  }
  teardownConsole();
  consoleHandle = await mountConsole(host, account, {
    onLogout: () => {
      void logout();
    },
  });
}

async function showLogin(state: LoginState): Promise<void> {
  teardownConsole();
  const { account } = await mountLogin(host, state);
  await showConsole(account);
}

function loginStateFrom(local: LocalState): LoginState {
  return {
    application: local.application,
    hasConsumerKey: local.hasConsumerKey,
    pendingConsumerKey: local.pendingConsumerKey,
    ready: false,
    branch: local.branch,
  };
}

/**
 * Déconnexion : on révoque côté OVH, puis on repart de l'état réel. Même si
 * l'appel réseau échoue, la clé est oubliée localement — donc on relit le statut
 * au lieu de le supposer.
 */
async function logout(): Promise<void> {
  teardownConsole();
  // Se déconnecter sort aussi du mode « données d'exemple » : on repart de l'état
  // réel du compte, sinon on se reconnecterait dans un bac à sable.
  setDataMode("live");
  try {
    await auth.logout();
  } catch (e) {
    const failure = describeFailure(e);
    void logError(`ovh_logout: ${failure.message}`);
  }
  await route();
}

/**
 * Décide de l'écran d'entrée, sans réseau, puis le monte.
 *
 * Tant qu'aucune délégation n'est enregistrée, il n'y a rien à charger : on va
 * droit à la connexion. C'est seulement quand il y a quelque chose à vérifier et
 * à précharger que le splash a un sens.
 */
async function route(): Promise<void> {
  let local: LocalState;
  try {
    local = await auth.statusLocal();
  } catch (e) {
    const failure = describeFailure(e);
    toastError(`Impossible de lire l'état local : ${failure.message}`);
    // Trousseau illisible : l'écran de connexion reste le seul utile, il sait
    // enregistrer une application et relancer une autorisation.
    await showLogin({
      application: "missing",
      hasConsumerKey: false,
      pendingConsumerKey: false,
      ready: false,
      branch: "?",
    });
    return;
  }

  if (!local.hasConsumerKey || local.application === "missing") {
    await showLogin(loginStateFrom(local));
    return;
  }

  // Une délégation validée existe : on est chez quelqu'un de réel. On quitte le
  // mode d'exemple **avant** le splash, sinon son préchargement remplirait le
  // cache de domaines fictifs qu'il faudrait jeter juste après.
  if (dataMode() === "sample") {
    setDataMode("live");
    void info("compte réel détecté au démarrage : sortie du mode données d'exemple");
  }

  teardownConsole();
  const result = await mountSplash(host);
  if (result.kind === "ready") await showConsole(result.account);
  else await showLogin(loginStateFrom(local));
}

async function main(): Promise<void> {
  // Renvoie les logs du frontend vers le backend (fichier + stdout).
  await attachConsole();

  // Menu Comptes → Ajouter un compte…
  installAccounts({ onChanged: () => void route() });

  // Le menu applicatif peut basculer de compte tout seul : ce qui est affiché
  // appartient alors à quelqu'un d'autre, il faut tout reprendre.
  await onAccountChanged(() => void route());

  // Fichier → Préférences… doit répondre partout, avant comme après connexion.
  installSettings({
    // L'application a changé : on repart de l'état réel plutôt que de deviner
    // quel écran est encore valable.
    onChanged: () => void route(),
    onSampleMode: () => void showConsole(null),
  });

  await route();

  void info("frontend prêt");
}

main().catch((e) => {
  const failure = describeFailure(e);
  void logError(`bootstrap: ${failure.message}`);
  host.replaceChildren();
  const pre = document.createElement("pre");
  pre.style.cssText = "padding:32px;color:var(--color-accent-300);white-space:pre-wrap";
  pre.textContent = `O.V.H. n'a pas pu démarrer : ${failure.message}`;
  host.appendChild(pre);
});

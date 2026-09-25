/**
 * Ce qu'un panneau de la page domaine peut faire sans connaître le reste.
 *
 * Les panneaux ne se parlent pas et n'appellent pas l'API : ils lisent le
 * `bundle`, modifient le `state`, et demandent un redessin ou un rechargement.
 */

import type { DomainBundle } from "../data";
import type { DomainTab, DomainViewState } from "./state";

export type DomainContext = {
  bundle: DomainBundle;
  state: DomainViewState;
  /** Redessine la page à partir de l'état courant, sans relire l'API. */
  rerender(): void;
  /** Relit le domaine via `data.ts`, puis redessine. */
  reload(options?: { force?: boolean }): void;
  goToTab(tab: DomainTab): void;
  /**
   * Relance le suivi des opérations en cours : tant qu'une tâche n'est pas dans
   * un état terminal, l'écran se remet à jour tout seul.
   */
  trackTasks(): void;
};

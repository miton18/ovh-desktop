/**
 * Ce qu'un panneau de la page domaine peut faire sans connaître le reste.
 *
 * Les panneaux ne se parlent pas et n'appellent pas l'API : ils lisent le
 * `bundle`, modifient le `state`, et demandent un redessin ou un rechargement.
 */

import type { DomainBundle, HostingAddressIndex } from "../data";
import type { DomainTab, DomainViewState } from "./state";

export type DomainContext = {
  bundle: DomainBundle;
  state: DomainViewState;
  /**
   * Les adresses des hébergements du compte, indexées.
   *
   * Elles permettent de dire qu'un enregistrement pointe vers un hébergement de
   * ce compte, et d'y aller. Vide quand le compte n'en a pas, ou quand la
   * délégation ne donne pas accès à `/hosting/web`.
   */
  hostings: HostingAddressIndex;
  /** Redessine la page à partir de l'état courant, sans relire l'API. */
  rerender(): void;
  /** Relit le domaine via `data.ts`, puis redessine. */
  reload(options?: { force?: boolean }): void;
  goToTab(tab: DomainTab): void;
  /** Ouvre un hébergement du compte, depuis l'enregistrement qui le sert. */
  openHosting(serviceName: string): void;
  /**
   * Relance le suivi des opérations en cours : tant qu'une tâche n'est pas dans
   * un état terminal, l'écran se remet à jour tout seul.
   */
  trackTasks(): void;
};

/**
 * Ce qu'un panneau d'hébergement peut faire sans connaître le reste.
 *
 * Même contrat que `context.ts` pour les domaines : les panneaux lisent le
 * `bundle`, modifient le `state`, et demandent un redessin ou un rechargement.
 * Ils n'appellent jamais l'API directement.
 */

import type { HostingBundle } from "../data";
import type { HostingTab, HostingViewState } from "./hosting-state";

export type HostingContext = {
  bundle: HostingBundle;
  state: HostingViewState;
  /**
   * Les zones DNS du compte.
   *
   * Elles disent où l'API a le droit d'écrire : attacher un domaine dont la zone
   * est ailleurs échoue, et le formulaire doit le savoir avant de proposer.
   */
  zones: string[];
  rerender(): void;
  reload(options?: { force?: boolean }): void;
  goToTab(tab: HostingTab): void;
  /** Relance le suivi des opérations : aucune ne s'annule, mais elles finissent. */
  trackTasks(): void;
  /** Ouvre une zone du compte dans la famille Domaines. */
  openDomain(zone: string): void;
};

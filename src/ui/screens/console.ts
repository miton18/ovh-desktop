/**
 * 03 Console — la coquille : barre latérale, barre du haut, contenu.
 *
 * Elle porte la navigation (famille de produits, produit sélectionné, onglet) et
 * le cycle de vie d'une page domaine : chargement, redessin, suivi des tâches.
 * Toutes les données passent par `../data.ts`, jamais par `invoke` direct.
 */

import { isDnssecTransitioning, isTerminalTaskStatus } from "../../ovh-api";
import {
  dataMode,
  describeFailure,
  getAccount,
  listProducts,
  listSections,
  loadDomainBundle,
  getProduct,
  refreshTasks,
  refreshZoneDnssec,
  setDataMode,
  type AccountIdentity,
  type DomainBundle,
  type ProductSection,
  type ProductSummary,
  type SectionId,
} from "../data";
import { button, el, wordmark } from "../dom";
import { icon, spinner } from "../icons";
import { clearToasts, toastError } from "../toast";
import { createPicker, logoutButton, type Picker } from "../panels/picker";
import { renderDomainPage } from "../panels/domain";
import { renderProductPage } from "../panels/product";
import type { DomainContext } from "../panels/context";
import {
  createDomainViewState,
  type DomainTab,
  type DomainViewState,
} from "../panels/state";

export type ConsoleHandlers = {
  /** Demande la déconnexion : c'est l'appelant qui décide de l'écran suivant. */
  onLogout(): void;
};

export type ConsoleHandle = {
  /** Retire les écouteurs globaux et arrête les suivis en cours. */
  destroy(): void;
};

/** Intervalle de relecture des tâches tant qu'une opération court. */
const TASK_POLL_MS = 4000;

export async function mountConsole(
  host: HTMLElement,
  account: string | null,
  handlers: ConsoleHandlers,
): Promise<ConsoleHandle> {
  // -- État de navigation -------------------------------------------------

  let sections: ProductSection[] = [];
  let activeSection: SectionId = "domains";
  let products: ProductSummary[] = [];
  let selectedId: string | null = null;

  let bundle: DomainBundle | null = null;
  let viewState: DomainViewState = createDomainViewState();
  let loading = false;
  let loadError: string | null = null;

  let taskTimer = 0;
  let destroyed = false;

  const identity: AccountIdentity = await getAccount(account);

  // -- Squelette ----------------------------------------------------------

  const navList = el("nav", {
    class: "sidebar-nav",
    attrs: { "aria-label": "Familles de produits" },
  });
  const contentArea = el("main", { class: "content", attrs: { id: "content" } });
  const topbar = el("header", { class: "topbar" });

  let picker: Picker | null = null;

  const sidebar = el("aside", { class: "sidebar" }, [
    wordmark({ class: "sidebar-brand" }),
    navList,
    el("div", { class: "sidebar-account" }, [
      el("div", { class: "avatar", attrs: { "aria-hidden": "true" }, text: identity.initials }),
      el("div", { class: "sidebar-account-id" }, [
        el("span", { text: identity.displayName }),
        // Quand on n'a que l'identifiant, la seconde ligne dit ce qu'il est
        // plutôt que de le répéter.
        el("span", {
          text:
            identity.displayName === identity.account
              ? "Compte OVHcloud"
              : identity.account,
        }),
      ]),
      logoutButton(() => {
        stopTracking();
        clearToasts();
        handlers.onLogout();
      }),
    ]),
  ]);

  const screen = el(
    "div",
    { class: "screen console", attrs: { "data-screen": "03-console" } },
    [sidebar, el("div", { class: "main" }, [topbar, contentArea])],
  );

  host.replaceChildren(screen);

  // -- Raccourci clavier : `/` ou ⌘K ouvre le sélecteur -------------------

  const onKeyDown = (ev: KeyboardEvent): void => {
    // `ev.target` peut être `window` ou `document`, qui n'ont pas de `tagName` :
    // c'est le `tagName` qu'il faut garder, pas seulement la cible.
    const tag = (ev.target as Partial<HTMLElement> | null)?.tagName?.toLowerCase() ?? "";
    const typing = tag === "input" || tag === "textarea" || tag === "select";
    const key = ev.key ?? "";
    if ((key === "/" && !typing) || (key.toLowerCase() === "k" && (ev.metaKey || ev.ctrlKey))) {
      ev.preventDefault();
      picker?.open();
    }
  };
  window.addEventListener("keydown", onKeyDown);

  // -- Barre latérale -----------------------------------------------------

  function drawNav(): void {
    const children: Node[] = [
      el("div", { class: "sidebar-group-title", text: "Mes produits" }),
      ...sections.map((s) =>
        el(
          "button",
          {
            class: "nav-item",
            attrs: {
              type: "button",
              "aria-current": s.id === activeSection,
              title: s.live ? undefined : "Famille disponible en données d'exemple seulement.",
            },
            on: {
              click: () => {
                if (s.id === activeSection) return;
                activeSection = s.id;
                selectedId = null;
                void selectSection();
              },
            },
          },
          [
            el("span", { class: "nav-item-mark" }),
            icon(s.icon, { size: 18 }),
            el("span", { class: "nav-item-label", text: s.label }),
            el("span", { class: "nav-item-count", text: String(s.count) }),
          ],
        ),
      ),
    ];
    if (dataMode() === "sample") children.push(sampleModeNotice());
    navList.replaceChildren(...children);
  }

  /** En mode exemple, on le dit à l'écran : rien ne doit laisser croire au réel. */
  function sampleModeNotice(): HTMLElement {
    return el("div", { style: { marginTop: "var(--space-6)" } }, [
      el("div", { class: "tag tag-outline", text: "Données d'exemple" }),
      el("button", {
        class: "link-button",
        text: "Revenir aux données réelles",
        attrs: { type: "button", style: "margin-top:8px" },
        on: {
          click: () => {
            setDataMode("live");
            void bootstrap();
          },
        },
      }),
    ]);
  }

  // -- Barre du haut ------------------------------------------------------

  function drawTopbar(): void {
    const section = sections.find((s) => s.id === activeSection);
    const model = {
      sectionLabel: section?.label ?? "produits",
      items: products,
      selectedId,
      icon: section?.icon ?? ("globe-simple" as const),
      onPick: (id: string) => {
        if (id === selectedId) return;
        selectedId = id;
        viewState = createDomainViewState();
        void loadSelection();
      },
    };

    if (picker) {
      picker.update(model);
      return;
    }
    picker = createPicker(model);
    topbar.replaceChildren(picker.root);
  }

  // -- Contenu ------------------------------------------------------------

  function drawContent(): void {
    if (loading && !bundle) {
      contentArea.replaceChildren(
        el("div", { class: "zone-state is-busy" }, [spinner(14), "Chargement…"]),
      );
      return;
    }

    if (loadError) {
      contentArea.replaceChildren(
        el("div", { class: "unsupported", attrs: { role: "alert" } }, [
          icon("warning", { size: 16 }),
          el("div", {}, [loadError]),
          button("Réessayer", {
            class: "btn btn-ghost",
            onClick: () => void loadSelection({ force: true }),
          }),
        ]),
      );
      return;
    }

    if (!selectedId) {
      contentArea.replaceChildren(
        el("div", { class: "placeholder" }, [
          activeSection === "domains"
            ? "Aucun domaine sur ce compte."
            : "Aucun produit dans cette famille.",
        ]),
      );
      return;
    }

    if (activeSection !== "domains") {
      const section = sections.find((s) => s.id === activeSection);
      void getProduct(activeSection, selectedId).then((detail) => {
        contentArea.replaceChildren(
          renderProductPage(detail, section?.label ?? "produits"),
        );
      });
      return;
    }

    if (!bundle) return;
    contentArea.replaceChildren(renderDomainPage(makeContext(bundle)));
  }

  function makeContext(current: DomainBundle): DomainContext {
    return {
      bundle: current,
      state: viewState,
      rerender: () => {
        if (!destroyed) drawContent();
      },
      reload: (options) => void loadSelection(options),
      goToTab: (tab: DomainTab) => {
        viewState.tab = tab;
        drawContent();
      },
      trackTasks: () => startTracking(),
    };
  }

  // -- Suivi des tâches ---------------------------------------------------

  function stopTracking(): void {
    window.clearTimeout(taskTimer);
    taskTimer = 0;
  }

  /**
   * Relit les tâches tant qu'au moins une n'est pas dans un état terminal.
   * L'API n'émet rien : une relecture périodique est le seul moyen de savoir.
   */
  function startTracking(): void {
    stopTracking();
    if (destroyed || activeSection !== "domains" || !selectedId) return;

    const name = selectedId;
    // Une bascule DNSSEC n'est pas toujours visible dans les tâches : le statut
    // de la zone est la source qui dit `enableInProgress`, donc on le relit avec.
    const watchDnssec = isDnssecTransitioning(bundle?.zoneDnssec?.status ?? "");

    taskTimer = window.setTimeout(() => {
      void Promise.all([
        refreshTasks(name),
        watchDnssec ? refreshZoneDnssec(name) : Promise.resolve(undefined),
      ])
        .then(([{ domainTasks, zoneTasks }, zoneDnssec]) => {
          if (destroyed || selectedId !== name) return;
          if (bundle) {
            bundle = {
              ...bundle,
              domainTasks,
              zoneTasks,
              zoneDnssec: zoneDnssec ?? bundle.zoneDnssec,
            };
            drawContent();
          }
          const stillRunning =
            [...domainTasks, ...zoneTasks].some((t) => !isTerminalTaskStatus(t.status)) ||
            isDnssecTransitioning(bundle?.zoneDnssec?.status ?? "");
          if (stillRunning) startTracking();
          else void loadSelection({ force: true });
        })
        .catch(() => {
          // Une relecture qui échoue n'est pas une erreur d'écran : on arrête le
          // suivi, l'utilisateur garde le bouton de rechargement.
        });
    }, TASK_POLL_MS);
  }

  // -- Chargement ---------------------------------------------------------

  async function loadSelection(options: { force?: boolean } = {}): Promise<void> {
    stopTracking();
    drawTopbar();

    if (!selectedId || activeSection !== "domains") {
      bundle = null;
      loadError = null;
      drawContent();
      return;
    }

    const name = selectedId;
    loading = true;
    loadError = null;
    if (options.force !== true) bundle = null;
    drawContent();

    try {
      const loaded = await loadDomainBundle(name, options);
      if (destroyed || selectedId !== name) return;
      bundle = loaded;
      loading = false;
      drawContent();
      // Une tâche déjà en cours au chargement doit être suivie elle aussi — et
      // une bascule DNSSEC entamée ailleurs compte comme telle.
      const running =
        [...loaded.domainTasks, ...loaded.zoneTasks].some(
          (t) => !isTerminalTaskStatus(t.status),
        ) || isDnssecTransitioning(loaded.zoneDnssec?.status ?? "");
      if (running) startTracking();
    } catch (e) {
      if (destroyed || selectedId !== name) return;
      loading = false;
      const failure = describeFailure(e);
      loadError = failure.message;
      if (failure.needsAuth) {
        toastError("L'accès au compte n'est plus valide. Reconnecte-toi.");
        handlers.onLogout();
        return;
      }
      drawContent();
    }
  }

  async function selectSection(): Promise<void> {
    products = await listProducts(activeSection, (enriched) => {
      if (destroyed || activeSection !== "domains") return;
      products = enriched;
      drawTopbar();
    });
    if (destroyed) return;
    selectedId = products[0]?.id ?? null;
    viewState = createDomainViewState();
    drawNav();
    drawTopbar();
    await loadSelection();
  }

  async function bootstrap(): Promise<void> {
    try {
      sections = await listSections();
      if (destroyed) return;
      activeSection = sections[0]?.id ?? "domains";
      drawNav();
      await selectSection();
    } catch (e) {
      const failure = describeFailure(e);
      if (failure.needsAuth) {
        handlers.onLogout();
        return;
      }
      loadError = failure.message;
      drawNav();
      drawTopbar();
      drawContent();
    }
  }

  await bootstrap();

  return {
    destroy() {
      destroyed = true;
      stopTracking();
      window.removeEventListener("keydown", onKeyDown);
    },
  };
}

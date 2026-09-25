/**
 * Fabrique de DOM minimale.
 *
 * Pas de framework : l'application construit son arbre à la main. Ces quelques
 * helpers évitent la centaine de `createElement` / `appendChild` qui rendraient
 * les vues illisibles, sans introduire de couche de rendu.
 */

export type Child = Node | string | number | null | undefined | false;

type Attrs = {
  class?: string;
  text?: string;
  html?: string;
  style?: Partial<CSSStyleDeclaration> | string;
  dataset?: Record<string, string>;
  /** Attributs `aria-*`, `role`, `type`, `title`… posés tels quels. */
  attrs?: Record<string, string | number | boolean | null | undefined>;
  on?: Partial<{
    [K in keyof HTMLElementEventMap]: (ev: HTMLElementEventMap[K]) => void;
  }>;
};

/** Crée un élément. `attrs.attrs` accepte `false`/`null` pour ne rien poser. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  if (attrs.class) node.className = attrs.class;
  if (attrs.text !== undefined) node.textContent = attrs.text;
  if (attrs.html !== undefined) node.innerHTML = attrs.html;

  if (typeof attrs.style === "string") {
    node.setAttribute("style", attrs.style);
  } else if (attrs.style) {
    Object.assign(node.style, attrs.style);
  }

  if (attrs.dataset) {
    for (const [k, v] of Object.entries(attrs.dataset)) node.dataset[k] = v;
  }

  if (attrs.attrs) {
    for (const [k, v] of Object.entries(attrs.attrs)) {
      if (v === null || v === undefined) continue;
      if (typeof v === "boolean") {
        // Un attribut ARIA porte la chaîne « true » ou « false » — et `false`
        // doit être écrit, pas omis, sinon l'état n'est pas annoncé et les
        // sélecteurs CSS `[aria-…="true"]` ne distinguent plus rien.
        if (k.startsWith("aria-")) {
          node.setAttribute(k, v ? "true" : "false");
          continue;
        }
        // Attribut booléen HTML : présent vaut vrai, absent vaut faux.
        if (v) node.setAttribute(k, "");
        continue;
      }
      node.setAttribute(k, String(v));
    }
  }

  if (attrs.on) {
    for (const [type, handler] of Object.entries(attrs.on)) {
      node.addEventListener(type, handler as EventListener);
    }
  }

  append(node, children);
  return node;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(
      typeof child === "string" || typeof child === "number"
        ? document.createTextNode(String(child))
        : child,
    );
  }
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Remplace le contenu d'un conteneur d'un coup. */
export function render(parent: Node, ...children: Child[]): void {
  clear(parent);
  append(parent, children);
}

export function frag(...children: Child[]): DocumentFragment {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

/** Bouton — le cas le plus fréquent, avec icône optionnelle avant le libellé. */
export function button(
  label: Child,
  options: {
    class?: string;
    icon?: SVGElement;
    title?: string;
    ariaLabel?: string;
    disabled?: boolean;
    onClick?: () => void;
    attrs?: Attrs["attrs"];
  } = {},
): HTMLButtonElement {
  const node = el(
    "button",
    {
      class: options.class ?? "btn btn-secondary",
      attrs: {
        type: "button",
        title: options.title,
        "aria-label": options.ariaLabel,
        disabled: options.disabled ? true : null,
        ...options.attrs,
      },
      on: options.onClick ? { click: options.onClick } : undefined,
    },
    [options.icon, label],
  );
  return node;
}

/**
 * Interrupteur — un `role="switch"`, pas une case à cocher.
 *
 * Employé là où l'état est binaire et où la seule action possible est de le
 * basculer : le verrou de transfert, DNSSEC, la suppression à l'échéance. Le
 * couple « étiquette + bouton Activer/Désactiver » qu'il remplace demandait de
 * lire deux choses pour savoir une seule.
 *
 * `busy` et `disabled` se désactivent tous les deux, mais pas pour la même
 * raison : `disabled` dit « le registre ne propose pas ça » et s'éteint,
 * `busy` dit « la bascule est en cours » et garde son opacité — sinon une
 * demande acceptée se lit comme une action refusée.
 */
export function switchButton(options: {
  on: boolean;
  ariaLabel: string;
  disabled?: boolean;
  busy?: boolean;
  title?: string;
  onToggle?: () => void;
}): HTMLButtonElement {
  const blocked = options.disabled === true || options.busy === true;
  return el(
    "button",
    {
      class: options.busy ? "switch is-busy" : "switch",
      attrs: {
        type: "button",
        role: "switch",
        "aria-checked": options.on,
        "aria-label": options.ariaLabel,
        title: options.title,
        disabled: blocked ? true : null,
      },
      on: options.onToggle && !blocked ? { click: options.onToggle } : undefined,
    },
    [el("span", { class: "knob" })],
  );
}

/** Une ligne « libellé d'état + interrupteur », telle que la maquette l'aligne. */
export function switchField(label: string, control: HTMLElement): HTMLElement {
  return el("div", { class: "switch-field" }, [
    el("span", { class: "switch-label", text: label }),
    control,
  ]);
}

/** Le logotype : « O.V.H. », avec les points, toujours. */
export function wordmark(options: { class?: string } = {}): HTMLElement {
  const dot = () => el("span", { class: "wordmark-dot", text: "." });
  return el("span", { class: ["wordmark", options.class].filter(Boolean).join(" ") }, [
    el("span", { text: "O" }),
    dot(),
    el("span", { text: "V" }),
    dot(),
    el("span", { text: "H" }),
    dot(),
  ]);
}

/**
 * Découpe un libellé autour d'une sous-chaîne, pour souligner la partie qui a
 * matché une recherche.
 */
export function highlight(label: string, query: string): DocumentFragment {
  if (!query) return frag(label);
  const at = label.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return frag(label);
  return frag(
    label.slice(0, at),
    el("mark", { text: label.slice(at, at + query.length) }),
    label.slice(at + query.length),
  );
}

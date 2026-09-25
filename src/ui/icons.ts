/**
 * Icônes inlinées en SVG.
 *
 * La maquette charge Phosphor depuis unpkg. Une application desktop doit
 * démarrer sans réseau : les quelques icônes réellement utilisées sont donc
 * redessinées ici sur une grille 24×24, au trait, en `currentColor`. Aucun
 * paquet à installer, aucune requête au lancement.
 */

const GEOMETRY = {
  "arrow-clockwise": '<path d="M20 5v5.5h-5.5"/><path d="M18.9 10.6A7.7 7.7 0 1 0 12 19.7"/>',
  "arrow-counter-clockwise": '<path d="M4 5v5.5h5.5"/><path d="M5.1 10.6A7.7 7.7 0 1 1 12 19.7"/>',
  browsers:
    '<rect x="7" y="7" width="13.5" height="12.5" rx="1.4"/><path d="M7 11.2h13.5"/><path d="M17 4.5H4.9A1.4 1.4 0 0 0 3.5 5.9V17"/>',
  camera:
    '<path d="M3.6 8.7h3l1.6-2.5h7.6l1.6 2.5h3a1 1 0 0 1 1 1v8.2a1 1 0 0 1-1 1H3.6a1 1 0 0 1-1-1V9.7a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.8" r="3.3"/>',
  "caret-up-down": '<path d="M8 10.2l4-4 4 4"/><path d="M8 13.8l4 4 4-4"/>',
  check: '<path d="M4.5 12.6 9.3 17.4 19.5 6.8"/>',
  "check-circle": '<circle cx="12" cy="12" r="9"/><path d="M8 12.4l2.9 2.9L16.4 9.4"/>',
  "circle-notch": '<path d="M12 3a9 9 0 1 0 9 9"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.2V12l3.4 2"/>',
  copy: '<rect x="9" y="9" width="11.5" height="11.5" rx="1.4"/><path d="M15 6.4V4.9a1.4 1.4 0 0 0-1.4-1.4H4.9A1.4 1.4 0 0 0 3.5 4.9v8.7A1.4 1.4 0 0 0 4.9 15h1.5"/>',
  cube: '<path d="M12 3 20.5 7.6v8.8L12 21l-8.5-4.6V7.6z"/><path d="M3.5 7.6 12 12.2l8.5-4.6M12 12.2V21"/>',
  database:
    '<ellipse cx="12" cy="6.4" rx="7.5" ry="2.8"/><path d="M4.5 6.4v11.2c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6.4"/><path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/>',
  disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.6"/>',
  "envelope-simple":
    '<rect x="3" y="5.5" width="18" height="13" rx="1.4"/><path d="M3.7 6.5 12 13l8.3-6.5"/>',
  "folder-open":
    '<path d="M3.5 18.4V6.4a1 1 0 0 1 1-1h4.1l2 2.6h6.9a1 1 0 0 1 1 1v1.6"/><path d="M3.5 19l3-8h15l-3 8z"/>',
  "globe-simple":
    '<circle cx="12" cy="12" r="9"/><path d="M3.3 9.4h17.4M3.3 14.6h17.4"/><path d="M12 3c-2.7 3-2.7 15 0 18 2.7-3 2.7-15 0-18z"/>',
  "hard-drives":
    '<rect x="3.5" y="4" width="17" height="6.5" rx="1.4"/><rect x="3.5" y="13.5" width="17" height="6.5" rx="1.4"/><circle cx="16.9" cy="7.25" r=".95" fill="currentColor" stroke="none"/><circle cx="16.9" cy="16.75" r=".95" fill="currentColor" stroke="none"/>',
  key: '<circle cx="9" cy="15" r="4.2"/><path d="m11.9 12 7.6-7.6"/><path d="m16.2 7.3 2.3 2.3"/><path d="m18.6 4.9 2.3 2.3"/>',
  "lock-simple":
    '<rect x="4.5" y="10" width="15" height="10" rx="1.4"/><path d="M8 10V7.6a4 4 0 0 1 8 0V10"/>',
  "magnifying-glass": '<circle cx="10.6" cy="10.6" r="6.6"/><path d="m15.6 15.6 5 5"/>',
  "minus-circle": '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
  "note-pencil":
    '<path d="M20 11V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h6"/><path d="M14 20h2.6l4.9-4.9a1.85 1.85 0 0 0-2.6-2.6L14 17.4z"/>',
  pencil: '<path d="M5 19h3l11-11a2.12 2.12 0 0 0-3-3L5 16z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  prohibit: '<circle cx="12" cy="12" r="9"/><path d="M5.6 18.4 18.4 5.6"/>',
  shuffle:
    '<path d="M14.6 4.5h5v5"/><path d="M4.5 19.5 19.6 4.5"/><path d="M14.6 19.5h5v-5"/><path d="m14.3 14.2 5.3 5.3"/><path d="M4.5 4.5l4.6 4.6"/>',
  "sign-in":
    '<path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5"/><path d="m10 8 4 4-4 4"/><path d="M3 12h11"/>',
  "sign-out":
    '<path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5"/><path d="m17 8 4 4-4 4"/><path d="M9 12h12"/>',
  "terminal-window":
    '<rect x="3" y="4.5" width="18" height="15" rx="1.6"/><path d="M3 9h18"/><path d="m7 12.4 2.4 2.4L7 17.2"/><path d="M12.4 17.2h4.4"/>',
  trash:
    '<path d="M4 7h16"/><path d="M9 7V4.8a.8.8 0 0 1 .8-.8h4.4a.8.8 0 0 1 .8.8V7"/><path d="m6.6 7 .9 12.2a.9.9 0 0 0 .9.8h7.2a.9.9 0 0 0 .9-.8L17.4 7"/>',
  "upload-simple":
    '<path d="M12 16.2V4"/><path d="m7.5 8.5 4.5-4.5 4.5 4.5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  warning:
    '<path d="M12 4.2 21.4 20.4H2.6z"/><path d="M12 10v4.6"/><circle cx="12" cy="17.4" r=".95" fill="currentColor" stroke="none"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  "arrow-right": '<path d="M4 12h15.5"/><path d="m13.8 6 5.7 6-5.7 6"/>',
  "arrow-square-out":
    '<path d="M13.8 4.2h6v6"/><path d="m11.2 12.8 8.6-8.6"/><path d="M19.8 14.6V19a1.4 1.4 0 0 1-1.4 1.4H5.6A1.4 1.4 0 0 1 4.2 19V6.2a1.4 1.4 0 0 1 1.4-1.4h4.5"/>',
  "arrows-clockwise":
    '<path d="M20 4.6v5.2h-5.2"/><path d="M18.8 9.9A7.4 7.4 0 0 0 5.9 7.4"/><path d="M4 19.4v-5.2h5.2"/><path d="M5.2 14.1a7.4 7.4 0 0 0 12.9 2.5"/>',
  "caret-down": '<path d="m6.5 9.6 5.5 5.5 5.5-5.5"/>',
  "caret-up": '<path d="m6.5 14.4 5.5-5.5 5.5 5.5"/>',
  "hand-pointing":
    '<path d="M9.6 11.4V5.9a1.8 1.8 0 0 1 3.6 0v5"/><path d="M13.2 11V9.4a1.7 1.7 0 0 1 3.4 0v1.8"/><path d="M16.6 11.6v-.5a1.7 1.7 0 0 1 3.4 0v4.4a5 5 0 0 1-5 5h-2.3a5 5 0 0 1-3.8-1.8l-3-3.7a1.7 1.7 0 0 1 2.6-2.2l1.7 1.8"/>',
  "hard-drive":
    '<rect x="3" y="7.4" width="18" height="9.2" rx="1.5"/><path d="M3 12h18"/><circle cx="17.3" cy="14.3" r=".95" fill="currentColor" stroke="none"/>',
  "lightbulb":
    '<path d="M9.2 18.4h5.6"/><path d="M10.2 21h3.6"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1 1 1.7v.8h5v-.8c0-.7.4-1.3 1-1.7A6 6 0 0 0 12 3z"/>',
  "link-break":
    '<path d="M10.2 13.8 7.6 16.4a3.6 3.6 0 0 1-5.1-5.1l2.6-2.6"/><path d="m13.8 10.2 2.6-2.6a3.6 3.6 0 0 1 5.1 5.1l-2.6 2.6"/><path d="M13.6 3.4v2.4M20.6 10.4h-2.4M3.4 13.6h2.4M10.4 20.6v-2.4"/>',
  "timer":
    '<circle cx="12" cy="13.6" r="7.4"/><path d="M12 9.6v4l2.6 1.6"/><path d="M9.2 2.8h5.6"/><path d="m18.7 6.7 1.6-1.6"/>',
  "wrench":
    '<path d="M13.6 10.4 5.4 18.6a1.9 1.9 0 0 0 2.7 2.7l8.2-8.2"/><path d="M17.5 12.6a4.4 4.4 0 0 0 3-5.2l-2.6 2.6-2.4-2.4 2.6-2.6a4.4 4.4 0 0 0-5.2 3"/>',
} as const;

export type IconName = keyof typeof GEOMETRY;

export type IconOptions = {
  /** Côté du carré, en pixels. */
  size?: number;
  /** Fait tourner l'icône — réservé à `circle-notch`. */
  spin?: boolean;
  className?: string;
};

/**
 * Construit un `<svg>` détaché. Toujours `aria-hidden` : une icône double un
 * texte ou un `title`/`aria-label` porté par son conteneur, jamais l'inverse.
 */
export function icon(name: IconName, options: IconOptions = {}): SVGSVGElement {
  const { size = 16, spin = false, className } = options;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  if (spin) svg.classList.add("spin");
  if (className) svg.classList.add(...className.split(" ").filter(Boolean));
  svg.innerHTML = GEOMETRY[name];
  return svg;
}

/** Indicateur d'attente : l'anneau qui tourne de la maquette. */
export function spinner(size = 16): SVGSVGElement {
  return icon("circle-notch", { size, spin: true });
}

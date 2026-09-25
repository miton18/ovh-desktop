# Nocturne — valeurs de référence

Design system du projet Claude Design
`b10005ba-590e-44bd-9258-3057195146bd`, fichier
`_ds/nocturne-4fab7934-dece-4733-8733-f683d5ba0d5d/styles.css`.

Le fichier complet n'est pas versionné ici : il se récupère avec l'outil
DesignSync (`method: "get_file"`) sur ce projet. Les valeurs ci-dessous sont
celles qui avaient été reconstruites de mémoire et qui divergeaient — elles sont
notées pour qu'on puisse les revérifier sans refaire l'import.

## Échelle d'espacement

Base **2,8 px**, pas 4 px : `--space-N = N × 2.8px`. Nocturne ne définit que les
paliers 1, 2, 3, 4, 6, 8 (2.8 / 5.6 / 8.4 / 11.2 / 16.8 / 22.4 px) ; les paliers
5, 7, 9, 10 utilisés par nos écrans sont dérivés sur la même base.

## Élévation

Nocturne n'utilise pas d'ombre portée classique : un **liseré plein** porte la
séparation, l'ombre n'apporte que l'ambiance.

```css
--shadow-sm: 0 0 0 1px #3f424d;
--shadow-md: 0 0 0 1px #595d6c, 0 6px 18px rgb(0 0 0 / 0.55);
--shadow-lg: 0 0 0 1px #9397ab, 0 16px 40px rgb(0 0 0 / 0.65);
```

## Rayons

`--radius-sm: 4px` · `--radius-md: 8px` · `--radius-lg: 14px`

## Typographie

Inter. Corps 15 px / 1.55. Titres : h1 42, h2 32, h3 25, h4 20, h5 16, h6 13 px —
h6 en capitales, `letter-spacing: 0.08em`. Interlignage des titres 1.12,
`letter-spacing: -0.015em`.

## Contrôles

`.input` et `.btn-icon` font **36 px** de haut. `.btn` et `.input` partagent
`font-size: 14px` parce qu'ils se côtoient dans les formulaires. `.seg-opt` :
`padding: 7px 12px`, 13 px. `.tag` : 11 px, `padding: 3px 10px`, rayon
`calc(var(--radius-md) * 0.75)`. `.card` : `padding: var(--space-3)`,
`gap: var(--space-2)`. `.card-title` 17 px, `.card-body` 13 px,
`.card-kicker` 10 px / `0.1em`. `.dialog` : `width: min(440px, 100%)`,
rayon `--radius-lg`.

## Signature visuelle

Les filets **libres** s'estompent vers le transparent sur 48 px à chaque
extrémité (`.hr`, règles de lignes de tableau posées sur le `<tr>` pour que le
dégradé couvre toute la largeur). Les contours de boîte, les séparateurs
internes aux contrôles et les marques d'accent courtes restent **pleins**.

## Palette

Celle de Nocturne (accent blurple `#9184d9`) est **remplacée** par le bloc
`<helmet>` de `OVH Console.dc.html` : fond `#141925`, surface `#1f2533`, accent
`#5b8fd6`. C'est cette palette-là qui est l'identité de l'application.

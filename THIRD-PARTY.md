# Composants tiers

Relevé des licences des composants redistribués avec O.V.H. ou liés dans le
binaire, avec les obligations qui en découlent. Audit fait sur l'arbre complet
(`cargo tree`, `npm ls`), pas sur les manifestes de premier niveau.

## Police Inter — SIL Open Font License 1.1

**C'est la seule obligation de redistribution qui pèse réellement sur ce projet.**
Les fichiers de police sont empaquetés dans le bundle de l'application, via
[`@fontsource/inter`](https://www.npmjs.com/package/@fontsource/inter).

> Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)
> This Font Software is licensed under the SIL Open Font License, Version 1.1.

Ce que l'OFL-1.1 impose :

- l'avis de copyright et la licence doivent **accompagner les fichiers de police**
  à chaque redistribution — c'est le rôle de ce fichier, et le texte complet reste
  livré dans `node_modules/@fontsource/inter/LICENSE` ;
- « Inter » est un *Reserved Font Name* : une version modifiée de la police ne peut
  pas conserver ce nom ;
- la police ne peut pas être vendue seule, mais peut l'être empaquetée dans un
  logiciel — ce qui est le cas ici.

Le texte intégral est disponible sur <https://openfontlicense.org/>.

## Dépendances Rust

Aucune dépendance sous GPL, LGPL ou AGPL : le choix de licence du projet est libre.

| Licence | Poids dans l'arbre | Obligation |
|---|---|---|
| MIT | ~1110 occurrences | Conserver l'avis de copyright |
| Apache-2.0 | ~845 occurrences | Conserver les avis, dont `NOTICE` |
| Unicode-3.0, BSD-3-Clause, ISC, Zlib, MIT-0, 0BSD, CC0-1.0, Unlicense | minoritaires | Permissives |
| **MPL-2.0** | `cssparser`, `cssparser-macros`, `selectors`, `dtoa-short`, `option-ext` | Copyleft **par fichier**. Ces crates viennent de la pile GTK/WebKit de Tauri et ne sont que liées : aucune obligation sur la licence d'O.V.H. Si l'un de ces fichiers était modifié, la version modifiée devrait être publiée sous MPL-2.0. |
| CDLA-Permissive-2.0 | `webpki-roots` | Permissive. Contient le magasin de certificats racines de Mozilla. |

## Dépendances JavaScript

| Paquet | Licence |
|---|---|
| `@tauri-apps/api` | Apache-2.0 OR MIT |
| `@tauri-apps/cli` | Apache-2.0 OR MIT |
| `@tauri-apps/plugin-log` | MIT OR Apache-2.0 |
| `@fontsource/inter` | OFL-1.1 (voir ci-dessus) |
| `vite` | MIT |
| `typescript` | Apache-2.0 |

## Ce qui n'est pas un composant tiers

**Les modèles de données.** Ils sont transcrits depuis les schémas JSON que
l'API OVHcloud sert publiquement : noms de champs, types, valeurs d'énumération,
chemins de routes. C'est de l'information d'interface, transcrite pour
interopérer — pas du code recopié. La règle à tenir pour que ça reste vrai :
transcrire l'interface, jamais la prose de la documentation OVHcloud.

**L'algorithme de signature.** Il est décrit dans la documentation publique
d'OVHcloud et réimplémenté ici. Un test le compare à la valeur que produit le SDK
officiel `python-ovh` pour les mêmes entrées ; aucun code de ce SDK n'est repris.

**Le design system.** Les tokens et classes utilitaires viennent d'un projet
Claude Design appartenant à l'auteur de ce dépôt.

# Contribuer à O.V.H.

**Toute contribution est acceptée.** Correction d'un bug, ajout d'un produit
OVHcloud, refonte d'un écran, traduction, documentation, un simple message qui
dit « cet écran ne se comprend pas » : tout est bienvenu, quel que soit ton
niveau et quelle que soit la taille du changement. Il n'y a pas de comité, pas de
CLA, pas de parcours d'initiation.

Il y a une seule attente, et elle n'est pas négociable.

## La règle : on modifie ce qu'on peut tester

**Touche les parties du produit que tu utilises réellement.**

Si tu n'as qu'un VPS chez OVHcloud, tu n'es pas en position de corriger la partie
domaines : tu ne peux pas la tester en situation réelle. Tu ne verras pas qu'un
registre refuse un glue record en IPv6, qu'une zone reste non déployée, qu'une
tâche part en `problem` au bout de quarante secondes. Ton correctif a l'air juste,
il compile, il passe la relecture — et il casse la vie de quelqu'un qui, lui, a
trois cents domaines.

Inversement : si tu as des VPS, tu es la bonne personne pour la partie VPS, et tu
l'es mieux que quiconque ici.

### Pourquoi cette règle

L'API OVHcloud expose 6785 opérations réparties sur 88 sections. Personne — ni
les mainteneurs, ni toi — ne possède tous les produits. Il n'existe donc aucun
environnement où un changement serait testable de bout en bout par une seule
personne, et aucune suite de tests automatisés ne peut remplacer un vrai compte :
les comportements qui comptent viennent des registres, des délais, des états
transitoires et des refus, pas du schéma JSON.

Dans ces conditions, la seule barrière de qualité qui tienne debout est celle-là :
**quelqu'un qui possède le produit a vu le changement fonctionner sur son propre
compte.** C'est plus fiable qu'une relecture attentive, et c'est la raison pour
laquelle on ne demande rien d'autre.

### Ce que ça veut dire concrètement

Dans ta pull request, dis :

1. **quel produit tu possèdes** et qui te rend légitime sur cette partie ;
2. **ce que tu as testé**, avec le déroulé réel — pas « testé OK », mais
   « créé un TXT sur `_dmarc`, TTL 600, publié la zone, vérifié la propagation,
   supprimé » ;
3. **ce que tu n'as pas pu tester** et pourquoi. Une PR qui annonce ses angles
   morts est bien plus facile à accepter qu'une PR qui les cache.

Les captures d'écran et les extraits de logs valent mieux que les affirmations.

### Ce que tout le monde peut modifier

Le socle ne dépend d'aucun produit et se teste sans en posséder :
authentification et signature, client HTTP, gestion des erreurs, trousseau du
système, build et empaquetage, menu et tray, accessibilité, design system,
traductions, documentation. `cargo test --lib` et
`cargo test --test live -- --ignored` couvrent cette partie.

### Si tu ne peux pas tester : ouvre une issue

C'est une contribution, pas un lot de consolation. Un rapport précis sur un
produit que tu utilises — ce que tu as fait, ce que tu attendais, ce que l'écran a
montré, l'identifiant de la tâche s'il y en a une — vaut mieux qu'un correctif à
l'aveugle. C'est souvent ce qui manque le plus.

De même, si tu repères un bug évident dans une partie que tu n'utilises pas :
signale-le, ne le corrige pas. Quelqu'un d'équipé le prendra.

## Mettre en place l'environnement

```bash
npm install
npm run app:dev
```

Prérequis : Rust stable (≥ 1.77.2), Node ≥ 20 et, sous Linux,
`webkit2gtk-4.1`, `libsoup-3`, `gtk3`, `librsvg`, `patchelf`.

L'application embarque une clé d'application OVH : au premier lancement, tu
valides simplement l'accès à ton compte dans le navigateur. Rien à créer.

Si tu préfères ta propre application — pour cloisonner tes essais, ou parce que
tu compiles sans la clé embarquée — crée-la sur
<https://eu.api.ovh.com/createApp/> et renseigne-la dans l'écran de connexion.

La délégation demandée couvre toute l'API EU. Tu peux la révoquer à tout moment
depuis ton compte OVHcloud, et l'application l'oublie avec « Se déconnecter ».

## Avant de proposer un changement

```bash
cd src-tauri
cargo fmt
cargo build                          # doit finir sans aucun warning
cargo test --lib
cargo test --test live -- --ignored   # si ton changement touche le client ou le trousseau
```

Et : **aucun secret dans une PR.** Ni clé d'application, ni consumer key, ni
capture montrant un `X-Ovh-Signature`. `src-tauri/.cargo/config.toml` n'est pas
versionné, c'est volontaire — ne le rajoute pas.

Les commentaires et les messages d'erreur du projet sont en français ; les
identifiants restent en anglais, et les champs sérialisés gardent le nom exact de
l'API OVHcloud.

Si tu écris du code avec un assistant, lis d'abord [AGENTS.md](AGENTS.md) : il
contient les invariants du projet et les pièges de l'API déjà payés une fois.

## Relecture

On relit vite et on dit franchement. Un refus est toujours motivé, et porte sur
le changement, jamais sur la personne. Si un correctif est juste mais non
testable par son auteur, on ne le jette pas : on le garde ouvert le temps que
quelqu'un d'équipé le confirme.

Et si la règle de testabilité te bloque sur quelque chose qui te paraît évident,
dis-le dans l'issue. Une règle qui empêche une bonne correction d'arriver est une
règle à discuter.

---

O.V.H. — « Olès Va Hurler » — est un client tiers, sans lien avec OVHcloud SAS.

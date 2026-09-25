<div align="center">

# O.V.H.

**Une console de management OVHcloud qui se comprend.**

Application desktop — Tauri v2, Rust, TypeScript. Parle directement à l'API publique OVHcloud.

<sub>Client tiers, **sans aucun lien avec OVHcloud SAS**. Les points du nom le distinguent
de la marque officielle. O.V.H. signifie « Olès Va Hurler ».</sub>

</div>

---

## Captures

<!-- Données d'exemple : aucun compte réel n'apparaît sur ces captures. Les
     adresses IP sont dans les plages de documentation RFC 5737 et RFC 3849. -->

![Onglet Zone DNS : cartes de synthèse du domaine, filtres par type
d'enregistrement, état de publication de la zone, et la table des
enregistrements où les lignes pilotées par DynHost sont marquées et
verrouillées.](docs/console-zone.png)

<p align="center"><sub>La zone DNS. L'état de publication est affiché en clair, et les
enregistrements DynHost sont signalés comme tels : ils vivent dans un espace séparé de
l'API et ne se modifient pas ici.</sub></p>

![Onglet Registre : interrupteurs pour la protection contre le transfert, DNSSEC
et la suppression à l'échéance, sélecteur de renouvellement, et la section des
glue records avec les capacités du registre.](docs/console-registry.png)

<p align="center"><sub>Le registre. Chaque réglage est un interrupteur qui reflète l'état
réel, y compris ses états transitoires, et les capacités de l'extension sont affichées
plutôt que devinées.</sub></p>

## Pourquoi

L'API OVHcloud expose 6785 opérations sur 88 sections. Elle est complète, et c'est là le
problème : une console qui l'expose fidèlement expose aussi ses aspérités, et laisse
l'utilisateur les absorber. O.V.H. fait l'inverse — la valeur n'est pas de couvrir l'API,
c'est de rendre une action évidente.

Quatre exemples, tous relevés dans le schéma de l'API et tous visibles dans l'interface :

- **Lister n'existe pas.** `GET /domain/zone/{zone}/record` renvoie un tableau
  d'identifiants, pas d'objets : une zone de 200 enregistrements, c'est 201 requêtes.
  O.V.H. absorbe ce fan-out côté Rust, avec un parallélisme borné, et affiche
  progressivement.
- **Modifier n'est pas publier.** Une modification de zone n'est pas servie tant qu'on n'a
  pas rafraîchi. L'interface assume un état « brouillon » au niveau de la zone, avec le
  nombre de changements en attente et un seul bouton pour publier.
- **Les écritures rendent des tâches**, pas des résultats. Les opérations vivent dans un
  journal visible, et les boutons proposés suivent strictement ce que la tâche autorise.
- **Ce qui est possible dépend de l'extension.** Six drapeaux du registre varient d'un
  domaine à l'autre. Les actions impossibles sont grisées **avec la raison affichée**,
  jamais masquées et jamais proposées pour échouer trente secondes plus tard.

## État d'avancement

Le premier périmètre est **les noms de domaine** : liste, enregistrements DNS, serveurs DNS
et glue records, DynHost, DNSSEC, contacts WHOIS, renouvellement, journal des opérations.
57 commandes côté Rust, toutes câblées sur l'API réelle.

Les autres familles de produits — serveurs dédiés, VPS, hébergements, e-mails — n'existent
que dans le mode « données d'exemple ». Elles attendent quelqu'un qui possède ces produits
et peut les tester : voir [CONTRIBUTING.md](CONTRIBUTING.md).

## Démarrer

Prérequis : Rust stable (≥ 1.77.2), Node ≥ 20, et sous Linux les bibliothèques de WebKitGTK.

```bash
# Arch
sudo pacman -S webkit2gtk-4.1 base-devel curl wget file openssl \
               appmenu-gtk-module libappindicator-gtk3 librsvg

git clone https://github.com/miton18/ovh-desktop
cd ovh-desktop
npm install
npm run app:dev       # Vite + fenêtre Tauri, hot-reload des deux côtés
```

```bash
npm run app:build     # bundle release : AppImage / .deb / .rpm selon la plateforme
```

Le binaire de `target/debug/` charge le serveur Vite (`localhost:1420`) : il lui faut
`npm run dev` en marche. Le binaire release embarque `dist/`.

## Se connecter

L'application embarque une clé d'application OVHcloud : au premier lancement, tu valides
l'accès à ton compte dans le navigateur, et c'est tout.

Le protocole OVH sépare deux choses : l'**application** (clé + secret, qui identifie le
logiciel) et la **consumer key** (qui matérialise ton accord). O.V.H. demande une délégation
sur toute l'API de l'endpoint choisi ; tu peux la révoquer à tout moment depuis ton compte
OVHcloud, et « Se déconnecter » l'oublie localement.

Les trois clés vivent dans le magasin de secrets du système — Keychain sur macOS, Credential
Manager sur Windows, Secret Service (gnome-keyring / KWallet) sur Linux. Sur Linux ce n'est
pas une enclave matérielle : c'est le trousseau de session, chiffré au repos.

### Plusieurs comptes

Un client OVHcloud a souvent plusieurs NIC — personnel, professionnel, un par client quand
on est prestataire. Le menu **Comptes** les liste et bascule de l'un à l'autre d'un clic ;
« Ajouter un compte… » ouvre la gestion complète (créer, renommer, supprimer).

Un compte est la paire **racine + délégation**, parce que les deux sont liées : un NIC
européen n'existe pas sur la racine canadienne. Il y a sept racines, pas trois — OVHcloud
Europe, Canada et US, Kimsufi Europe et Canada, So you Start Europe et Canada — et la racine
se choisit donc au moment de créer le compte qui vivra dessus. Kimsufi et So you Start ne
servent que la branche `/1.0` de l'API, ce que le sélecteur indique.

Chaque compte a sa propre entrée dans le trousseau. Basculer change la racine appelée et
vide le cache : ce qui est affiché appartient toujours au compte actif.

### Ta propre application

**Fichier → Préférences…** permet de remplacer l'application embarquée par la tienne, créée
sur `https://<racine>/createApp/`. Utile pour cloisonner tes essais, faire apparaître tes
appels sous ton compte, ou travailler sur une racine autre que l'européenne — la clé
embarquée n'y est pas valable. L'application vaut pour une racine, pas pour un compte : tous
les comptes d'une même racine la partagent.

Pour compiler avec ta propre clé embarquée, copie
`src-tauri/.cargo/config.toml.example` en `.cargo/config.toml` et renseigne-la. Ce fichier
n'est pas versionné.

## Structure

```
index.html            point de montage du webview
src/
  ovh-api.ts          types métier + commandes du client OVH — le contrat front↔back
  main.ts             routeur des écrans
  styles.css          tokens du design system + palette de l'app
  ui/
    data.ts           unique passage des vues vers ovh-api.ts (cache, erreurs)
    settings.ts       réglages (endpoint, application), ouverts par le menu
    screens/          splash, login, console
    panels/           zone, dynhost, registry, contacts, operations, domain, picker…
design/               maquettes Claude Design + valeurs de référence du design system
docs/                 captures d'écran
scripts/              téléchargement des schémas de l'API
src-tauri/
  tauri.conf.json     fenêtre, CSP, bundling
  capabilities/       permissions accordées à la fenêtre
  src/
    lib.rs            builder Tauri : plugins, state, setup, events fenêtre
    menu.rs tray.rs   menu applicatif, icône système, fermeture vers le tray
    gtk_noise.rs      filtre des messages GLib bruyants du tray (Linux)
    ovh/
      endpoint.rs     les sept racines, leurs branches, leurs contraintes
      embedded_app.rs clé/secret d'application injectés à la compilation
      credentials.rs  résolution + trousseau du système, une entrée par endpoint
      signer.rs       signature des requêtes (+ tests)
      client.rs       appels signés, décalage d'horloge, erreurs API
      auth.rs         parcours de délégation (consumer key)
      domain/         routes /domain et leurs commandes
      models/         modèles de données transcrits des schémas
```

## Tests

```bash
cd src-tauri
cargo test --lib                      # signature, endpoints, encodage — hors réseau
cargo test --test live -- --ignored   # API OVHcloud réelle + trousseau du système
```

La signature des requêtes est comparée à la valeur produite par le SDK officiel
`python-ovh` pour les mêmes entrées : si ce test casse, la régression est ici.

## Contribuer

Toute contribution est acceptée. Une seule attente, expliquée dans
[CONTRIBUTING.md](CONTRIBUTING.md) : **on modifie ce qu'on peut tester**. Personne ne
possède tous les produits OVHcloud, donc la seule barrière de qualité qui tienne est que
quelqu'un qui possède le produit ait vu le changement fonctionner sur son propre compte.

Si tu développes avec un assistant, [AGENTS.md](AGENTS.md) contient les invariants du projet
et les pièges de l'API déjà payés une fois.

## Licence

[Apache-2.0](LICENSE). Choisie pour son article 6, qui refuse explicitement toute
concession de marque : O.V.H. est un client tiers, et la licence le dit noir sur blanc.
Elle apporte aussi une concession de brevet expresse, et elle est compatible avec
l'intégralité de l'arbre de dépendances.

Les composants tiers et leurs obligations sont relevés dans
[THIRD-PARTY.md](THIRD-PARTY.md) — notamment la police Inter, sous SIL Open Font
License 1.1, seule obligation de redistribution qui pèse sur le projet.

# AGENTS.md — développer dans O.V.H.

Ce fichier s'adresse aux agents et assistants qui écrivent du code ici. Il ne
répète pas ce que le code dit déjà : il donne les invariants qu'on ne devine pas
en lisant un fichier isolé, et les pièges déjà payés une fois.

## Le projet en trois phrases

O.V.H. est une console de management OVHcloud alternative : une application
desktop Tauri v2 (Rust + WebView) qui parle directement à l'API publique
OVHcloud. Son objectif est d'être **compréhensible** — la valeur ajoutée n'est
pas de couvrir l'API, c'est de rendre une action évidente. Premier périmètre :
les noms de domaine et les zones DNS.

## Nommage — non négociable

| | |
|---|---|
| Dépôt | `ovh-desktop` |
| Application | **`O.V.H.`** — avec les points, toujours |
| Signification | « Olès Va Hurler » |

Les points ne sont pas une coquetterie : ils distinguent le projet de la marque
OVHcloud. **Ne jamais écrire « OVH » sans les points** pour désigner
l'application, ne jamais retirer la mention de non-affiliation présente dans
`package.json`, `tauri.conf.json` et `README.md`. Pour parler de l'entreprise ou
de son API, en revanche, on écrit bien « OVHcloud » / « l'API OVH ».

## Carte du dépôt

```
index.html                  page unique du webview
src/                        frontend TypeScript (Vite, sans framework)
  ovh-api.ts                types métier + wrappers invoke() du client OVH — LE contrat front↔back
  ui/                       écrans et composants
    data.ts                 unique point d'entrée des vues vers ovh-api.ts (cache, erreurs)
    screens/                splash, login, console
    panels/                 zone, dynhost, registry, contacts, operations, domain
  main.ts                   câblage DOM
design/                     maquettes importées de Claude Design (.dc.html)
scripts/fetch-ovh-schemas.sh  télécharge les schémas de l'API dans schemas/
src-tauri/
  tauri.conf.json           fenêtre, CSP, bundling
  capabilities/default.json permissions accordées à la fenêtre
  src/
    lib.rs                  builder Tauri : plugins, state, setup, events fenêtre
    gtk_noise.rs            filtre de logs GLib (Linux)
    menu.rs tray.rs         menu applicatif, icône système
    ovh/                    tout le client OVHcloud
      domain/api.rs         les routes /domain
      domain/commands.rs    les commandes Tauri correspondantes
      endpoint.rs           racine EU + branches /1.0 /v1 /v2
      embedded_app.rs       clé/secret d'application injectés à la compilation
      credentials.rs        résolution + trousseau du système
      signer.rs             signature des requêtes (+ tests)
      client.rs             appels signés, décalage d'horloge, erreurs API
      auth.rs               parcours de délégation (consumer key)
      commands.rs           commandes Tauri d'authentification
      models/               modèles de données transcrits des schémas
```

## Conventions

- **Les commentaires et messages d'erreur sont en français.** Les identifiants
  Rust/TS restent en anglais, et les champs sérialisés gardent le nom exact de
  l'API OVH (`camelCase` via `#[serde(rename_all = "camelCase")]`).
- Un commentaire explique **pourquoi**, jamais **quoi**. S'il paraphrase la
  ligne suivante, il ne sert à rien.
- `cargo fmt` avant de considérer un changement terminé.
- Pas de `unwrap()` sur une valeur venue du réseau ou du trousseau.

## Ajouter une route de l'API OVH

L'ordre compte : sauter l'étape 4 donne une erreur seulement à l'exécution.

1. **Lire le schéma**, jamais la mémoire :
   `./scripts/fetch-ovh-schemas.sh` puis
   `python3 -c "import json;print(json.load(open('schemas/v1/domain.json'))['models']['domain.zone.Record'])"`.
2. **Transcrire les modèles** dans `src-tauri/src/ovh/models/` en suivant les
   règles de transcription ci-dessous.
3. **Écrire la fonction d'appel** avec `client.call(&creds, Method::GET, "/chemin", None::<&()>)`.
4. **Déclarer la commande** dans `tauri::generate_handler![…]` de `lib.rs`.
5. **Ajouter le wrapper typé** dans `src/ovh-api.ts` — et nulle part ailleurs :
   aucun `invoke("…")` ne doit apparaître dans une vue.

## Règles de transcription des schémas

Chacune a été vérifiée sur le corpus complet de l'API (88 sections, 6785
opérations), pas supposée.

- **`canBeNull` décide de `Option<T>`**, pas `required` — `required` ne concerne
  que les paramètres d'opération, jamais les champs d'un modèle.
- **`readOnly` sépare les types** : un modèle de lecture et un payload
  d'écriture sont deux structures distinctes (`Record` / `RecordCreate` /
  `RecordUpdate`). Ne jamais réutiliser le modèle de lecture pour un `PUT` sous
  prétexte que l'API l'accepte — elle ignore silencieusement les champs en
  lecture seule.
- **`type` pour le mapping, pas `fullType`** : `fullType` porte un alias
  sémantique au format `alias:primitif` (`coreTypes.AccountId:string`), et son
  `:` casse un parseur naïf.
- **Tous les enums passent par `ovh_enum!`** (`models/enum_macro.rs`), qui
  conserve les valeurs inconnues dans une variante `Other(String)`. Ce n'est pas
  de la prudence gratuite : les enums OVH gagnent des valeurs sans préavis, et
  une même enum peut être plus riche dans une section que dans une autre
  (`service.RenewalTypeEnum` gagne `automaticV2024` selon la section,
  `nichandle.OvhSubsidiaryEnum` vaut 16 valeurs dans `/cloud` et 25 dans
  `/newAccount`). Un enum serde classique ferait échouer **toute** la
  désérialisation sur une valeur nouvelle.
- **Deux syntaxes de tableau coexistent** : `X[]` et, dans les maps, le style Go
  `[]X` (`map[string][]iam.resource.TagFilter`).
- **Les génériques s'écrivent de deux façons** selon la section :
  `complexType.UnitAndValue<long>` et `complexType.UnitAndValue_long` sont le
  même type. Normaliser vers un seul type Rust.
- **Les scalaires datés et réseau restent des `String`** (`OvhDate`,
  `OvhDateTime`, `IpAddr`…). L'API mélange les formats ; une date inattendue ne
  doit pas faire échouer la désérialisation de toute la réponse. La conversion
  se fait au point d'usage, où l'on sait quoi faire d'un échec.

## Authentification — ce qu'il ne faut pas casser

La signature vit dans `ovh/signer.rs` et est couverte par un test qui la compare
à la valeur produite par le SDK officiel `python-ovh` pour les mêmes entrées.
**Si ce test casse, la régression est chez nous.**

```
"$1$" + SHA1_HEX(AS + "+" + CK + "+" + METHOD + "+" + URL + "+" + BODY + "+" + TS)
```

Deux pièges, tous deux vérifiés dans le SDK officiel :

- **`URL` est l'URL complète** effectivement appelée — schéma, hôte, branche,
  chemin *et* query string. La documentation OVH appelle ce champ `QUERY`, ce qui
  laisse croire qu'il s'agit de la seule query string. C'est faux.
- **`BODY` doit être les octets exacts envoyés.** D'où la sérialisation unique
  dans `client.rs`, réutilisée pour la signature et pour l'envoi. Sérialiser deux
  fois est le bug classique : deux JSON équivalents mais pas identiques donnent
  une signature invalide.

Le timestamp vient de l'horloge locale corrigée par le décalage mesuré via
`GET /auth/time` — l'API rejette une signature qui dérive de quelques minutes.
Ne jamais signer avec `SystemTime::now()` brut.

**Aucun secret dans le dépôt.** `embedded_app.rs` lit la clé et le secret par
`option_env!` à la compilation. Ne jamais remplacer ces `option_env!` par des
littéraux, ne jamais logger un secret : `credentials::Redacted` existe pour ça.

## Pièges de l'API OVH qui se voient dans l'interface

Ces contraintes-là décident de la forme des écrans. Les ignorer produit une
interface qui ment à l'utilisateur.

- **Lister n'existe pas.** `GET /domain/zone/{zone}/record` renvoie un tableau
  d'identifiants, pas d'objets : 200 enregistrements = 201 requêtes. Prévoir
  cache et affichage progressif ; utiliser les filtres serveur `fieldType` /
  `subDomain`, qui réduisent réellement le nombre d'appels.
- **Modifier n'est pas publier.** Une modification de zone attend un
  `POST …/refresh`. `ZoneStatus.isDeployed` dit si ce qui est affiché est ce qui
  est servi.
- **Les écritures rendent des tâches**, pas des résultats. `canAccelerate`,
  `canCancel`, `canRelaunch` décident des boutons réellement proposables.
- **`POST …/nameServers/update` remplace toute la liste.** Un serveur omis est
  un serveur supprimé.
- **`RecordUpdate` n'a pas de `fieldType`** : changer le type d'un
  enregistrement impose suppression puis création, donc un nouvel identifiant.
- **`changeContact` ne touche pas le propriétaire** (procédure de trade chez le
  registre), et les données personnelles d'un contact ne sont pas dans le
  domaine — celui-ci ne porte que des identifiants.
- **DynHost est un second jeu d'enregistrements**, absent de `GET …/record`.
- **Ce qui est possible dépend de l'extension** : `hostSupported`,
  `glueRecordIpv6Supported`, `glueRecordMultiIpSupported`, `owoSupported`,
  `dnssecSupported`, `ZoneCapabilities.dynHost`. Griser avec la raison affichée
  plutôt que masquer, et ne jamais proposer une action que le registre refusera.

## Comptes et racines

**Un compte = une racine + une délégation.** Les deux sont liées : un NIC européen n'existe
pas sur la racine canadienne. Trois conséquences à ne pas casser :

- le trousseau range l'**application** par racine (`app:<endpoint>`) et la **consumer key**
  par compte (`account:<id>`) — ce sont deux natures différentes, l'une identifie le
  logiciel, l'autre l'utilisateur ;
- basculer de compte change l'endpoint du client **et** doit vider le cache : afficher les
  domaines d'un compte sous le nom d'un autre est le pire bug possible ici ;
- le menu applicatif liste les comptes : toute mutation du registre passe par
  `mutate_registry`, qui persiste **et** reconstruit le menu. Un menu qui diverge du registre
  propose de basculer vers un compte supprimé.

L'application embarquée a été créée sur la racine EU : `Endpoint::accepts_embedded_application`
la refuse ailleurs, et l'interface doit alors demander une application à l'utilisateur.

## Permissions Tauri v2

Tauri refuse par défaut tout ce qui n'est pas listé dans
`src-tauri/capabilities/default.json`. **Une API de plugin qui « ne marche pas »
alors que le plugin est enregistré est presque toujours une permission
manquante** — c'est le premier endroit à regarder, avant de douter du code.

## Listes : le fan-out est déjà fait

Toutes les routes de liste de l'API renvoient `long[]` ou `string[]`, jamais des
objets. `domain/api.rs::fetch_all` résout ces identifiants avec un parallélisme
borné à 8 — au-delà, l'API répond 429. Ne jamais refaire cette boucle
séquentiellement côté interface, et ne jamais relever la borne sans mesurer.

## Commandes

```bash
npm run app:dev                       # Vite + fenêtre Tauri, hot-reload des deux côtés
npm run app:build                     # bundle release
OVH_APPLICATION_KEY=… OVH_APPLICATION_SECRET=… npm run app:build   # avec l'app embarquée

cd src-tauri
cargo build                           # doit finir sans warning
cargo fmt
cargo test --lib                      # signature + vecteurs de contrôle
cargo test --test live -- --ignored    # API OVH réelle + trousseau du système
```

Le binaire `target/debug/` charge `devUrl` (localhost:1420) : il lui faut Vite en
marche. Le binaire release embarque `dist/`.

## Ce qui est vérifié, et ce qui ne l'est pas

À dire explicitement dans tout rapport de travail, sans arrondir :

- `cargo build`, `cargo fmt`, `cargo test --lib`, `npx tsc --noEmit` : à lancer
  systématiquement.
- `cargo test --test live -- --ignored` sort de la machine (API OVH réelle,
  trousseau du système) — préciser s'il a été lancé.
- Une transcription de modèle se vérifie contre `schemas/`, pas de mémoire.
- Un appel authentifié ne peut pas être vérifié sans credentials valides. Si tu
  n'en as pas, **dis-le** au lieu d'affirmer que la route fonctionne.

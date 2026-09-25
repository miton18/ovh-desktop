# Hébergement web — brief de conception

Modèle de données et contraintes d'interface pour le second périmètre d'O.V.H.
Pendant de « Zone & Registre » (domaines).

Relevé le 25 septembre 2026 sur `eu.api.ovh.com`, sections `/hosting/web` (v1) et
`/webhosting` (v2). Tous les comptages viennent des schémas, pas d'une estimation.

---

## 00 — Deux API pour le même produit

OVHcloud réécrit l'hébergement web sous `/webhosting` en branche v2, pendant que
tout le monde utilise `/hosting/web` en v1.

| | v1 `/hosting/web` | v2 `/webhosting` |
|---|---|---|
| Opérations | **205** | 15 |
| En production | **190** | 3 |
| En bêta | 7 | 12 |
| Dépréciées | 8 | 0 |
| Chemins | 155 | 12 |
| Modèles | 234 | 57 |

La v2 couvre la liste des hébergements, leurs domaines attachés, leurs
certificats, le *spoofing*, et un objet `website`. Elle n'a **aucune** base de
données, aucun utilisateur FTP, aucun cron, aucune variable d'environnement,
aucun runtime, aucun log. Une suppression et deux créations sur l'ensemble.

Son modèle est pourtant meilleur — un `website` de première classe avec ses
domaines, là où la v1 empile des `attachedDomain`. C'est une réécriture à
surveiller, pas à adopter : **on construit sur la v1**.

---

## 01 — L'hébergement

`hosting.web.ServiceWithIAM` · `GET|PUT /hosting/web/{serviceName}`

La fiche porte de quoi faire un en-tête utile sans un seul appel supplémentaire.

**Identité & état**

| Champ | Type | | Rôle |
|---|---|---|---|
| `serviceName` | string | | Identifiant de l'hébergement |
| `displayName` | string | null | Nom donné par le client — **à préférer à `offer` pour titrer** |
| `offer` | OfferEnum | | 88 valeurs, dont des codes historiques illisibles |
| `state` | StateEnum | | Actif, bloqué, en maintenance |
| `primaryLogin` | string | | Compte FTP principal |
| `home` | string | | Racine des fichiers |
| `defaultAttachedDomain` | string | null | Le site servi à la racine |

**Quotas** — quatre valeurs, toutes en `complexType.UnitAndValue<double>`

| Champ | | Rôle |
|---|---|---|
| `quotaSize` / `quotaUsed` | `quotaUsed` nullable | Disque |
| `trafficQuotaSize` / `trafficQuotaUsed` | nullable | Trafic sortant, absent sur certaines offres |

**Infrastructure**

| Champ | Type | | Rôle |
|---|---|---|---|
| `cluster` / `filer` / `datacenter` | string | | Où vit l'hébergement — utile au support |
| `hostingIp` / `hostingIpv6` | ipv4 · ipv6 | null | Les IP à mettre dans une zone DNS |
| `clusterIp` / `clusterIpv6` | ipv4 · ipv6 | null | IP du cluster, distinctes des précédentes |
| `operatingSystem` | enum | | Linux ou Windows |
| `phpVersions` | PhpVersion[] | | Chaque entrée porte `version` et `support` |

**Capacités — pilotent l'affichage**

| Champ | | Rôle |
|---|---|---|
| `hasCdn` | null | Le CDN est inclus dans l'offre |
| `hasHostedSsl` | null | Certificat hébergé disponible |
| `multipleSSL` | | Plusieurs certificats autorisés |
| `availableBoostOffer` | | Montées en puissance proposables |
| `boostOffer` / `recommendedOffer` | null | Boost actif, et suggestion d'OVHcloud |
| `serviceManagementAccess` | | Points d'accès de gestion |
| `updates` | | Mises à jour en attente |

---

## 02 — Les multisites

`hosting.web.AttachedDomain` · `GET|POST|PUT|DELETE …/attachedDomain/{domain}` — 15 ops

L'écran le plus utilisé d'un hébergement mutualisé, et le seul du périmètre dont
l'écriture **touche une autre section de l'API** : la zone DNS.

**Tous les champs sont modifiables et tous sont nullables**, y compris `domain`
et `path`. C'est inhabituel : le formulaire doit imposer ses propres obligations,
l'API ne les portera pas.

| Champ | Type | Rôle |
|---|---|---|
| `domain` | string | Domaine ou sous-domaine à servir |
| `path` | string | Dossier servi, relatif à `home` |
| `ssl` | boolean | Inclure ce domaine dans le certificat |
| `runtimeId` | long | Quelle configuration d'exécution sert ce domaine |
| `firewall` | enum | `active` ou `none` |
| `cdn` | enum | Idem — dépend de `hasCdn` sur l'hébergement |
| `ownLog` | string | Domaine sur lequel isoler les logs |
| `ipLocation` | CountryEnum | 14 pays. Change l'IP servie pour ce domaine |
| `bypassDNSConfiguration` | boolean | **À `false`, l'API modifie la zone DNS** |

---

## 03 — Utilisateurs FTP & SSH

`hosting.web.user` · `GET|POST|PUT|DELETE …/user/{login}` — 6 ops (+ 2 pour les clés SSH)

Deux états distincts qu'il ne faut pas confondre : le compte est-il ouvert, et
a-t-il le droit au SSH.

| Champ | Type | | Rôle |
|---|---|---|---|
| `login` | string | | Identifiant FTP et SSH |
| `home` | string | W | Dossier racine de cet utilisateur |
| `state` | enum | W | `rw` ou `off` — le compte est-il actif |
| `sshState` | enum | W | `active`, `sftponly` ou `none` |
| `isPrimaryAccount` | boolean | | Le compte principal ne se supprime pas |
| `serviceManagementCredentials` | ServiceCredentials | | Deux entrées : `ftp` et `ssh` |

Le mot de passe ne figure nulle part dans le modèle : il se pose à la création et
se change par une route dédiée. Comme pour DynHost, il n'est **jamais relisible**.

---

## 04 — Les bases de données

`hosting.web.database` · `GET|POST|DELETE …/database/{name}` — 21 ops (+ 3 dumps, + 6 SQL perso)

| Champ | Type | | Rôle |
|---|---|---|---|
| `name` | string | | Ex. `mydb.mysql.db` |
| `type` / `version` | enum | | 5 moteurs, 26 versions |
| `versionSupport` | enum | | `stable` · `beta` · `deprecated` |
| `databaseServiceDeprecated` | boolean | | Le service lui-même est déprécié |
| `state` / `status` | enum | | Deux états distincts : santé et opération en cours |
| `quotaSize` / `quotaUsed` | UnitAndValue | | Quota par base, indépendant du disque |
| `server` / `port` / `user` | string · long | null | De quoi composer une chaîne de connexion |
| `guiURL` | string | null | phpMyAdmin ou équivalent |
| `dumps` | long | | Nombre de sauvegardes disponibles |
| `mode` | enum | | `classic`, `besteffort`, `module` |
| `taskId` | long | null | Une opération est en cours sur cette base |

Une base en MySQL 5.6 dépréciée mérite un avertissement visible, pas une ligne de
tableau comme les autres.

**Sauvegardes** — `hosting.web.database.dump` : trois types seulement (`now`,
`daily.1`, `weekly.1`), et chacune porte une **`deletionDate` automatique**. C'est
une date de péremption, elle doit se voir.

---

## 05 — Ce qui s'exécute

**Runtime** — `hosting.web.runtime`, 6 ops. La configuration qu'un multisite
référence par `runtimeId` : `type` (16 valeurs : `phpfpm-8.0`, `nodejs-14`…),
`appEnv`, `publicDir`, `appBootstrap`, `isDefault`, `isDeletable`.

**Cron** — `hosting.web.Cron`, 5 ops. `command`, `frequency` au format crontab,
`language` (27 valeurs), `email` pour recevoir `stderr`, `description` libre. Le
champ `frequency` est une chaîne brute : la validation est à notre charge.

**Variables d'environnement** — `hosting.web.EnvVar`, 5 ops. `key` en lecture
seule, `value` typée **`password`** — l'API la marque comme secrète, donc elle ne
s'affiche pas en clair, même pour une variable de type `string`. `type` vaut
`string`, `integer` ou `password`.

---

## 06 — Les tâches

`hosting.web.task` et `hosting.web.PublicTask` — **deux noms de modèle pour une
structure identique**, mêmes huit champs. Les routes utilisent l'un ou l'autre
sans logique apparente : un seul type suffit côté client.

| Champ | Type | | Rôle |
|---|---|---|---|
| `id` | long | | Identifiant de la tâche |
| `function` | FunctionEnum | | **≈190 valeurs.** À grouper par préfixe, pas à traduire une à une |
| `objectType` | enum | null | 27 valeurs : sur quoi porte la tâche |
| `objectId` | string | null | Permet de rattacher la tâche à la ligne concernée |
| `status` | enum | | `init` → `todo` → `doing` → `done` |
| `startDate` / `lastUpdate` / `doneDate` | datetime | les deux derniers null | |

Pas de `canAccelerate` ni `canCancel`, contrairement aux tâches de domaine :
**une tâche d'hébergement ne s'annule pas**. Aucun bouton d'action dessus.

---

## 07 — Les états à représenter

**`hosting.web.StateEnum`** (6) — état de l'hébergement, et une faute
d'orthographe historique dans l'API :
`active` · `maintenance` · `blocked` · `bloqued` · `hardBlocked` · `hardBloqued`
→ les deux graphies existent, il faut gérer les deux.

**`database.StatusEnum`** (10) — opération en cours :
`created` · `creating` · `deleting` · `checking` · `dumping` · `importing` ·
`optimizing` · `restoring` · `updating` · `locked`

**`database.StateEnum`** (3) : `ok` · `readonly` · `close`
**`SupportedVersionEnum`** (3) : `stable` · `beta` · `deprecated`

**`user.StateEnum`** (2) : `rw` · `off`
**`user.SshStateEnum`** (3) : `active` · `sftponly` · `none`
→ deux notions séparées, à ne pas fusionner en un seul interrupteur.

**`hostedssl.StatusEnum`** (5) : `created` · `creating` · `importing` ·
`regenerating` · `deleting`
**`task.StatusEnum`** (5) : `init` · `todo` · `doing` · `done` · `cancelled`

---

## 08 — Ce que l'API impose à l'interface

### Déjà connu du périmètre domaines

**Les listes ne rendent que des identifiants.** `attachedDomain`, `user`,
`database`, `cron`, `envVar`, `tasks` rendent toutes `string[]` ou `long[]`.
→ Exactement le défaut des zones DNS. Le fan-out borné déjà écrit s'applique tel
quel.

**Les écritures rendent des tâches.** Créer un multisite, une base, un
utilisateur : la réponse est une tâche, pas un résultat.
→ Le suivi d'opérations existe. Mais ici **rien ne s'annule** : pas de bouton.

### Propre à l'hébergement

**Attacher un domaine modifie la zone DNS.** `bypassDNSConfiguration` à `false`
— le défaut — fait écrire l'API dans la zone du domaine, qui vit dans une autre
section.
→ L'annoncer avant de valider, et proposer le contournement pour un domaine dont
le DNS est ailleurs. Une modification invisible dans un autre écran est
exactement ce qu'on veut éviter.

**Trois façons de dire « PHP 8.0 ».** `Service.phpVersions` donne `8.0`,
`runtime.type` donne `phpfpm-8.0`, `cron.language` donne `php8.0`.
→ Normaliser à l'affichage, sinon le même hébergement semble proposer trois
choses différentes. Et ne jamais comparer ces chaînes entre elles.

**88 codes d'offre, dont des fossiles.** `start1m`, `perso2014`, `deproxxl2012`,
`hostingAtScaleX128`…
→ Titrer avec `displayName` quand il existe, sinon afficher le code brut. Ne
jamais tenter une table de correspondance.

**Les quotas ne sont pas des nombres.** Quatre valeurs sur l'hébergement et deux
par base sont des `UnitAndValue<double>` : une unité accompagne le nombre, et
elle n'est pas la même partout.
→ Convertir avant de comparer ou de tracer une jauge. Un pourcentage calculé sur
deux unités différentes est faux sans prévenir.

**L'API dit elle-même ce qui est périmé.** `versionSupport` par base,
`databaseServiceDeprecated`, `PhpVersion.support`, `recommendedOffer`.
→ C'est l'information la plus utile de tout le périmètre, et la console
officielle l'enterre. La remonter en tête plutôt qu'en colonne.

**Rien de ce qui protège n'est relisible.** Le mot de passe d'un utilisateur FTP
n'existe pas dans le modèle ; `EnvVar.value` est typée `password` quel que soit
son `type` déclaré.
→ Même traitement que les identifiants DynHost : affichage unique à la création,
valeurs copiables, jamais de champ pré-rempli qui ferait croire qu'on peut
relire.

---

## Hors périmètre proposé

`cdn` (25 ops) · `localSeo` (13) · `module` · `website` · et toute la zone des
logs : `userLogs` est dépréciée à 100 % et `log` entièrement en bêta.

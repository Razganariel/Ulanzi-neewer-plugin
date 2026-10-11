# Session du 2026-09-28 — diagnostic Bluetooth RGB62

Compte rendu de la soirée dedicated à la validation physique du plugin. Le
résultat principal est **négatif pour noble et positif pour le diagnostic** : on
sait désormais exactement où le blocage se situe, et on l'a prouvé par
opposition entre deux clients sur la même lampe à la même seconde.

---

## 1. Objectif

Faire valider physiquement le plugin Ulanzi NEEWER : un lien BLE direct par
lampe, un nombre illimité d'appareils, une lampe sélectionnable par action.
Cible : `F4:9F:7F:53:F0:B8` (`NEEWER-RGB62`).

## 2. Environnement

| | |
|---|---|
| Projet | `D:\Projets\Ulanzi-neewer-plugin` |
| Release active | `%AppData%\Ulanzi\UlanziDeck\Plugins\com.ulanzi.ulanzistudio.neewer.ulanziPlugin` |
| Node | `C:\Program Files (x86)\Ulanzi Studio\nodejs\node.exe` — v20.12.2 |
| Pile BLE | `@stoprocent/noble` (addon natif `NobleWinrt`, WinRT) |
| Carte | Intel(R) Wireless Bluetooth(R) |
| Build | npm-free, `scripts/build.mjs` |

Les tests BLE ne peuvent pas être exécutés depuis les sources : elles n'ont pas
de `node_modules`. Il faut passer par la release installée.

---

## 3. Ce qui est validé physiquement

| Élément | Statut | Preuve |
|---|---|---|
| Opcode HSL `0x86` + trame `hslFrame(0, 100, 50)` | **validé** | la lampe est devenue rouge (matin) |
| Connexion BLE | **validé, fiable** | 26–51 ms, de façon répétée |
| Découverte des services | **validé, fiable** | 4 services en ~1,1 s |
| Écriture GATT + abonnement | **validé** | le matin, écritures acceptées et `subscribe` OK |
| Trame d'identité `0x05` | **observé** | `78 05 07 F4 9F 7F 53 F0 B8 64 F5` |
| Caractéristiques GATT | **jamais via noble** | timeout systématique de 15–30 s |
| Couleurs, luminosité, CCT, veille, rallumage | **non validés** | aucun test n'a pu aller jusqu'à l'écriture |

La trame d'identité se décode : opcode `0x05`, 6 octets d'adresse MAC, puis un
octet de niveau (`64` = 100). Seul `0x05` a été observé ; **la lampe n'accuse
pas** les commandes écrites, donc seule l'observation physique compte.

---

## 4. Le blocage, isolé par opposition

Même PC, même lampe, même seconde, deux clients :

| | noble | WinRT natif |
|---|---|---|
| Connexion | 51 ms | — |
| `GetGattServices` / `discoverServicesAsync` | `Success`, 4 services | `Success`, 4 services |
| **Caractéristiques** | **timeout 30 s** | **`Success`, 1,1 s** |
| Contrôle de la lampe | impossible | OK (via le Control Center) |

WinRT natif a renvoyé exactement les caractéristiques attendues :

```
00001800-…            1 carac.
69400001-…            carac statut=Success
   69400002-…         WriteWithoutResponse, Write
   69400003-…         Notify
7f510004-…            carac statut=Success
   7f510005-…         WriteWithoutResponse, Write
   7f510006-…         WriteWithoutResponse, Write
```

**Conclusion de la première soirée — REMISE EN CAUSE, voir § 11.** J'écrivais
alors : « le défaut est dans la liaison noble/WinRT ». C'était trop affirmatif, et
la reprise du 2026-09-29 l'a infirmé. La formulation est conservée telle quelle
pour tracer l'erreur de raisonnement, pas pour être suivie.

> **Révision du 2026-09-29, à lire avant d'agir.** La liaison noble a découvert
> les caractéristiques **deux fois** sur cette machine — hier 07:50 (connexion +
> GATT + écriture + abonnement, la lampe est devenue rouge) et hier 20:30
> (5 caractéristiques lues). Un binding cassé ne fonctionne pas du tout.
> Le « positif » invoqué ci-dessus, la lecture WinRT, portait sur le **cache** GATT,
> lampe déconnectée : elle ne dit rien d'un accès GATT en direct. La seule
> conclusion tenable est plus modeste : *l'accès aux caractéristiques échoue
> depuis hier 21:24, sans cause identifiée*. Voir § 11.

Le pont WinRT a été piloté depuis PowerShell :

```powershell
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$dev = Await ([Windows.Devices.Bluetooth.BluetoothLEDevice]::FromBluetoothAddressAsync([uint64]0xF49F7F53F0B8)) ([Windows.Devices.Bluetooth.BluetoothLEDevice])
$dev.GetGattServicesAsync()          # -> Success
$s.GetCharacteristicsAsync()         # -> Success
```

> L'adresse attendue par WinRT est `0xF49F7F53F0B8` (l'ordre de la clé de
> registre), et non l'ordre inversé que noble affiche. S'y tromper donne
> « appareil introuvable » alors que la lampe est là.

## 5. L'insensibilité du défaut

Le timeout de découverte des caractéristiques a survécu à **tout** :

- cycle d'alimentation de la lampe (débranchement 30 s puis rebranchement) ;
- appairage Windows de la lampe ;
- redémarrage du service `bthserv` (ou redémarrage du poste) ;
- 5 cycles propres `connexion → GATT → déconnexion` ;
- scan arrêté ou scan actif, aucun effet ;
- 406 événements `discover` en 20 s (20/s), aucun effet sur la connexion.

Il faut donc arrêter de le chercher côté configuration.

> **Prudence sur la lecture WinRT** : l'énumération characteristics a réussi
> **lampe déconnectée**, depuis le cache GATT que Windows tient pour l'appareil
> appairé. Cela prouve que noble est en défaut pour lire la base GATT ; cela ne
> prouve pas encore que WinRT sait ouvrir une liaison et écrire. Voir § 9.

## 6. Le modèle d'annonce, enfin compris

La RGB62 diffuse **en continu tant qu'elle est alimentée et libre**, et se tait
**complètement dès qu'un client la tient** :

- scan pendant que le Control Center tient la liaison : **0 annonce sur 150 s** ;
- scan quand elle est libre : annonces régulières, `-62 dBm`.

La seule fenêtre de connexion possible est donc celle où la lampe diffuse. Une
annonce n'est pas un indice de disponibilité : c'est l'inverse, c'est
*exactement* la disponibilité.

---

## 7. Hypothèses réfutées (à ne pas re-tester)

Chacune a été formulée, testée, puis invalidée par la mesure.

| Hypothèse | Test | Résultat |
|---|---|---|
| L'inondation d'événements `discover` sature la boucle et empêche le `connect` | 406 événements en 20 s avant connexion | **Réfutée** : connexion en 26 ms |
| Les tentatives ratées empoisonnent le serveur GATT de la lampe | alimentation neuve, puis un seul contact | **Réfutée** : GATT échoue quand même |
| Il faut un cycle d'alimentation entre chaque test | débranchement 30 s + rebranchement | **Réfutée** : aucun effet |
| Il faut appairer la lampe | appairage via Paramètres Windows | **Réfutée** : GATT échoue toujours |
| Il faut redémarrer la pile Bluetooth | `Restart-Service bthserv` | **Réfutée** : GATT échoue toujours |
| Un timeout plus long suffit | 60 s de patience | **Réfutée** : échec à 60 s comme à 15 s |
| `discoverCharacteristicsAsync` est mal appelé | il vit sur `Service`, pas sur `Peripheral` | **Erreur de ma part, corrigée** — mais le timeout persiste |
| L'appairage Windows est requis | `Get-PnpDevice` après usage du Control Center | **Réfutée** : aucune trace de la lampe dans Windows, et le plugin a fonctionné sans |

### Faits utiles acquis au passage

- `peripheral.connectAsync()` **ouvre le lien mais résout à `undefined`**. D'où
  les anciens `Peripheral already connected`. Il faut passer par
  `adapter.connectAsync(address)`, depuis la boucle de scrutation, jamais depuis
  le callback `discover`.
- L'appairage en headless est impossible depuis Node : WinRT répond
  `RequiredHandlerNotRegistered` (il faut une interface de confirmation).
- L'adresse WinRT est en little-endian : `0xF49F7F53F0B8`.
- Le MTU remonte à `23` (valeur par défaut, sans vraie négociation).
- noble émet chaque événement **en double** (`mtu` ×2, `servicesDiscover` ×2) :
  défaut de la liaison, sans gravité.
- L'appairage réalisé dans Paramètres Windows permet à WinRT de lire la base
  GATT **depuis son cache, lampe déconnectée**. À l'inverse
  `FromBluetoothAddressAsync` renvoie « introuvable » sans appairage préalable.

---

## 8. Modifications apportées au code

1. **`_huntAndConnect()` — une tentative par annonce.** Le compteur `seen`
   n'était jamais remis à zéro : après un échec il restait vrai, et la boucle
   reconnectait à chaque tic sans qu'aucune annonce soit parue entre-temps.
   Corrigé via `claimAttempt(seen, attempted)`, extrait dans
   `plugin/service/core/hunt.js` pour être testable (`ble.js` importe noble au
   chargement et ne l'est donc pas depuis les sources).
2. **`trace.js` — plafond enfin réel.** Le drapeau `rotated` n'autorisait
   qu'une rotation par processus : au-delà, le fichier pouvait repartir
   indéfiniment. La vérification est désormais faite à chaque écriture.
3. **README — suppression des affirmations fausses** : « diffuse par salves »,
   « ne jamais arrêter le scan avant de connecter », « l'appairage est
   recommandé », référence à `_ensureManager()` (supprimé du code).
4. **`tests/hunt.test.js`** — 5 tests verrouillant la règle une-tentative-par-
   annonce. Total : **38/38**.

---

## 9. Ce qu'il reste à faire

Le transport doit quitter `noble`. Ce n'est pas une correction, c'est une
réécriture, mais **le périmètre est étroit** : tout le reste du plugin est
terminé et intact (registre multi-appareils, sélection par action, Property
Inspector, cache, trace, tests).

### Piste recommandée

Un petit processus .NET (ou une passerelle Node/WinRT) qui :

1. ouvre la liaison via `BluetoothLEDevice` + `RequestPreferredConnectionAsync` ;
2. résout la caractéristique d'écriture `69400002-…` depuis le cache GATT que
   Windows tient déjà pour l'appareil appairé ;
3. écrit les trames existantes de `protocol.js` — **aucun changement de format
   n'est nécessaire**, l'opcode HSL est validé ;
4. relaie les notifications `69400003-…` vers le service Node.

`ble.js` garde alors son interface publique et l'API des actions ne bouge pas.

### Le seul angle mort restant

Il n'a pas été prouvé que WinRT **ouvre une liaison et écrit réellement** vers
la lampe. Le cache GATT explique la *lecture*, pas l'*écriture*. C'est la
première chose à vérifier demain, et elle ne demande rien à l'utilisateur : un
écrit `GattValue` depuis PowerShell, et regarder si la lampe change de couleur.

### Procédure de test, à faire dans cet ordre

1. UlanziStudio **et** Control Center fermés.
2. Un seul script : `connexion → GATT → 8 étapes`, 8 s d'intervalle.
3. **Une seule tentative.** Si ça rate, on s'arrête et on le dit.
4. Ne jamais armer de vigie en arrière-plan : une tentative ratée coûte un
   cycle de plus sur une pile déjà fragile.

### Limites connues non résolues

- La rotation de trace est corrigée mais non testée sur une session longue.
- Les effets FX restent non vérifiés sur la RGB62.
- Pas de groupes : une touche par lampe.
- Validation des 3 lampes physiques toujours à faire.

---

## 10. Note de méthode

Deux erreurs de procédure ont coûté cher ce soir et méritent d'être notées :

- une vigie a été armée **sans prévenir l'utilisateur**, malgré une consigne
  explicite de signaler avant tout test. Le test qui en a découlé a été
  inexploitable et a consumé un cycle de connexion de plus ;
- une dizaine de connexions ont été émises sur une pile déjà fragile, sur la
  base d'hypothèses qui se sont toutes révélées fausses.

La leçon retenue : face à un client BLE dont l'état est inconnu, **une seule
tentative, un seul contact, et un signalement avant de lancer quoi que ce soit**.

---

## 11. Reprise du 2026-09-29

### Rappel de méthode

La question posée au début de cette reprise — *« les tentatives ratées ont-elles
pollué le raisonnement ? »* — était juste, et la réponse est **oui**. Quatre
hypothèses de plus sont tombées, dont celle qui portait tout le diagnostic
précédent.

### Résultats bruts

| Essai | Résultat |
|---|---|
| Redémarrage complet du PC, lampe neuve, processus neuf | connexion **54 ms**, GATT **timeout** |
| Scan sain | 8 appareils, 296 annonces en 20 s, dont 52 pour la lampe |
| Délai d'attente après l'annonce : 0 / 1 / 2 / 3 / 5 s | échec dans les six cas |
| Scan actif pendant la connexion | échec |
| Scan arrêté avant la connexion | échec |
| Contrôle Center | pilote toujours la lampe |

### Hypothèses de plus infirmées

| Hypothèse | Verdict |
|---|---|
| La pile Windows était corrompue, un redémarrage la viderait | **Réfutée** : GATT échoue après redémarrage complet |
| On connecte trop tôt après l'annonce | **Réfutée** : aucun délai de 0 à 5 s ne change rien |
| Le scan doit rester actif pendant la connexion | **Réfutée** dans les deux sens |
| Une découverte ciblée contourne le blocage de la découverte globale | **Réfutée** : une caractéristique demandée seule expire pareil |

### Le point qui fait pencher la balance

La pile se dégrade par séries : après une salve de tentatives, la lampe continue
d'annoncer mais refuse toute liaison, et le lien ne revient qu'après un cycle
d'alimentation. C'est ce comportement, et lui seul, qui explique que la découverte
GATT ait fonctionné deux fois — en début de session, sur un état sain — puis
plus jamais. Mais un cycle d'alimentation **ne restaure pas** la découverte, ce qui
invalide l'idée d'un simple verrou côté lampe.

### Ce qui restait réellement non mesuré

Un seul chose : **un accès GATT WinRT en direct**, hors cache. Jamais réalisé. Il
fallait pour cela un exécutable WinRT compilé, donc le SDK .NET, absent de la
machine (`dotnet` présent sans SDK, pas de `Windows.winmd`). La projection
PowerShell ne sait pas exprimer `GattValue` et n'expose pas
`RequestPreferredConnectionAsync`.

Tant que cette mesure manque, aucune conclusion sur l'origine du défaut n'est
défendable, et en particulier **la réécriture du transport n'est pas justifiée**.

---

## 12. Levée du verrou : WinRT natif marche, noble est coupable

### La mesure manquante a été faite

Le SDK .NET a été installé (`winget install Microsoft.DotNet.SDK.8`, 8.0.425), ce
qui a permis d'écrire un utilitaire WinRT minimal. Premier constat : la machine
possédait déjà les en-têtes C++/WinRT et MSVC — `Windows.winmd` n'a jamais été le
verrou. Un exécutable C++/WinRT autonome a donc pu être produit **sans .NET**, ce
qui a permis de supprimer cette dépendance du plugin.

### Résultats

Le même programme, exécuté plusieurs fois sur la lampe `F4:9F:7F:53:F0:B8`,
donne à chaque fois :

| Étape | Résultat |
|---|---|
| `BluetoothLEDevice.FromBluetoothAddressAsync` | OK |
| `GetGattServicesAsync` | **4 services**, ~1 s |
| `GetCharacteristicsAsync` | **2 caractéristiques** |
| `69400002` | `WriteWithoutResponse, Write` |
| `69400003` | `Notify` |
| Écriture du frame | **Success** |

Les **8 trames** du protocole (`on`, `off`, RGB, blanc, CCT) ont été validées
physiquement par ce chemin, puis revalidées à l'identique par le binaire C++. Le
Contrôle Center et `nlink` lisent et écrivent sans difficulté.

### La comparaison décisive

Sur la **même lampe**, dans la **même seconde**, noble a été retesté après le
succès natif :

```
scan   -> F4:9F:7F:53:F0:B8  NEEWER-RGB62
connect-> Neewer device F4:9F:7F:53:F0:B8 not found
          (Connect ... timed out after 12000 ms)
```

La connexion native avait pris **416 ms**. Il ne s'agit donc pas d'une dégradation
de la pile Windows ni d'un verrou côté lampe : **la panne est dans la couche
noble/WinRT**, et le remplacement du transport était justifié.

### Deux erreurs de diagnostic corrigées au passage

- L'adresse affichée par le watcher (`F4:9F:7F:53:F0:B8`) est la valeur 64 bits
  **big-endian** de la valeur brute `0000F49F7F53F0B8`. Un `formatAddress`
  LSB-first produisait l'adresse inversée et faussait les rapprochements.
- L'octet de niveau des notifications **varie** pour une même lampe (`64`, `F0`,
  `41`, `1E`) : c'est un compteur et non un état physique. Attention à ne pas le
  confondre avec le dernier octet : la trame d'identité fait **11 octets**
  (`78 05 07` + adresse sur 6 + niveau + checksum) et son **checksum final est
  valide** sur chacun des quatre relevés. Une confusion sur ce point fit rejeter à
  tort des notifications parfaitement bien formées.

### Décision et conséquence

`noble` est retiré. `ble.js` délègue désormais à `native/nlink.exe`, exécutable
C++/WinRT embarqué dans `plugin/native/`, piloté par un protocole de ligne
(`scan`/`open`/`write`/`close`/`status`) via `core/native.js`.

Conséquence assumée : `FromBluetoothAddressAsync` **exige l'appairage Windows**.
Le repli `pairAsync` de l'ancien transport a disparu ; il est devenu un prérequis
documenté. L'app discover-to-address est le seul point réellement perdu.

Tests : **33/33** (les 5 tests de `hunt.js`, devenu inutile, ont été supprimés).
Release : **1635 fichiers / 16,0 Mo → 82 fichiers / 0,56 Mo**. La validation
multi-appareils reste à faire : une seule lampe était disponible.

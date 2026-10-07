# Neewer RGB Control — plugin Ulanzi D200X

Pilote une **Neewer RGB62** (et les autres lampes studio Neewer protocol `0x78` : RGB660, SL-80, GL1…) en **Bluetooth Low Energy** directement depuis les touches et la molette du **Ulanzi D200X**.

L'application « Neewer Control Center » n'est **pas** nécessaire : le plugin parle directement au module BLE de la lampe.

---

## 1. Ce que fait le plugin

| Action | Touche | Molette | Réglages |
|---|---|---|---|
| **Neewer Power** | allumer / éteindre / basculer | — | comportement au appui |
| **Neewer Brightness** | preset suivant | luminosité, pas 5 % | min / max / pas / wrap / presets |
| **Neewer Hue** | preset suivant | teinte, pas 10° | pas / presets |
| **Neewer Saturation** | retour à 100 % | saturation 0-100 %, pas 5 | pas |
| **Neewer CCT** | scène suivante | température, pas 250 K | min / max / pas / wrap / scènes |
| **Neewer Scan** | scanne et apparie la lampe | compteur de devices | durée, filtre |

Un état unique est partagé par toutes les touches : l'icône et l'affichage de la molette reflètent toujours la valeur réelle en cache.

## 2. Protocole utilisé

Protocole BLE Neewer « `0x78` », documenté publiquement (reverse engineering du RGB660 PRO, repris par `neewerlite` qui liste explicitement la RGB62).

- Service GATT : `69400001-b5a3-f393-e0a9-e50e24dcca99`
- Écriture : `69400002-b5a3-f393-e0a9-e50e24dcca99`
- Notification : `69400003-b5a3-f393-e0a9-e50e24dcca99`
- Dernier octet = somme des octets précédents tronquée à 8 bits

| Commande | Trame | Vérifié par les tests |
|---|---|---|
| Marche | `78 81 01 01 FB` | oui |
| Arrêt | `78 81 01 02 FC` | oui |
| Couleur HSL | `78 86 04 <teinte> <overflow> <sat> <bri> <chk>` | oui (2 captures) |
| Température CCT | `78 87 02 <bri> <K/100> <chk>` | oui |

Il n'existe pas de trame « luminosité seule » : un changement de luminosité renvoie la trame du mode courant (HSL ou CCT), comme le fait l'app.

## 3. Prérequis

- **Windows 10 build 15063+** ( Creators Update )
  → le transport utilise l'API WinRT via `plugin/native/nlink.exe`, un exécutable C++/WinRT embarqué. C'est la contrainte la plus importante.
- Un **adaptateur Bluetooth LE** actif (presque tous les PC modernes en ont un).
- La lampe doit être **appairée dans Windows** : `BluetoothLEDevice.FromBluetoothAddressAsync` n'ouvre que les périphériques connus de l'OS. Le Control Center s'en passe car il découvre la lampe par advertisement ; nous non plus, et c'est un choix assumé.
- **Node.js 20+ pour construire le plugin** — pas npm. UlanziStudio embarque son propre Node (20.12.2) qui exécute le service principal, et le build détecte le Node de l'hôte si besoin :
  ```powershell
  & "C:\Program Files (x86)\Ulanzi Studio\nodejs\node.exe" scripts\build.mjs
  ```
- UlanziStudio **3.0.11+** ; le pilotage de la molette utilise les commandes d'affichage V3.1 (**3.3.0+**), et se dégrade proprement sur les versions antérieures.

## 4. Construction

```bash
npm run sdk          # télécharge les SDK officiels Ulanzi dans ./sdk
npm run build        # assemble release/com.ulanzi.ulanzistudio.neewer.ulanziPlugin
npm test             # tests du protocole et du résolveur de versions
```

`npm run build` vérifie le `manifest.json` (segments d'UUID, icônes, pages d'inspection), vérifie que chaque `src`/`href` des pages d'inspection existe bien dans le dossier produit, puis installe la dépendance d'exécution `ws` :

- si `npm` est présent, il est utilisé ;
- sinon `scripts/install-deps.mjs` télécharge les tarballs sur le registre public et les extrait dans `node_modules/`, sans npm ni git. L'arbre produit est identique.

> `npm run sdk` télécharge `plugin-common-node` et `plugin-common-html` séparément : dans le dépôt `UlanziDeckPlugin-SDK` ces deux répertoires sont des **sous-modules git**, donc l'archive principale les livre vides.

> Le dossier `plugin/` est la source ; `sdk/`, `release/` et `node_modules/` sont générés.

> `node_modules/` ne contient plus que `ws` (~1 Mo). Le transport BLE est un exécutatif C++/WinRT précompilé dans `plugin/native/nlink.exe` (226 Ko) : ni runtime .NET, ni addon npm, ni chaîne de compilation chez l'utilisateur.

### Reconstruire le transport natif

`plugin/native/nlink.cpp` est la source de `nlink.exe`. Elle se compile avec Visual Studio Build Tools et le SDK Windows (C++/WinRT) :

```powershell
& "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
cl /nologo /EHsc /std:c++20 /O2 /MT nlink.cpp /link windowsapp.lib user32.lib /OUT:nlink.exe
```

## 5. Installation

Copier le dossier complet `release/com.ulanzi.ulanzistudio.neewer.ulanziPlugin` (le nom vient de l'`UUID` du manifeste) dans :

| OS | Chemin |
|---|---|
| Windows | `%AppData%\Ulanzi\UlanziDeck\Plugins` |
| macOS | `~/Library/Application Support/Ulanzi/UlanziDeck/Plugins` |

Redémarrer UlanziStudio. Le plugin apparaît dans la liste, avec 4 actions.

## 6. Enregistrer des lampes

Le plugin ne pilote pas un nombre fixe de lampes : la liste est ouverte, et **chaque instance d'action choisit la lampe qu'elle contrôle**.

1. Poser l'action **Neewer Scan** sur une touche et l'ouvrir dans l'inspecteur de propriétés.
2. *Add* sur la lampe trouvée dans *Found devices* — ou saisir l'adresse dans *Manual* puis *Add*.
   - **1 seule** lampe trouvée au scan → elle est enregistrée et liée à cette touche automatiquement.
   - **aucune** lampe nommée NEEWER → les autres devices à portée sont listés sous *Other devices*, une lampe peut diffuser sans annoncer son nom.
3. Renommer chaque lampe dans *Registered lights* pour les distinguer (le nom sert aussi d'étiquette sur les touches).
4. Sur les actions **Power**, **Brightness** et **Colour**, choisir la lampe dans *Device*.
   - *Default device* = la première lampe enregistrée ; utile quand on n'a qu'une lampe et qu'on ne veut pasMultiplier les réglages.
5. *Forget* retire une lampe du registre. Les réglages des touches qui la visaient retombent sur la lampe par défaut.

L'état, la reconnexion et la luminosité sont **par lampe** : un lien BLE propre à chaque fixture, chacun avec sa propre file d'écriture. Le scan, lui, passe par un transport jetable pour ne pas casser les liens des autres lampes.

> L'app Neewer et le plugin ne peuvent pas être connectés en même temps : le module BLE de la lampe accepte un seul client. Fermer l'app avant d'utiliser le D200X.
>
> Si la lampe n'apparaît pas dans le scan, elle n'est plus alimentée : débrancher/rebrancher son alimentation. Attention, une absence d'annonce ne signifie pas qu'un client est déjà lié. Mesuré sur une RGB62 le 2026-09-28 : alimentée et libre, elle diffuse en continu ; liée à un client, elle n'émet **aucune** annonce (0 sur 150 s). L'annonce n'est donc pas un indice de disponibilité, c'est la seule fenêtre pendant laquelle la connexion est possible.

## 7. Débogage

Lancer UlanziStudio avec les flags de debug (clic droit sur le raccourci → Propriétés → *Cible*, sous Windows) :

```
"C:\...\Ulanzi Studio.exe" --log --webRemoteDebug --nodeRemoteDebug
```

- **Log du service principal** : `%AppData%\Ulanzi\UlanziStudio\logs\com.ulanzi.ulanzistudio.neewer.log` (le nom du fichier est l'UUID du service principal)
- **Inspecteurs de propriétés** : `http://localhost:9292` liste tous les WebView HTML chargés
- **Service Node** : `manifest.json` contient déjà `"Inspect": "--inspect=127.0.0.1:9212"` ; ouvrir `chrome://inspect` dans Chrome et ajouter la cible `127.0.0.1:9212`
- **Trames BLE** : chaque trame émise est tracée dans le log, ex. `tx 78860458011864D7`
- **Trace complète** : `%AppData%\Ulanzi\UlanziDeck\logs\com.ulanzi.ulanzistudio.neewer.trace.log`, chaque trame websocket dans les deux sens. Le fichier tourne à 8 Mo puis est mis en rotation (2 générations conservées) : sans plafond, une longue session produit un gigaoctet de bruit.
- **Transport natif indisponible** : si `nlink.exe` est absent ou refuse de démarrer, le message d'erreur explicite apparaît dans le log et nomme le chemin attendu. Vérifier la présence de `native/nlink.exe` dans le dossier du plugin et la build Windows.
- **Aucun contrôle de l'état de la radio avant le scan** : `nlink.exe` ne teste pas l'adaptateur, il tente le scan. Un scan vide signifie « rien vu pendant la fenêtre », pas forcément « radio éteinte ».

## 8. Limites connues

- **RÉSOLU — le transport est natif.** `noble` ne parvenait pas à découvrir les caractéristiques de la RGB62 alors que WinRT énumérait les mêmes services et caractéristiques sans difficulté. La cause était la couche noble, pas la lampe ni Windows. `nlink.exe` (C++/WinRT) prend désormais le relais ; les 8 trames du protocole ont été validées physiquement par ce chemin. Voir `docs/session-2026-09-28-bluetooth.md`.
- **L'appairage Windows est requis.** Contrepartie directe du passage à `FromBluetoothAddressAsync` : la lampe doit être connue de l'OS. C'est la seule limite introduite par ce transport.
- La **validation multi-appareils reste à faire** : l'architecture est en place (un lien et une file d'écriture par lampe), mais une seule RGB62 a été testée.
- Le **retour d'état** dépend des notifications de la lampe. Si la RGB62 n'en émet pas, l'état est celui de la dernière commande envoyée (cache local) — c'est suffisant pour l'usage au daily mais ce n'est pas une lecture de la valeur physique.
- Les **effets FX** (Cop Car, Candlelight, Hue Loop…) ne sont pas exposés : les trames longues correspondantes n'ont pas été vérifiées sur la RGB62. Le module `protocol.js` a la place pour les ajouter (`OP.EFFECT`).
- Il n'y a **pas de groupes** : chaque touche se lie à une seule lampe. Un même preset n'est donc pas appliqué à toutes les lampes d'un coup, il faut une touche par lampe.
- **La RGB62 diffuse en continu tant qu'elle est alimentée et libre**, et se tait complètement dès qu'un client la tient. Elle ne « diffuse pas par salves » : le motif inverse avait été mal interprété pendant longtemps, parce que le seul état où la lampe se tait est précisément celui où il est normal qu'elle se taise.
- Trame d'identité émise par la lampe à l'ouverture du lien, relevée en conditions réelles :
  `78 05 07 F4 9F 7F 53 F0 B8 64 F5` → opcode `0x05`, 7 octets de charge utile : l'adresse MAC sur 6 octets puis un octet de niveau, et le checksum final. La structure est sur **11 octets** et le dernier octet est bien un checksum valide — c'est l'octet de niveau qui varie d'un envoi à l'autre (`64`, `F0`, `41`, `1E` relevés successivement), ce qui en fait un compteur, pas un checksum. Seul `0x05` a été observé ; la lampe **n'accuse pas** les commandes écrites.

## 9. Arborescence

```
plugin/                             source du plugin
  manifest.json                     4 actions, UUID 4 segments, Node.js (CodePath .js)
  package.json                      type: module + dépendance ws
  native/
    nlink.cpp                       transport BLE C++/WinRT (source)
    nlink.exe                       transport BLE compilé (embarqué dans la release)
  service/                          service principal
      app.js                          routage des événements hôte
      core/
        constants.js                  UUID, GATT, limites, timing
        protocol.js                   trames 0x78 (pur, testé)
        native.js                     client du protocole de ligne de nlink.exe
        ble.js                        transport natif : scan, connexion, écriture, notifications
        light.js                      session d'une lampe : état + superviseur de reconnexion
        devices.js                    registre des lampes (liste ouverte) + scan partagé
        ui.js                         setStateIcon / setFeedback tolérants aux anciennes versions
    actions/                        un module par action (render / onRun / onDialRotate)
  property-inspector/
    shared.js, shared.css           bootstrap commun des pages, sélecteur de lampe
    <action>/inspector.html         une page + un script par action
scripts/
  install-sdk.mjs                   télécharge les SDK officiels (sans git)
  build.mjs                         assemblage + validation + npm install
tests/protocol.test.js              tests unitaires sur les octets
tests/deps.test.js                  résolveur semver npm-free
tests/devices.test.js               registre multi-lampes (avec light stub, sans radio)

sdk/                                généré : ulanzi-api/, common-html/
release/                            généré : com.ulanzi.ulanzistudio.neewer.ulanziPlugin/
```

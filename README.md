# Neewer RGB Control — plugin Ulanzi D200X

Pilote une **Neewer RGB62** (et les autres lampes studio Neewer protocol `0x78` : RGB660, SL-80, GL1…) en **Bluetooth Low Energy** directement depuis les touches et la molette du **Ulanzi D200X**.

L'application « Neewer Control Center » n'est **pas** nécessaire : le plugin parle directement au module BLE de la lampe.

---

## 1. Ce que fait le plugin

| Action | Touche / molette | Réglages |
|---|---|---|
| **Power** | touche : tout / allumer / éteindre | comportement au appui |
| **Brightness** | molette : luminosité | min / max / pas / bornes / presets |
| **Brightness Up** · **Down** | touche : un cran | pas |
| **Hue** | molette : teinte, pression = preset suivant | pas / presets |
| **Hue Presets** | touche : parcourt les couleurs | liste de couleurs |
| **Hue Up** · **Down** | touche : un cran de teinte | pas |
| **Saturation** | molette : saturation | min / max / pas / presets |
| **Saturation Up** · **Down** | touche : un cran | pas |
| **CCT** | molette : température, pression = scène suivante | min / max / pas / bornes |
| **CCT Presets** | touche : parcourt les scènes | liste de scènes |
| **CCT Up** · **Down** | touche : un cran de température | pas |
| **Scan** | touche : apparie une lampe | durée, filtre |

Chaque action est indépendante : une instance est liée à une lampe par son réglage *Device*, et les actions d'une même lampe partagent son état en cache.

> **Ce que le deck affiche est votre dernière commande, pas une mesure de la lampe.** Ces lampes ne se lisent pas : voir §8, c'est une contrainte du matériel, pas un réglage.

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

Redémarrer UlanziStudio. Le plugin apparaît dans la liste, avec 16 actions.

## 6. Enregistrer des lampes

Le plugin ne pilote pas un nombre fixe de lampes : la liste est ouverte, et **chaque instance d'action choisit la lampe qu'elle contrôle**.

1. Poser l'action **Scan** sur une touche et l'ouvrir dans l'inspecteur de propriétés.
2. *Add* sur la lampe trouvée dans *Found devices* — ou saisir l'adresse dans *Manual* puis *Add*.
   - **1 seule** lampe trouvée au scan → elle est enregistrée et liée à cette touche automatiquement.
   - **aucune** lampe nommée NEEWER → les autres devices à portée sont listés sous *Other devices*, une lampe peut diffuser sans annoncer son nom.
3. Renommer chaque lampe dans *Registered lights* pour les distinguer (le nom sert aussi d'étiquette sur les touches).
4. Sur **toutes** les actions, choisir la lampe dans *Device*.
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

### La lampe ne se lit pas : le plugin ne connaît que ses propres commandes

C'est la limite la plus importante du plugin, et elle n'est pas contournable par une modification de code. Tout ce que le deck affiche vient de **la dernière commande envoyée**, mémorisée par lampe ; rien ne vient de la lampe.

**Ce qui a été vérifié sur une RGB62 réelle, le 2026-10-09 :**

| Voie de lecture | Résultat |
|---|---|
| Trame de lecture dans le protocole | **inexistante** — le protocole n'a que des écritures : marche `0x81`, couleur `0x86`, température `0x87`, effets `0x88` |
| Commande `status` du transport natif | ne renvoie que l'état de la **liaison BLE**, pas celui de la lampe |
| Trame `0x05` que la lampe envoie seule à l'ouverture | l'octet de niveau vaut **100 lampe allumée comme lampe éteinte**, et sur un redémarrage il n'est **pas livré du tout** |
| Réglage de la lampe avec ses propres boutons | **aucune notification** émise, la lampe ne publie rien |

Les notifications `0x81` (marche/arrêt) n'arrivent qu'en **réponse à une commande** : sur une session de 39 s sans aucune commande, l'état n'a pas bougé d'un cran, et le premier `arrêt` observé est arrivé 430 ms après une pression.

**Conséquences concrètes :**

- Si vous réglez la lampe **avec ses boutons ou avec l'app Neewer**, le deck ne l'apprend pas. Il affichera votre dernière commande, pas l'état physique.
- La touche Power montre ce que vous avez demandé en dernier, pas ce que la lampe fait réellement.
- Le plugin **n'écrit rien à la connexion** : il n'allume ni n'éteint votre lampe au démarrage.
- L'état mémorisé est **par lampe**, restauré au démarrage. Au premier lancement après l'installation, et tant que vous n'avez rien commandé, les valeurs par défaut s'appliquent — elles ne viennent pas de la lampe.
- Les crans de molette qui dépassent une borne **s'arrêtent** (luminosité, saturation) au lieu de revenir à l'autre extrémité : une molette à 100 % ne fait plus tomber la lampe à 5 %. Le réglage *Wrap* de l'inspecteur permet de revenir au balayage circulaire. La teinte et la température continuent de boucler, ces grandeurs étant cycliques par nature.

### Autres limites

- **Le transport est natif.** `noble` ne parvenait pas à découvrir les caractéristiques de la RGB62 alors que WinRT énumérait les mêmes services et caractéristiques sans difficulté. La cause était la couche noble, pas la lampe ni Windows. `nlink.exe` (C++/WinRT) prend désormais le relais ; les 8 trames du protocole ont été validées physiquement par ce chemin. Voir `docs/session-2026-09-28-bluetooth.md`.
- **L'appairage Windows est requis.** Contrepartie directe du passage à `FromBluetoothAddressAsync` : la lampe doit être connue de l'OS. C'est la seule limite introduite par ce transport.
- La **validation multi-appareils reste à faire** : l'architecture est en place (un lien, une file d'écriture et un état mémorisé par lampe), mais une seule RGB62 a été testée.
- Les **effets FX** (Cop Car, Candlelight, Hue Loop…) ne sont pas exposés : les trames longues correspondantes n'ont pas été vérifiées sur la RGB62. Le module `protocol.js` a la place pour les ajouter (`OP.EFFECT`).
- Il n'y a **pas de groupes** : chaque touche se lie à une seule lampe. Un même preset n'est donc pas appliqué à toutes les lampes d'un coup, il faut une touche par lampe.
- **La RGB62 diffuse en continu tant qu'elle est alimentée et libre**, et se tait complètement dès qu'un client la tient. Elle ne « diffuse pas par salves » : le motif inverse avait été mal interprété pendant longtemps, parce que le seul état où la lampe se tait est précisément celui où il est normal qu'elle se taise.
- Trame d'identité émise par la lampe à l'ouverture du lien, relevée en conditions réelles :
  `78 05 07 F4 9F 7F 53 F0 B8 64 F5` → opcode `0x05`, 7 octets de charge utile : l'adresse MAC sur 6 octets puis un octet de niveau, et le checksum final. La structure est sur **11 octets** et le dernier octet est un checksum valide. L'octet de niveau a varié d'un envoi à l'autre (`64`, `F0`, `41`, `1E` relevés en 2026-09) mais **il ne reflète ni la marche ni la luminosité** : en 2026-10 il valait `64` (=100) lampe allumée et éteinte, et n'était pas livré sur un redémarrage. Il n'est donc exploité par le plugin que comme un fait de format, jamais comme un état.
- Seul `0x05` a été observé en émission spontanée ; la lampe **n'accuse pas** les commandes écrites par un opcode distinct.


## 9. Arborescence

```
plugin/                             source du plugin
  manifest.json                     16 actions, UUID 4 segments, Node.js (CodePath .js)
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

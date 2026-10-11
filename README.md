# Neewer RGB Control — plugin Ulanzi D200X

Drives a **Neewer RGB62** (and the other Neewer studio lights speaking the `0x78` protocol: RGB660, SL-80, GL1…) over **Bluetooth Low Energy**, straight from the keys and the dial of the **Ulanzi D200X**.

The « Neewer Control Center » app is **not** required: the plugin talks to the light's BLE module directly.

**Français**

Pilote une **Neewer RGB62** (et les autres lampes studio Neewer protocol `0x78` : RGB660, SL-80, GL1…) en **Bluetooth Low Energy** directement depuis les touches et la molette du **Ulanzi D200X**.

L'application « Neewer Control Center » n'est **pas** nécessaire : le plugin parle directement au module BLE de la lampe.

---

<br>
<table>
  <tr>
    <td align="center"><img src="docs/ulanzi-icon.jpg" height="96" alt="Ulanzi"></td>
    <td align="center"><a href="https://ko-fi.com/razganariel"><img src="docs/Hibou-Ko-fi.png" height="96" alt="Ko-fi"></a></td>
  </tr>
</table>
<br>

---

## 1. What the plugin does / Ce que fait le plugin

| Action | Key / dial — Touche / molette | Settings — Réglages |
|---|---|---|
| **Power** | key: toggle / on / off — touche : bascule / allumer / éteindre | press behaviour — comportement au appui |
| **Brightness** | dial: brightness — molette : luminosité | min / max / step / bounds / presets — min / max / pas / bornes / presets |
| **Brightness Up** · **Down** | key: one step — touche : un cran | step — pas |
| **Hue** | dial: hue, press = next preset — molette : teinte, pression = preset suivant | step / presets — pas / presets |
| **Hue Presets** | key: walks the colours — touche : parcourt les couleurs | colour list — liste de couleurs |
| **Hue Up** · **Down** | key: one hue step — touche : un cran de teinte | step — pas |
| **Saturation** | dial: saturation — molette : saturation | min / max / step / presets — min / max / pas / presets |
| **Saturation Up** · **Down** | key: one step — touche : un cran | step — pas |
| **CCT** | dial: temperature, press = next scene — molette : température, pression = scène suivante | min / max / step / bounds — min / max / pas / bornes |
| **CCT Presets** | key: walks the scenes — touche : parcourt les scènes | scene list — liste de scènes |
| **CCT Up** · **Down** | key: one temperature step — touche : un cran de température | step — pas |
| **Scan** | key: pairs a light — touche : apparie une lampe | duration, filter — durée, filtre |

Every action is independent: an instance is bound to one light through its *Device* setting, and the actions of a given light share its cached state.

> **What the deck shows is your last command, not a measurement of the light.** These lights cannot be read: see §8. That is a property of the hardware, not a setting.

**Français**

Chaque action est indépendante : une instance est liée à une lampe par son réglage *Device*, et les actions d'une même lampe partagent son état en cache.

> **Ce que le deck affiche est votre dernière commande, pas une mesure de la lampe.** Ces lampes ne se lisent pas : voir §8, c'est une contrainte du matériel, pas un réglage.

## 2. Protocol used / Protocole utilisé

Neewer BLE protocol "`0x78`", publicly documented (reverse engineering of the RGB660 PRO, picked up by `neewerlite`, which lists the RGB62 explicitly).

- GATT service: `69400001-b5a3-f393-e0a9-e50e24dcca99`
- Write: `69400002-b5a3-f393-e0a9-e50e24dcca99`
- Notification: `69400003-b5a3-f393-e0a9-e50e24dcca99`
- Last byte = sum of the preceding bytes, truncated to 8 bits

| Command — Commande | Frame — Trame | Verified by tests — Vérifié par les tests |
|---|---|---|
| On — Marche | `78 81 01 01 FB` | yes — oui |
| Off — Arrêt | `78 81 01 02 FC` | yes — oui |
| HSL colour — Couleur HSL | `78 86 04 <hue> <overflow> <sat> <bri> <chk>` | yes, 2 captures — oui, 2 captures |
| CCT temperature — Température CCT | `78 87 02 <bri> <K/100> <chk>` | yes — oui |

There is no "brightness only" frame: a brightness change resends the current mode's frame (HSL or CCT), exactly as the app does.

Temperature travels in **one byte of 100 K**: the light only knows multiples of 100 K, and 2550 K does not exist. A dial or key step must therefore be a multiple of 100 — 250 K is not, and adding 250 to 2500 gives 2750, which the frame rounds, so the light lands somewhere the dial never announced. The steps offered are 100, 200, 500 and 1000 K, and a finer step left over from an older panel falls back to 200 K rather than being silently rounded.

**Français**

Protocole BLE Neewer « `0x78` », documenté publiquement (reverse engineering du RGB660 PRO, repris par `neewerlite` qui liste explicitement la RGB62).

- Service GATT : `69400001-b5a3-f393-e0a9-e50e24dcca99`
- Écriture : `69400002-b5a3-f393-e0a9-e50e24dcca99`
- Notification : `69400003-b5a3-f393-e0a9-e50e24dcca99`
- Dernier octet = somme des octets précédents tronquée à 8 bits

Il n'existe pas de trame « luminosité seule » : un changement de luminosité renvoie la trame du mode courant (HSL ou CCT), comme le fait l'app.

La température voyage en **un octet de 100 K** : la lampe ne connaît que les multiples de 100 K, et 2550 K n'existe pas. Un pas de molette ou de touche doit donc être un multiple de 100 — 250 K ne l'est pas, et ajouter 250 à 2500 donne 2750, que la trame arrondit : la lampe atterrit ailleurs que là où la molette l'annonçait. Les pas proposés sont 100, 200, 500 et 1000 K, et un réglage plus fin enregistré par erreur retombe sur 200 K plutôt que d'arrondir en silence.

## 3. Prerequisites / Prérequis

- **Windows 10 build 15063+** (Creators Update)
  → the transport uses the WinRT API through `plugin/native/nlink.exe`, an embedded C++/WinRT binary. This is the most important constraint.
- An active **Bluetooth LE adapter** (almost every modern PC has one).
- The light must be **paired in Windows**: `BluetoothLEDevice.FromBluetoothAddressAsync` only opens devices the OS already knows. The Control Center gets away without that because it discovers the light by advertisement; so do we, and it is a deliberate choice.
- **Node.js 20+ to build the plugin** — no npm needed. UlanziStudio ships its own Node (20.12.2), which runs the main service; the build falls back to the host's Node if it has to:
  ```powershell
  & "C:\Program Files (x86)\Ulanzi Studio\nodejs\node.exe" scripts\build.mjs
  ```
- UlanziStudio **3.0.11+**; the dial readout uses the V3.1 display commands (**3.3.0+**) and degrades cleanly on older versions.

**Français**

- **Windows 10 build 15063+** (Creators Update)
  → le transport utilise l'API WinRT via `plugin/native/nlink.exe`, un exécutable C++/WinRT embarqué. C'est la contrainte la plus importante.
- Un **adaptateur Bluetooth LE** actif (presque tous les PC modernes en ont un).
- La lampe doit être **appairée dans Windows** : `BluetoothLEDevice.FromBluetoothAddressAsync` n'ouvre que les périphériques connus de l'OS. Le Control Center s'en passe car il découvre la lampe par advertisement ; nous non plus, et c'est un choix assumé.
- **Node.js 20+ pour construire le plugin** — pas npm. UlanziStudio embarque son propre Node (20.12.2) qui exécute le service principal, et le build détecte le Node de l'hôte si besoin :
  ```powershell
  & "C:\Program Files (x86)\Ulanzi Studio\nodejs\node.exe" scripts\build.mjs
  ```
- UlanziStudio **3.0.11+** ; le pilotage de la molette utilise les commandes d'affichage V3.1 (**3.3.0+**), et se dégrade proprement sur les versions antérieures.

## 4. Build / Construction

```bash
npm run sdk          # downloads the official Ulanzi SDKs into ./sdk
npm run build        # assembles release/com.ulanzi.ulanzistudio.neewer.ulanziPlugin
npm test             # protocol bytes, version resolver, and behaviour of the whole plugin
```

`npm run build` checks the `manifest.json` (UUID segments, icons, inspector pages), checks that every `src`/`href` of the inspector pages resolves inside the output, parses every shipped module, checks that the declared version is the same in every file, then installs the single runtime dependency, `ws`:

- if `npm` is available it is used;
- otherwise `scripts/install-deps.mjs` downloads the tarballs from the public registry and extracts them into `node_modules/`, with neither npm nor git. The resulting tree is identical.

> `npm run sdk` downloads `plugin-common-node` and `plugin-common-html` separately: in the `UlanziDeckPlugin-SDK` repository those two directories are **git submodules**, so the main archive ships them empty.

> `plugin/` is the source; `sdk/`, `release/` and `node_modules/` are generated.

> `node_modules/` holds nothing but `ws` (~150 KB). The BLE transport is a C++/WinRT binary prebuilt in `plugin/native/nlink.exe` (226 KB): no .NET runtime, no npm addon, no toolchain on the user's machine.

### Rebuilding the native transport / Reconstruire le transport natif

`plugin/native/nlink.cpp` is the source of `nlink.exe`. It builds with Visual Studio Build Tools and the Windows SDK (C++/WinRT):

```powershell
& "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
cl /nologo /EHsc /std:c++20 /O2 /MT nlink.cpp /link windowsapp.lib user32.lib /OUT:nlink.exe
```

**Français**

```bash
npm run sdk          # télécharge les SDK officiels Ulanzi dans ./sdk
npm run build        # assemble release/com.ulanzi.ulanzistudio.neewer.ulanziPlugin
npm test             # octets des trames, résolveur de versions, et comportement du plugin
```

`npm run build` vérifie le `manifest.json` (segments d'UUID, icônes, pages d'inspection), vérifie que chaque `src`/`href` des pages d'inspection existe bien dans le dossier produit, parse chaque module livré, vérifie que la version déclarée est la même dans tous les fichiers, puis installe la dépendance d'exécution `ws` :

- si `npm` est présent, il est utilisé ;
- sinon `scripts/install-deps.mjs` télécharge les tarballs sur le registre public et les extrait dans `node_modules/`, sans npm ni git. L'arbre produit est identique.

> `npm run sdk` télécharge `plugin-common-node` et `plugin-common-html` séparément : dans le dépôt `UlanziDeckPlugin-SDK` ces deux répertoires sont des **sous-modules git**, donc l'archive principale les livre vides.

> Le dossier `plugin/` est la source ; `sdk/`, `release/` et `node_modules/` sont générés.

> `node_modules/` ne contient que `ws` (~150 Ko). Le transport BLE est un exécutable C++/WinRT précompilé dans `plugin/native/nlink.exe` (226 Ko) : ni runtime .NET, ni addon npm, ni chaîne de compilation chez l'utilisateur.

### Reconstruire le transport natif

`plugin/native/nlink.cpp` est la source de `nlink.exe`. Elle se compile avec Visual Studio Build Tools et le SDK Windows (C++/WinRT) :

```powershell
& "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
cl /nologo /EHsc /std:c++20 /O2 /MT nlink.cpp /link windowsapp.lib user32.lib /OUT:nlink.exe
```

## 5. Installation / Installation

Copy the whole `release/com.ulanzi.ulanzistudio.neewer.ulanziPlugin` folder (the name comes from the manifest's `UUID`) into:

| OS | Path |
|---|---|
| Windows | `%AppData%\Ulanzi\UlanziDeck\Plugins` |
| macOS | `~/Library/Application Support/Ulanzi/UlanziDeck/Plugins` |

Restart UlanziStudio. The plugin appears in the list with its 16 actions.

**Français**

Copier le dossier complet `release/com.ulanzi.ulanzistudio.neewer.ulanziPlugin` (le nom vient de l'`UUID` du manifeste) dans :

| OS | Chemin |
|---|---|
| Windows | `%AppData%\Ulanzi\UlanziDeck\Plugins` |
| macOS | `~/Library/Application Support/Ulanzi/UlanziDeck/Plugins` |

Redémarrer UlanziStudio. Le plugin apparaît dans la liste, avec 16 actions.

## 6. Registering lights / Enregistrer des lampes

The plugin does not drive a fixed number of lights: the list is open, and **every action instance chooses the light it controls**.

1. Put the **Scan** action on a key and open it in the property inspector.
2. *Add* on the light found under *Found devices* — or type the address under *Manual*, then *Add*.
   - **Exactly one** light found by the scan → it is registered and bound to that key automatically.
   - **No** light named NEEWER → the other devices in range are listed under *Other devices*: a light can broadcast without advertising its name.
3. Rename each light under *Registered lights* to tell them apart (the name is also the label on the keys).
4. On **every** action, pick the light under *Device*.
   - *Default device* = the first registered light; useful when you have only one and do not want the setting repeated.
5. *Forget* removes a light from the registry. The settings of the keys that targeted it fall back to the default light.

State, reconnection and brightness are **per light**: one clean BLE link per fixture, each with its own write queue. Scanning, on the other hand, goes through a throwaway transport so it cannot tear down the other lights' links.

> The Neewer app and the plugin cannot be connected at the same time: the light's BLE module accepts a single client. Close the app before using the D200X.
>
> If the light does not show up in the scan, it is no longer powered: unplug and replug its supply. A missing advertisement does not mean a client is already connected. Measured on an RGB62 on 2026-09-28: powered and free, it broadcasts continuously; held by a client, it advertises **nothing at all** (0 in 150 s). The advertisement is therefore not a sign of availability, it is the only window in which a connection is possible.

**Français**

Le plugin ne pilote pas un nombre fixe de lampes : la liste est ouverte, et **chaque instance d'action choisit la lampe qu'elle contrôle**.

1. Poser l'action **Scan** sur une touche et l'ouvrir dans l'inspecteur de propriétés.
2. *Add* sur la lampe trouvée dans *Found devices* — ou saisir l'adresse dans *Manual* puis *Add*.
   - **1 seule** lampe trouvée au scan → elle est enregistrée et liée à cette touche automatiquement.
   - **aucune** lampe nommée NEEWER → les autres devices à portée sont listés sous *Other devices*, une lampe peut diffuser sans annoncer son nom.
3. Renommer chaque lampe dans *Registered lights* pour les distinguer (le nom sert aussi d'étiquette sur les touches).
4. Sur **toutes** les actions, choisir la lampe dans *Device*.
   - *Default device* = la première lampe enregistrée ; utile quand on n'a qu'une lampe et qu'on ne veut pas multiplier les réglages.
5. *Forget* retire une lampe du registre. Les réglages des touches qui la visaient retombent sur la lampe par défaut.

L'état, la reconnexion et la luminosité sont **par lampe** : un lien BLE propre à chaque fixture, chacun avec sa propre file d'écriture. Le scan, lui, passe par un transport jetable pour ne pas casser les liens des autres lampes.

> L'app Neewer et le plugin ne peuvent pas être connectés en même temps : le module BLE de la lampe accepte un seul client. Fermer l'app avant d'utiliser le D200X.
>
> Si la lampe n'apparaît pas dans le scan, elle n'est plus alimentée : débrancher/rebrancher son alimentation. Attention, une absence d'annonce ne signifie pas qu'un client est déjà lié. Mesuré sur une RGB62 le 2026-09-28 : alimentée et libre, elle diffuse en continu ; liée à un client, elle n'émet **aucune** annonce (0 sur 150 s). L'annonce n'est donc pas un indice de disponibilité, c'est la seule fenêtre pendant laquelle la connexion est possible.

## 7. Debugging / Débogage

Start UlanziStudio with the debug flags (right-click the shortcut → Properties → *Target*, on Windows):

```
"C:\...\Ulanzi Studio.exe" --log --webRemoteDebug --nodeRemoteDebug
```

- **Main service log**: `%AppData%\Ulanzi\UlanziStudio\logs\com.ulanzi.ulanzistudio.neewer.log` (the file name is the main service's UUID). The host only persists `error` level calls, so `info` messages are visible in the process console.
- **Property inspectors**: `http://localhost:9292` lists every loaded HTML WebView.
- **Node service**: `manifest.json` already carries `"Inspect": "--inspect=127.0.0.1:9212"`; open `chrome://inspect` in Chrome and add the `127.0.0.1:9212` target.
- **No frame tracing**: neither websocket nor BLE. A command that goes out unanswered therefore appears nowhere, and a click that does nothing is indistinguishable from a host that sent nothing. This is a deliberate choice: tracing wrote continuously to disk for a normal session, and what it added did not justify the cost.
- **Native transport unavailable**: if `nlink.exe` is missing or refuses to start, the explicit error message appears in the log and names the expected path. Check that `native/nlink.exe` is present in the plugin folder and that the build is the Windows one.
- **No radio state check before a scan**: `nlink.exe` does not test the adapter, it just scans. An empty scan means "nothing seen during the window", not necessarily "radio off".

**Français**

Lancer UlanziStudio avec les flags de debug (clic droit sur le raccourci → Propriétés → *Cible*, sous Windows) :

```
"C:\...\Ulanzi Studio.exe" --log --webRemoteDebug --nodeRemoteDebug
```

- **Log du service principal** : `%AppData%\Ulanzi\UlanziStudio\logs\com.ulanzi.ulanzistudio.neewer.log` (le nom du fichier est l'UUID du service principal). L'hôte n'en conserve que les appels de niveau `error` : les messages `info` restent visibles dans la console du processus.
- **Inspecteurs de propriétés** : `http://localhost:9292` liste tous les WebView HTML chargés.
- **Service Node** : `manifest.json` contient déjà `"Inspect": "--inspect=127.0.0.1:9212"` ; ouvrir `chrome://inspect` dans Chrome et ajouter la cible `127.0.0.1:9212`.
- **Aucune trace des trames** : ni websocket ni BLE. Une commande partie sans réponse n'apparaît donc nulle part, et un clic sans effet est indistinguable d'un hôte qui n'a rien envoyé. C'est un choix : la trace écrivait en continu sur le disque pour une session normale, et ce qu'elle apportait ne justifiait pas ce coût.
- **Transport natif indisponible** : si `nlink.exe` est absent ou refuse de démarrer, le message d'erreur explicite apparaît dans le log et nomme le chemin attendu. Vérifier la présence de `native/nlink.exe` dans le dossier du plugin et la build Windows.
- **Aucun contrôle de l'état de la radio avant le scan** : `nlink.exe` ne teste pas l'adaptateur, il tente le scan. Un scan vide signifie « rien vu pendant la fenêtre », pas forcément « radio éteinte ».

## 8. Known limits / Limites connues

### The light cannot be read: the plugin only knows its own commands

This is the most important limit of the plugin, and no amount of code works around it. Everything the deck shows comes from **the last command sent**, remembered per light; nothing comes from the light.

**Verified on a real RGB62 on 2026-10-09:**

| Read path | Result |
|---|---|
| A read frame in the protocol | **does not exist** — the protocol only has writes: on `0x81`, colour `0x86`, temperature `0x87`, effects `0x88` |
| The native transport's `status` command | reports the **BLE link** state, not the light's |
| The `0x05` frame the light sends on its own when the link opens | the level byte reads **100 whether the light is on or off**, and on a restart it is **not delivered at all** |
| Adjusting the light with its own buttons | **no notification** is emitted, the light publishes nothing |

The `0x81` notifications (on/off) only arrive **in answer to a command**: over a 39 s session without a single command, the state did not move, and the first `off` observed arrived 430 ms after a press.

**Practical consequences:**

- If you adjust the light **with its own buttons or with the Neewer app**, the deck does not learn about it. It will show your last command, not the physical state.
- The Power key shows what you last asked for, not what the light is doing.
- The plugin **writes nothing on connect**: it does not switch your light on or off at startup.
- The remembered state is **per light** and restored at startup. On the first launch after installing, and until you have commanded anything, the defaults apply — they do not come from the light.
- Dial notches that would pass a bound **stop** there (brightness, saturation) instead of jumping to the other end: a dial at 100% no longer drops the light to 5%. The inspector's *Wrap* setting brings the endless sweep back. Hue and temperature keep cycling, those quantities being cyclic by nature.

### Other limits

- **The transport is native.** `noble` could not discover the RGB62's characteristics while WinRT enumerated the same services and features without difficulty. The cause was the noble layer, not the light nor Windows. `nlink.exe` (C++/WinRT) has taken over; the protocol frames were physically validated through this path. See `docs/session-2026-09-28-bluetooth.md`.
- **Windows pairing is required.** The direct consequence of moving to `FromBluetoothAddressAsync`: the light must be known to the OS. This is the only limit this transport introduces.
- **Multi-device validation is still pending**: the architecture is in place (one link, one write queue and one remembered state per light), but only one RGB62 has been tested.
- The **FX effects** (Cop Car, Candlelight, Hue Loop…) are not exposed: the matching long frames have not been verified on the RGB62. `protocol.js` has room for them (`OP.EFFECT`).
- There are **no groups**: each key binds to a single light. The same preset is therefore not applied to every light at once — you need one key per light.
- **The RGB62 broadcasts continuously as long as it is powered and free**, and goes completely silent as soon as a client holds it. It does not "broadcast in bursts": the opposite pattern had been misread for a long time, because the only state in which the light is silent is precisely the one in which it is normal for it to be silent.
- Identity frame the light emits when the link opens, captured in real conditions:
  `78 05 07 F4 9F 7F 53 F0 B8 64 F5` → opcode `0x05`, 7 payload bytes: the MAC address over 6 bytes then a level byte, and the final checksum. The structure is **11 bytes** long and the last byte is a valid checksum. The level byte varied from one send to another (`64`, `F0`, `41`, `1E` recorded in 2026-09) but **it reflects neither power nor brightness**: in 2026-10 it read `64` (=100) with the light on and off, and it was not delivered on a restart. The plugin therefore uses it as a fact about the format, never as a state.
- Only `0x05` has been seen emitted spontaneously; the light does **not** acknowledge written commands with a distinct opcode.

**Français**

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

- **Le transport est natif.** `noble` ne parvenait pas à découvrir les caractéristiques de la RGB62 alors que WinRT énumérait les mêmes services et caractéristiques sans difficulté. La cause était la couche noble, pas la lampe ni Windows. `nlink.exe` (C++/WinRT) prend désormais le relais ; les trames du protocole ont été validées physiquement par ce chemin. Voir `docs/session-2026-09-28-bluetooth.md`.
- **L'appairage Windows est requis.** Contrepartie directe du passage à `FromBluetoothAddressAsync` : la lampe doit être connue de l'OS. C'est la seule limite introduite par ce transport.
- La **validation multi-appareils reste à faire** : l'architecture est en place (un lien, une file d'écriture et un état mémorisé par lampe), mais une seule RGB62 a été testée.
- Les **effets FX** (Cop Car, Candlelight, Hue Loop…) ne sont pas exposés : les trames longues correspondantes n'ont pas été vérifiées sur la RGB62. Le module `protocol.js` a la place pour les ajouter (`OP.EFFECT`).
- Il n'y a **pas de groupes** : chaque touche se lie à une seule lampe. Un même preset n'est donc pas appliqué à toutes les lampes d'un coup, il faut une touche par lampe.
- **La RGB62 diffuse en continu tant qu'elle est alimentée et libre**, et se tait complètement dès qu'un client la tient. Elle ne « diffuse pas par salves » : le motif inverse avait été mal interprété pendant longtemps, parce que le seul état où la lampe se tait est précisément celui où il est normal qu'elle se taise.
- Trame d'identité émise par la lampe à l'ouverture du lien, relevée en conditions réelles :
  `78 05 07 F4 9F 7F 53 F0 B8 64 F5` → opcode `0x05`, 7 octets de charge utile : l'adresse MAC sur 6 octets puis un octet de niveau, et le checksum final. La structure est sur **11 octets** et le dernier octet est un checksum valide. L'octet de niveau a varié d'un envoi à l'autre (`64`, `F0`, `41`, `1E` relevés en 2026-09) mais **il ne reflète ni la marche ni la luminosité** : en 2026-10 il valait `64` (=100) lampe allumée et éteinte, et n'était pas livré sur un redémarrage. Il n'est donc exploité par le plugin que comme un fait de format, jamais comme un état.
- Seul `0x05` a été observé en émission spontanée ; la lampe **n'accuse pas** les commandes écrites par un opcode distinct.

## 9. Layout / Arborescence

```
plugin/                             plugin source — source du plugin
  manifest.json                     16 actions, 4-segment UUID, Node.js (CodePath .js)
  package.json                      type: module + the ws dependency
  native/
    nlink.cpp                       C++/WinRT BLE transport (source)
    nlink.exe                       C++/WinRT BLE transport (built, shipped in the release)
  service/                          main service — service principal
      app.js                          host event routing, repaint scheduling, settings
      core/
        constants.js                  UUIDs, GATT, limits, timing
        protocol.js                   0x78 frames (pure, tested)
        params.js                     clamps, dial steps, lists, wrapping
        dial.js                       rotation decoding, sweep range, preset walk
        native.js                     line protocol client for nlink.exe
        ble.js                        native transport: scan, connect, write, notifications
        light.js                      one light's session: state + reconnection supervisor
        devices.js                    light registry (open list) + shared scan
        context.js                    host contexts: creation, moves, forgetting
        settings.js                   shape of the global settings written to the host
        shutdown.js                   last command written on the way out
        ui.js                         setStateIcon / setFeedback, tolerant of old hosts
    actions/                        one module per action (render / onRun / onDialRotate)
      stepper.js                     shared body for the one-step buttons
  property-inspector/
    shared.js, shared.css           shared page bootstrap, light picker
    stepper.js                      shared inspector for the one-step buttons
    presets.js                      shared inspector for the preset lists
    <action>/inspector.html         one page + one script per action
scripts/
  install-sdk.mjs                   downloads the official SDKs (no git)
  build.mjs                         assembly, validation, dependency install
tests/
  protocol.test.js                   frame bytes and their checksum
  params.test.js                     clamps, dial steps, bounds
  native.test.js                     line protocol: framing, timeout, late replies
  ble.test.js                        helper process lifecycle
  dials.test.js                      what each dial writes, rotation and press
  render.test.js                     what each key draws, and the host routing
  app.test.js                        the main service, driven through the real SDK
  light.test.js                      one light session, no radio, no browser
  devices.test.js                    multi-light registry and remembered state
  presets.test.js                    the row editor, no browser
  shared.test.js                     the shared page bootstrap
  scan-panel.test.js                 the Scan panel
  steppers.test.js                   every step a panel offers, against the action
  manifest.test.js                   the manifest against the code and the files
  context.test.js                    host context resolution
  settings.test.js                   the shape of the global settings
  shutdown.test.js                   writing the last command on the way out
  wiring.test.js                     every module-level call resolves to something in scope
  deps.test.js                       npm-free semver resolver

sdk/                                generated: ulanzi-api/, common-html/
release/                            generated: com.ulanzi.ulanzistudio.neewer.ulanziPlugin/
```
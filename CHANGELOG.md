# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [1.0.0] — 2026-10-11

First stable release. Sixteen actions drive a Neewer RGB62 — and the other Neewer
studio lights speaking the `0x78` protocol — over Bluetooth Low Energy, from the keys
and the dial of an Ulanzi D200X. The Neewer Control Center app is not involved: the
plugin speaks to the light's BLE module directly.

### Added

**Actions** — 16 in all, each instance bound to one light through its *Device* setting:

- **Power** on a key: toggle, on, off.
- **Brightness**, **Hue**, **Saturation** and **CCT** on a dial: continuous sweep, with
  a press walking the presets or the scenes.
- **Hue Presets** and **CCT Presets** on a key: walk a list.
- **Brightness Up/Down**, **Hue Up/Down**, **Saturation Up/Down**, **CCT Up/Down** on a
  key: one clamped step per press.
- **Scan** on a key: discovers a light and binds it.

**Settings** — range, step and wrap for the dials; editable preset rows (name, value and
a third field where the frame carries one), saved by their own button rather than on
every keystroke.

**Discovery** — the Scan action pairs a light from the property inspector; each registered
light can be renamed and is then selectable by every action. The list is open: there is
no fixed number of lights.

**Native transport** — `plugin/native/nlink.exe`, a C++/WinRT helper reached through a
line protocol, replacing `noble`, which could not discover the RGB62's characteristics.
The protocol frames were physically validated through this path.

**Remembered state** — the deck shows the last command sent, per light, restored at
startup. The lights cannot be read; see *Known limitations*.

**Build** — `npm run sdk` fetches the official SDKs without git, `npm run build`
assembles the release and validates it: manifest, referenced files, module syntax,
version consistency, then the single runtime dependency.

**Tests** — 278 behavioural tests, offline, driving the real service through the real SDK
where the SDK is involved.

### Fixed

- **Leaked helper processes.** `nlink.exe` only exits when its stdin closes, and nothing
  closed it: every scan left a process behind for the rest of the session, as did
  removing a light. Scans now run on a throwaway transport that is shut down, and
  forgetting a light takes its helper with it.
- **Lost dial settings on exit.** The debounced settings write was unref'd and the
  shutdown only handled SIGINT. A command issued within a second of closing
  UlanziStudio was lost. Every exit path now writes first.
- **A partial settings message reset everything it left out.** The service rebuilt an
  action's settings from the defaults plus the message, so saving a preset list put the
  dial's own step back to its default, and editing that step emptied the presets.
  Settings are now merged.
- **A late reply resolved the wrong command.** The helper answers one line per command
  and nothing says which, so a command that had timed out handed its late reply to the
  next waiter. One slow write broke every write after it until the service restarted.
- **Step fields ignored the transport's granularity.** Colour temperature travels in one
  byte of 100 K; a 250 K step landed between two values the frame can carry. Steps are
  now multiples of 100 — 100, 200, 500, 1000 K — and a finer one falls back to 200 K
  rather than being silently rounded.
- **A dial flashed its own name for a frame.** Repaints re-sent the encoder layout and
  the state icon, both of which make the host rebuild the key; until the content that
  followed arrived it had nothing to draw but the state name. Both are now sent once per
  key.
- **The SDK drops falsy settings.** `element.value = value ? value : ''` blanks every
  setting whose value is 0 or false, so a minimum of 0 and a "wrap: no" choice showed
  blank, and the next save wrote that emptiness back.
- **Preset row inputs leaked into the settings.** Their positional names were collected
  by every automatic save, stored, and never removed.
- **Half-typed preset rows were discarded** by any unrelated settings message.
- **Deleting a preset could fail.** The delete button held its row's position from the
  moment it was built, so removing one row moved every row below it and the rest stopped
  deleting.
- **The property inspector panels could not be deleted.** The Scan table was rebuilt on
  every broadcast, destroying the rename field under the cursor.
- **Missing import in the main service.** A module-level call had no matching import; the
  error was swallowed by the `uncaughtException` handler, so the plugin ran but with no
  shutdown handling at all.
- **Missing plugin icon.** The manifest declared an icon that did not exist.

### Changed

- **Brightness and saturation dials stop at their bounds** instead of wrapping; a dial at
  100% no longer drops the light to 5%. The inspector's *Wrap* setting brings the endless
  sweep back. Hue and temperature keep cycling, those quantities being cyclic by nature.
- **The plugin writes nothing on connect**: starting UlanziDeck no longer switches a lamp
  that was already on.
- **The temperature key shows its level in both modes.** It used to read "HSL" while the
  lamp was in colour mode, which is a mode and not a level.
- **Key titles carry the level and nothing else**, e.g. `42%` rather than
  `Brightness up (42%)`.
- **Only Power and Scan draw a state icon.** Every other action declares a single state
  whose image never changes, which the host already draws.
- **The websocket and BLE tracing was removed.** It wrote continuously to disk for a
  normal session, and what it added did not justify the cost.
- **README is bilingual**, English first, French below each section.

### Known limitations

- **The light cannot be read.** The protocol has no read frame, the transport's `status`
  reports the BLE link rather than the light, the `0x05` frame the light volunteers on
  its own reports 100 whether the light is on or off (and is not delivered at all on a
  restart), and adjusting the light with its own buttons emits nothing. Everything the
  deck shows is the last command sent.
- **Windows pairing is required.** The light must be known to the OS; there is no
  advertisement hunt.
- **Multi-device validation is pending.** One clean link, one write queue and one
  remembered state per light are in place, but only one RGB62 has been tested.
- **FX effects are not exposed.** The long frames have not been verified on the RGB62.
- **No groups.** Each key binds to a single light.
- **The Neewer app and the plugin cannot run at the same time**: the light's BLE module
  accepts a single client.

[Unreleased]: https://github.com/Razganariel/Ulanzi-neewer-plugin/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Razganariel/Ulanzi-neewer-plugin/releases/tag/v1.0.0
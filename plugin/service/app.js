/**
 * Neewer Control for Ulanzi D200X - main service.
 *
 * Stays connected to UlanziStudio for the whole session, owns the registry of
 * NEEWER fixtures, and routes host events to the action handlers. Each action
 * instance is bound to one device through its "device" setting, so the same
 * action UUID can drive as many lights as the user registered. Icon/feedback
 * refresh is driven by the state of the bound fixture.
 */

import { readFileSync } from 'node:fs';
import UlanziApi from '../ulanzi-api/index.js';
import { PLUGIN_UUID, REPAINT_DELAY_MS } from './core/constants.js';
import { DeviceRegistry } from './core/devices.js';
import { findByUuid } from './actions/index.js';
import { decodeContext, ensureEntry, forget, forgetActionId } from './core/context.js';
import { buildSettings, emptySettings } from './core/settings.js';
import { installShutdownHandlers } from './core/shutdown.js';

const $UD = new UlanziApi();

/** context -> { action, settings } */
const contexts = new Map();
/** context -> scan result, only used by the scan property inspector */
const scans = new Map();

const log = (msg, level = 'info') => {
  try {
    $UD.logMessage(msg, level);
  } catch {
    /* logging is best effort */
  }
  process.stdout.write(`[neewer] ${msg}\n`);
};

/**
 * Encoder readout must only go to instances the host actually placed on a dial.
 *
 * The manifest cannot answer that on its own: it lists one controller per action,
 * so an action-level flag was true for every instance of a dial action no matter
 * where it actually sits. The result was setFeedbackLayout/setFeedback fired on
 * plain buttons, where the host accepts them (code 0) and they blank the key
 * instead of filling it.
 *
 * The host does send `controller` on add, so that is the source of truth. The
 * manifest is only a fallback for events that carry no controller field.
 */
const encoderActions = new Set();
try {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  for (const action of manifest.Actions || []) {
    if ((action.Controllers || []).includes('Encoder')) encoderActions.add(action.UUID);
  }
} catch (err) {
  log(`cannot read manifest: ${err.message}`, 'warn');
}

/** context -> 'Keypad' | 'Encoder', remembered from the add event */
const controllers = new Map();

/**
 * Whether this instance sits on a dial.
 *
 * Only `add` carries the controller, and it can fire before any refresh, so the
 * remembered value is consulted first. Before it is known, the key is treated as
 * a button: a wrong setFeedback blanks the key, while a missing one on a real dial
 * only costs the readout until the next add.
 */
function isEncoderContext(context, entry) {
  const remembered = controllers.get(context);
  if (remembered) return remembered === 'Encoder';
  return encoderActions.has(entry?.action?.uuid || decodeContext(context).uuid);
}

/**
 * Global settings hold the whole device list. `address` and `name` mirror the
 * default device so an installation written by an older build still reads back
 * as a single light instead of an empty registry.
 *
 * `states` is the last commanded state per fixture, kept because the fixtures cannot
 * be read: they have no read command, and the one frame they volunteer carries a
 * constant. Without it the deck would come back claiming a brightness nobody chose.
 *
 * The rules live in core/settings.js so they can be tested; this only hands them to the
 * host.
 */
const globalSettings = emptySettings();

function saveDevices(devices, activeId, states) {
  Object.assign(globalSettings, buildSettings(devices, activeId, states));
  try {
    $UD.setGlobalSettings({ ...globalSettings });
  } catch (err) {
    log(`cannot persist global settings: ${err.message}`, 'warn');
  }
}

const registry = new DeviceRegistry({ save: saveDevices });

function report(err, context) {
  log(err.message, 'error');
  if (context) $UD.showAlert(context);
}

/** device id an action instance is bound to, empty meaning "the default device" */
function boundDeviceId(context) {
  const entry = contexts.get(context);
  return String(entry?.settings?.device || '').trim();
}

function boundLight(context) {
  return registry.lightFor(boundDeviceId(context));
}

function handlerContext(context, isEncoder) {
  const entry = contexts.get(context);
  const action = entry?.action;
  const light = boundLight(context);
  return {
    $UD,
    context,
    action,
    settings: { ...(action?.defaults || {}), ...(entry?.settings || {}) },
    registry,
    light,
    deviceId: boundDeviceId(context),
    snap: light ? light.snapshot() : { address: '', name: '', connected: false, connecting: false, lastError: '' },
    isEncoder,
    devices: scans.get(context) || [],
    report: (err) => report(err, context),
    /** Register a fixture and return the stored device record. */
    pairDevice: (address, name) => registry.add({ address, name }),
    /** Point this action instance at a device. */
    bindDevice: (deviceId) => {
      const current = contexts.get(context);
      if (!current) return false;
      current.settings = { ...current.settings, device: deviceId || '' };
      $UD.sendParamFromPlugin(current.settings, context);
      return true;
    },
    /** Every known device, for the "Device" picker. */
    knownDevices: () => registry.list(),
    onScan: (ctx, devices) => {
      scans.set(ctx, devices);
      $UD.sendToPropertyInspector({ event: 'scan-result', devices }, ctx);
      refresh(ctx);
    },
    onScanOthers: (ctx, devices) => {
      $UD.sendToPropertyInspector({ event: 'scan-others', devices }, ctx);
    },
  };
}

/**
 * The host mounts a key some time after it announces the `add`, so a repaint sent
 * inside that burst can be acked and still land on nothing: every key keeps the
 * "waiting for connection" icon until the user happens to touch it. Repaints are
 * therefore coalesced onto a later tick, when the deck has finished mounting.
 */
const pendingPaint = new Set();
let paintScheduled = false;

function scheduleRefresh(only) {
  if (only) pendingPaint.add(only);
  else for (const ctx of contexts.keys()) pendingPaint.add(ctx);
  if (paintScheduled) return;
  paintScheduled = true;
  setTimeout(() => {
    paintScheduled = false;
    const batch = [...pendingPaint];
    pendingPaint.clear();
    refreshAll(batch);
  }, REPAINT_DELAY_MS);
}

/**
 * One `setStateIcon` frame per key, in one pass. Sending them one message per
 * key is what let a single dial notch turn into hundreds of round trips.
 */
function refreshAll(list) {
  const seen = new Set();
  for (const ctx of list) {
    if (seen.has(ctx) || !contexts.has(ctx)) continue;
    seen.add(ctx);
    refresh(ctx);
  }
}

function refresh(only) {
  for (const [ctx, entry] of contexts) {
    if (only && ctx !== only) continue;
    const isEncoder = isEncoderContext(ctx, entry);
    const ctxForAction = handlerContext(ctx, isEncoder);
    try {
      entry.action?.render?.(ctxForAction);
    } catch (err) {
      log(`render failed for ${ctx}: ${err.message}`, 'warn');
    }
    $UD.sendToPropertyInspector(
      {
        event: 'state',
        state: ctxForAction.snap,
        deviceId: ctxForAction.deviceId,
        devices: registry.list(),
        activeId: registry.activeId,
      },
      ctx
    );
  }
}

registry.on('change', (payload) => {
  // Only the touches actually bound to the fixture that changed need a redraw.
  // Refreshing every context multiplied one dial notch into one state message
  // per bound key, which is what turned a few hundred rotations into >1600.
  const deviceId = payload?.deviceId;
  if (!deviceId) {
    scheduleRefresh();
    return;
  }
  // An action left on "no device" follows the active one, so it counts as bound.
  for (const [ctx] of contexts) {
    const bound = boundDeviceId(ctx);
    if (!bound || bound === deviceId) scheduleRefresh(ctx);
  }
  repaintWhenSettled();
});

/**
 * A key painted while the fixture was still linking keeps the "waiting for
 * connection" icon: the corrective frame leaves before the deck has mounted the
 * key, so the host acks it and drops it. Repaint every control once a link
 * settles, which is late enough to land on a key that actually exists.
 *
 * Only the rising edge qualifies. Without that guard every dial notch, which
 * also emits a fixture state, would repaint the whole deck.
 */
let lastOnlineCount = 0;

function repaintWhenSettled() {
  let online = 0;
  for (const light of registry.lights.values()) {
    if (light.snapshot().connected) online += 1;
  }
  const rose = online > lastOnlineCount;
  lastOnlineCount = online;
  if (rose) scheduleRefresh();
}

/**
 * UlanziStudio persists global settings to disk when the plugin writes them but
 * never answers the `getGlobalSettings` request, so waiting for the round trip
 * leaves the registry empty and every action fails with "no device configured".
 * Read what the host already stored instead.
 */
function readHostGlobalSettings() {
  try {
    // <plugin>/service -> <UlanziDeck>/Config/global_settings.json
    const file = new URL('../../../Config/global_settings.json', import.meta.url);
    const all = JSON.parse(readFileSync(file, 'utf8'));
    return all?.[PLUGIN_UUID] || {};
  } catch {
    return {};
  }
}

// Applying the registry here would open BLE links before the websocket exists,
// so it is deferred to the connect handler.
const persisted = readHostGlobalSettings();

$UD.connect(PLUGIN_UUID);

$UD.onConnected(() => {
  log('main service connected to UlanziStudio');
  if (!registry.devices.size) {
    registry.load(persisted);
    const restored = registry.list();
    log(restored.length ? `restored ${restored.length} device(s): ${restored.map((d) => d.address).join(', ')}` : 'no device registered yet');
  }
  $UD.getGlobalSettings();
});

$UD.onClose(() => log('websocket closed', 'warn'));
$UD.onError((err) => log(`websocket error: ${err}`, 'error'));

$UD.onDidReceiveGlobalSettings((message) => {
  // The host shape is not documented: accept the settings nested under
  // "settings", under "payload", or spread at the root of the frame.
  const settings = message?.settings || message?.payload || message || {};
  const incoming = Array.isArray(settings.devices) ? settings.devices : [];
  const address = String(settings.address || '').trim().toUpperCase();
  // An empty echo must not wipe a registry we already know: the host has been
  // seen answering with an empty object.
  if (!incoming.length && !address) {
    log('host reported empty global settings, keeping the current registry');
    return;
  }
  if (registry.devices.size) return;
  registry.load({ ...settings, devices: incoming });
  log(`registry from host: ${registry.list().map((d) => d.address).join(', ') || 'empty'}`);
});

$UD.onAdd((message) => {
  const context = message.context;
  // Only `add` tells us whether the instance landed on a button or on the dial.
  if (message.controller) controllers.set(context, message.controller);
  const { entry, created } = ensureEntry(contexts, context, message, (uuid) => findByUuid(uuid));
  if (!entry) return;
  // Re-acquiring a context after a removal may not ship with the full settings,
  // so ask the host to send them again. Getting settings after a fresh add is
  // cheap and ensures the UI and backend stay in sync, even if the previous
  // instance's settings were recovered from a stale map.
  $UD.getSettings(context);
  scheduleRefresh(context);
});

$UD.onDidReceiveSettings((message) => {
  const context = message.context;
  const { entry } = ensureEntry(contexts, context, { uuid: message.uuid, param: message.settings }, (uuid) => findByUuid(uuid));
  if (!entry) return;
  // Same instance on a key we did not know about yet: the settings arrived
  // before any add, so treat it as a placement and draw the key.
  forgetActionId(contexts, decodeContext(context).actionid, context);
  // `ensureEntry` has already merged the defaults, whatever the instance was carrying and
  // what just arrived. Rebuilding it from the defaults and the message alone threw the
  // rest away: a message that does not mention every setting - a panel saving one field,
  // or the preset rows being saved without the dial's own bounds - silently reset
  // everything it left out to its default.
  $UD.sendParamFromPlugin(entry.settings, context);
  refresh(context);
});

$UD.onParamFromApp((message) => {
  const context = message.context;
  const { entry } = ensureEntry(contexts, context, { uuid: message.uuid, param: message.param }, (uuid) => findByUuid(uuid));
  if (!entry) return;
  // paramfromapp is what the host sends right after a move, once the property
  // inspector hydrates. It carries no add, so the ghost of the previous key is
  // still registered here and has to go.
  forgetActionId(contexts, decodeContext(context).actionid, context);
  // Merged, not rebuilt: see the handler above.
  refresh(context);
});

$UD.onClear((message) => {
  // The host sends an array of {context} items; a single-context shape is also
  // tolerated so one malformed frame cannot leak entries forever.
  const items = Array.isArray(message.param) ? message.param : [];
  for (const item of items) {
    if (!item?.context) continue;
    // Same instance may come back on another key, or on the other kind of control.
    // Dropping the remembered controller with the entry avoids a stale "Encoder"
    // driving setFeedback onto a button.
    controllers.delete(item.context);
    forget(contexts, item.context);
  }
});

/**
 * Builds the handler context, re-acquiring the action if the host never sent an
 * add for it.
 *
 * This is the fix for the "removed then re-placed on the same key" case: the
 * host redraws its own UI from its own model, but the Stream Deck key is drawn
 * only when the plugin says so, so a missing context left the key blank. Any event
 * for a known context string is enough to rebuild the entry.
 */
function contextFor(context, message) {
  const { entry, created } = ensureEntry(contexts, context, message, (uuid) => findByUuid(uuid));
  if (created) {
    // A recovered context has never been drawn, and the host will not ask again.
    refresh(context);
  }
  return handlerContext(context, isEncoderContext(context, entry));
}

/**
 * An action moved to another key keeps its actionid, and the host announces the
 * new key with `setactive` alone: no clear for the key it left, no add for the key
 * it reached. This is the observed move 1_0 -> 1_2, and ignoring the event left
 * the old context in place while the new key was never drawn. Handling it here is
 * what makes a moved action appear on its new key.
 */
$UD.onSetActive((message) => {
  const context = message.context;
  // A move may land the same instance on the other kind of control, so re-read the
  // controller when the host bothers to send one.
  if (message.controller) controllers.set(context, message.controller);
  const { entry, created } = ensureEntry(contexts, context, message, (uuid) => findByUuid(uuid));
  if (!entry) return;
  const { actionid } = decodeContext(context);
  // Drop the controller of the key it left as well, or a later re-add there keeps
  // believing it sits on the control it had before the move.
  for (const [other, otherEntry] of contexts) {
    if (other !== context && decodeContext(other).actionid === actionid) controllers.delete(other);
  }
  forgetActionId(contexts, actionid, context);
  // A move is a fresh placement: the new key has never been drawn, and the host
  // will not ask again.
  refresh(context);
});

$UD.onRun((message) => {
  const ctx = contextFor(message.context, message);
  ctx.action?.onRun?.(ctx);
});

$UD.onDialRotate((message) => {
  const ctx = contextFor(message.context, message);
  ctx.action?.onDialRotate?.(ctx, message);
});

// Pressing a dial is its own event, not a key press: the host never emits onRun
// for an encoder, so an action that only had onRun was silently inert on a dial.
$UD.onDialUp((message) => {
  const ctx = contextFor(message.context, message);
  ctx.action?.onDialPress?.(ctx);
});

/* Property inspector -> main service */
$UD.onSendToPlugin(async (message) => {
  const payload = message.payload || {};
  const context = message.context || `${message.uuid}___${message.key}___${message.actionid}`;
  // The property inspector only renders after an add, so a reopened inspector can
  // be the first frame we see for a context that already exists on the deck.
  ensureEntry(contexts, context, message, (uuid) => findByUuid(uuid));

  try {
    if (payload.event === 'scan') {
      $UD.sendToPropertyInspector({ event: 'scan-started' }, context);
      const devices = await registry.scan({
        duration: (Number(payload.duration) || 6) * 1000,
        onlyNeewer: payload.onlyNeewer !== false,
      });
      scans.set(context, devices);
      $UD.sendToPropertyInspector({ event: 'scan-result', devices }, context);
      refresh(context);
      return;
    }
    if (payload.event === 'add-device') {
      const device = registry.add({ address: payload.address, name: payload.name });
      if (payload.bind) {
        const current = contexts.get(context);
        if (current) {
          current.settings = { ...current.settings, device: device.id };
          $UD.sendParamFromPlugin(current.settings, context);
        }
      }
      $UD.sendToPropertyInspector({ event: 'device-added', device, devices: registry.list() }, context);
      log(`device registered ${device.address}${device.name ? ` (${device.name})` : ''}`);
      refresh();
      return;
    }
    if (payload.event === 'remove-device') {
      const removed = registry.remove(payload.deviceId);
      $UD.sendToPropertyInspector({ event: 'device-removed', deviceId: payload.deviceId, devices: registry.list() }, context);
      log(removed ? `device removed ${payload.deviceId}` : `unknown device ${payload.deviceId}`);
      refresh();
      return;
    }
    if (payload.event === 'rename-device') {
      registry.rename(payload.deviceId, payload.name);
      refresh();
      return;
    }
    if (payload.event === 'reconnect') {
      const light = boundLight(context);
      if (light) await light.reconnect();
      refresh(context);
      return;
    }
    if (payload.event === 'set-device') {
      const current = contexts.get(context);
      if (current) {
        current.settings = { ...current.settings, device: String(payload.deviceId || '') };
        $UD.sendParamFromPlugin(current.settings, context);
      }
      refresh(context);
      return;
    }
    // Legacy single-address field, kept so an older property inspector keeps working.
    if (payload.event === 'set-address') {
      const device = registry.add({ address: payload.address, name: payload.name });
      $UD.sendToPropertyInspector({ event: 'address-accepted', address: device.address, device }, context);
      refresh();
      return;
    }
    if (payload.event === 'set-global') {
      saveDevices(globalSettings.devices, globalSettings.activeId, globalSettings.states);
      return;
    }
    if (payload.event === 'get-registry') {
      log(`get-registry received for context: ${context}, contexts size: ${contexts.size}`);
      // Send to ALL contexts for this action UUID (instance may have moved/been re-added)
      const actionUuid = message?.uuid || decodeContext(context).uuid;
      for (const [ctx, entry] of contexts) {
        if (entry?.action?.uuid === actionUuid) {
          refresh(ctx);
        }
      }
      log(`get-registry refresh done for action: ${actionUuid}`);
      return;
    }
  } catch (err) {
    report(err, context);
    $UD.sendToPropertyInspector({ event: 'error', message: err.message }, context);
  }
});

process.on('uncaughtException', (err) => {
  log(`uncaught: ${err && err.stack ? err.stack : err}`, 'error');
});

installShutdownHandlers(registry);

log('Neewer plugin main service started');

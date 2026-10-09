export const PLUGIN_UUID = 'com.ulanzi.ulanzistudio.neewer';

export const ACTION = Object.freeze({
  POWER: `${PLUGIN_UUID}.power`,
  BRIGHTNESS: `${PLUGIN_UUID}.brightness`,
  BRIGHTNESS_UP: `${PLUGIN_UUID}.brightness-up`,
  BRIGHTNESS_DOWN: `${PLUGIN_UUID}.brightness-down`,
  HUE: `${PLUGIN_UUID}.hue`,
  SATURATION: `${PLUGIN_UUID}.saturation`,
  SATURATION_UP: `${PLUGIN_UUID}.saturation-up`,
  SATURATION_DOWN: `${PLUGIN_UUID}.saturation-down`,
  CCT: `${PLUGIN_UUID}.cct`,
  CCT_PRESETS: `${PLUGIN_UUID}.cct-presets`,
  CCT_UP: `${PLUGIN_UUID}.cct-up`,
  CCT_DOWN: `${PLUGIN_UUID}.cct-down`,
  SCAN: `${PLUGIN_UUID}.scan`,
});

/**
 * Manifest state indices.
 *
 * Every action but Power declares a single state: the key always shows what it
 * controls, and whether the lamp happens to be reachable is told by the property
 * inspector instead. Painting a "waiting for connection" icon on the deck meant
 * every key looked broken while the lamp was in fact being driven fine, and the
 * corrective repaint raced the host's key mounting so it never landed. Power
 * keeps its two states because on/off is what the action does, not link status.
 */
export const STATE = Object.freeze({
  DEFAULT: 0,
});

export const NEEWER = Object.freeze({
  SERVICE_UUID: '69400001b5a3f393e0a9e50e24dcca99',
  WRITE_UUID: '69400002b5a3f393e0a9e50e24dcca99',
  NOTIFY_UUID: '69400003b5a3f393e0a9e50e24dcca99',
});

export const NAME_HINTS = ['NEEWER', 'RGB62', 'RGB660', 'SL-', 'GL1', 'ZN-', 'NW-'];

export const LIMITS = Object.freeze({
  BRIGHTNESS_MIN: 1,
  BRIGHTNESS_MAX: 100,
  HUE_MIN: 0,
  HUE_MAX: 360,
  SATURATION_MIN: 0,
  SATURATION_MAX: 100,
  CCT_MIN: 2500,
  CCT_MAX: 8500,
});

export const DEFAULTS = Object.freeze({
  BRIGHTNESS: 100,
  HUE: 0,
  // 0, not 100: this is what the deck shows before the light has ever reported a
  // value. Claiming full saturation up front would put the dial readout and the
  // first preset jump both somewhere the fixture is not.
  SATURATION: 0,
  CCT: 5600,
  MODE: 'hsl',
});

export const WRITE_GAP_MS = 40;
export const RECONNECT_DELAYS_MS = [2000, 5000, 10000, 20000, 30000];

/**
 * Once a fixture has failed this many times in a row, stop hammering the radio:
 * a lamp that is off or unreachable must not keep the transport busy, or a manual
 * scan can never see anything. A key press restarts the attempt immediately, and
 * the service reloads the registry on start.
 */
export const RECONNECT_GIVE_UP_AFTER = 4;
export const RECONNECT_IDLE_MS = 5 * 60 * 1000;

/**
 * Delay between an event asking for a repaint and the paint itself. The host
 * mounts a key after announcing it, so a frame sent in the same burst can be
 * acked and still reach a key that is not on the deck yet.
 */
export const REPAINT_DELAY_MS = 400;

/**
 * Action registry. Each entry owns its own settings handling and icon/feedback
 * updates; app.js only routes host events here.
 */

import * as power from './power.js';
import * as brightness from './brightness.js';
import * as brightnessUp from './brightness-up.js';
import * as brightnessDown from './brightness-down.js';
import * as hue from './hue.js';
import * as huePresets from './hue-presets.js';
import * as hueUp from './hue-up.js';
import * as hueDown from './hue-down.js';
import * as saturation from './saturation.js';
import * as saturationUp from './saturation-up.js';
import * as saturationDown from './saturation-down.js';
import * as cct from './cct.js';
import * as cctPresets from './cct-presets.js';
import * as cctUp from './cct-up.js';
import * as cctDown from './cct-down.js';
import * as scan from './scan.js';

const MODULES = [
  power,
  brightness,
  brightnessUp,
  brightnessDown,
  hue,
  huePresets,
  hueUp,
  hueDown,
  saturation,
  saturationUp,
  saturationDown,
  cct,
  cctPresets,
  cctUp,
  cctDown,
  scan,
];

export const registry = new Map();
for (const mod of MODULES) registry.set(mod.uuid, mod);

export function findByUuid(uuid) {
  return registry.get(uuid) || null;
}

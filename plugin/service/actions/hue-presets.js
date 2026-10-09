/**
 * Hue Presets - each press walks the hue preset list in order, wrapping at the
 * end.
 *
 * This is the tap half that used to live inside the Hue action itself. It is kept
 * out of `hue.js` because a dial can sweep and a button cannot: sharing one action
 * meant the key press had to choose between a preset jump and a plain nudge. See
 * `hue-up.js` and `hue-down.js` for the nudge.
 *
 * The list is bare degrees, not hue:saturation pairs: a hue preset that also
 * changed the saturation would stop being a hue preset. `setHsl` keeps whatever
 * saturation and brightness the dial left behind.
 *
 * The walk itself lives in `hue.js` so this key and the dial's own press cannot
 * drift apart.
 */

import { ACTION, STATE } from '../core/constants.js';
import { applyNextHuePreset } from './hue.js';
import { setStateIcon, setTitle } from '../core/ui.js';

export const uuid = ACTION.HUE_PRESETS;

export const defaults = {
  device: '',
  presets: '0,30,60,120,180,240,300',
};

export function render({ $UD, context, snap }) {
  // No preset number on the key: the service would have to parse the list on every
  // repaint to know it. The current hue is truthful either way.
  const value = `${Math.round(snap.hue)}`;
  setStateIcon($UD, context, STATE.DEFAULT, value);
  setTitle($UD, context, `presets (${value})`);
}

export async function onRun(ctx) {
  await applyNextHuePreset(ctx);
}

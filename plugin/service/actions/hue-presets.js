/**
 * Hue Presets - each press walks the colour presets in order, wrapping at the end.
 *
 * This is the tap half that used to live inside the Hue action itself. It is kept
 * out of `hue.js` because a dial can sweep and a button cannot: sharing one action
 * meant the key press had to choose between a preset jump and a plain nudge. See
 * `hue-up.js` and `hue-down.js` for the nudge.
 *
 * A preset is "hue:saturation", because a colour needs both: at saturation 0 the
 * hue is invisible, so a hue-only preset would often land on nothing at all. A bare
 * hue is still accepted and keeps the saturation the dial left behind.
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
  presets: '0:100,30:100,60:100,120:100,180:100,240:100,300:100',
  presetNames: 'Red,Orange,Yellow,Green,Cyan,Blue,Magenta',
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

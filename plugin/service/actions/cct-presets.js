/**
 * CCT Presets - each press walks the measured scenes in order, wrapping at the
 * end.
 *
 * This is the tap half that used to live inside the CCT action itself. It is
 * kept out of `cct.js` because a dial can sweep and a button cannot: sharing one
 * action meant the key press had to choose between a scene jump and a plain
 * nudge. See `cct-up.js` and `cct-down.js` for the nudge.
 *
 * The scenes are "kelvin:brightness" pairs, not bare temperatures: each was read
 * with a colour meter and carries the level it was measured at, so applying one
 * restores the colour *and* the brightness together.
 */

import { ACTION } from '../core/constants.js';
import { applyNextScene } from './cct.js';
import { setTitle } from '../core/ui.js';

export const uuid = ACTION.CCT_PRESETS;

export const defaults = {
  device: '',
  presets: '3400:28,4500:16,5000:16,5600:28,6500:100',
  presetNames: 'Candle,Sunset,Afternoon light,Sunlight,Cold blue light',
};

export function render({ $UD, context, snap }) {
  // No scene number on the key: the service would have to parse the list on every
  // repaint to know it. The current temperature is shown instead, and it is shown
  // whatever mode the lamp is in. It used to read "HSL" in colour mode, which told the
  // user nothing about the setting this key is about - and the three dials beside it
  // show their value either way. The last commanded temperature survives a colour
  // command untouched, so it is the value a press would move from.
  const value = `${snap.cct}K`;
  setTitle($UD, context, value);
}

export async function onRun(ctx) {
  await applyNextScene(ctx, ctx.settings.presets);
}

/**
 * Power action - on / off / toggle, with a two-state icon.
 */

import { ACTION } from '../core/constants.js';
import { setStateIcon, setTitle } from '../core/ui.js';

export const uuid = ACTION.POWER;

export const defaults = { device: '', behaviour: 'toggle' };

export function render({ $UD, context, snap }) {
  // On/off is what this action does, so it keeps two states. Reachability is not
  // mixed in: the property inspector reports it, the deck shows the last intent.
  const on = Boolean(snap.power);
  setStateIcon($UD, context, on ? 1 : 0, on ? 'ON' : 'OFF');
  setTitle($UD, context, on ? 'ON' : 'OFF');
}

export async function onRun({ settings, light, report }) {
  const behaviour = settings.behaviour || defaults.behaviour;
  try {
    if (behaviour === 'on') await light.setPower(true);
    else if (behaviour === 'off') await light.setPower(false);
    else await light.togglePower();
  } catch (err) {
    report(err);
  }
}

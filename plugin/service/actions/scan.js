/**
 * Scan action - run a BLE discovery pass and report the  devices found.
 * The property inspector of this action lists the result so a device can be
 * picked without typing a MAC address.
 *
 * Button-only: turning a dial has nothing to scan or to change here, so the dial
 * readout it used to show was a number the user could not act on.
 */

import { ACTION, STATE } from '../core/constants.js';
import { setStateIcon, setTitle } from '../core/ui.js';

export const uuid = ACTION.SCAN;

export const defaults = { duration: 6, only: true, device: '' };

export function render({ $UD, context, knownDevices }) {
  const registered = knownDevices ? knownDevices() : [];
  setStateIcon($UD, context, STATE.DEFAULT, registered.length ? `${registered.length}` : 'SET');
  setTitle($UD, context, `${registered.length} light${registered.length === 1 ? '' : 's'}`);
}

export async function onRun(ctx) {
  const { $UD, context, settings, registry, report, onScan, onScanOthers, pairDevice, bindDevice } = ctx;
  const duration = Math.min(20, Math.max(2, Number(settings.duration) || defaults.duration));
  const only = settings.only === undefined ? true : settings.only !== 'false';
  $UD.setStateIcon(context, STATE.DEFAULT, '...');
  try {
    // Discovery runs on its own transport, so the other fixtures keep their link.
    const devices = await registry.scan({ duration: duration * 1000, only });
    onScan(context, devices);
    if (devices.length === 1) {
      const device = pairDevice(devices[0].address, devices[0].name);
      // A lone hit is almost always what the user wanted: bind this key to it.
      bindDevice(device.id);
      $UD.toast(` ${devices[0].name} registered`);
    } else if (devices.length === 0) {
      // A lamp that advertises no name is invisible to the filter, yet it is
      // still reachable: offer everything that was in range so it can be picked.
      if (only) {
        const others = await registry.scan({ duration: 4000, only: false });
        onScanOthers(context, others);
      }
      $UD.toast('No  name found - other devices in range are listed in the property inspector');
    } else {
      $UD.toast(`${devices.length}  devices found - add one in the property inspector`);
    }
  } catch (err) {
    report(err);
  }
}

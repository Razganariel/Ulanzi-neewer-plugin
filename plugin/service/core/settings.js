/**
 * The shape of what the plugin keeps in the host's global settings.
 *
 * This lives apart from the service entry point on purpose: the entry opens a websocket
 * to UlanziStudio the moment it is imported, so nothing in it can be exercised by a test.
 * The rules below are the part that has to be right, and they are the part that used to
 * have no coverage at all.
 */

/** A settings object with nothing in it, so a missing read cannot look like a light. */
export function emptySettings() {
  return { devices: [], activeId: '', address: '', name: '', states: {} };
}

/**
 * Which fixture the single-light fields describe.
 *
 * `activeId` is the registry's default, but it can point at a fixture that is gone, in
 * which case the first remaining one stands in. With no fixture at all there is nothing
 * to point at, and the address and name must be cleared rather than left over from a
 * light that was deleted.
 *
 * @param {object[]} devices
 * @param {string} activeId
 * @returns {{address: string, name: string}}
 */
export function activeDeviceFields(devices, activeId) {
  const list = Array.isArray(devices) ? devices : [];
  const active = list.find((device) => device && device.id === activeId) || list.find(Boolean) || null;
  return { address: active?.address || '', name: active?.name || '' };
}

/**
 * Builds what gets written to the host.
 *
 * `states` is the last commanded state per fixture, and it is kept because the fixtures
 * cannot be read: they have no read command, and the one frame they volunteer carries a
 * constant. Without it the deck would come back claiming a brightness nobody chose.
 *
 * @param {object[]} devices
 * @param {string} activeId
 * @param {Record<string, object>} [states]
 * @returns {object} the settings to hand to the host
 */
export function buildSettings(devices, activeId, states) {
  const list = Array.isArray(devices) ? devices : [];
  return {
    devices: list,
    activeId,
    states: states || {},
    ...activeDeviceFields(list, activeId),
  };
}

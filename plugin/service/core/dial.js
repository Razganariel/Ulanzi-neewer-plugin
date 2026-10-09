/**
 * Dial helpers.
 *
 * A dial answers two host events: rotation, reported as
 * rotateEvent = 'left' | 'right' | 'hold-left' | 'hold-right', and a press, which
 * the host sends as its own event with no direction at all.
 *
 * Both are resolved from the fixture's reported state rather than from anything the
 * plugin remembers, which is what keeps a dial honest: a lamp the user moved by hand,
 * or another action drove, still behaves as if it had never been touched. The
 * helpers here are the two shared pieces of that rule - how a rotation is turned into
 * a signed step, and how a press walks a preset list.
 */

/** A rotation as -1 or +1, or 0 for an event that is not a rotation. */
export function rotateSteps(message) {
  const event = message && message.rotateEvent;
  if (event === 'left' || event === 'hold-left') return -1;
  if (event === 'right' || event === 'hold-right') return 1;
  return 0;
}

/**
 * The preset a press should apply: one step along the list from the value in use,
 * wrapping at the end.
 *
 * Stepping is by position, not by value. A value search - "the first entry above
 * what the lamp is showing" - silently assumes the list ascends, and that stops being
 * true as soon as someone types the entries in another order or appends a low one at
 * the end. The out-of-order entry is then skipped on every lap and can never be
 * reached, with no symptom other than a light that skips one of the settings.
 *
 * `valueOf` is what makes this usable for both the plain number lists (brightness,
 * saturation) and the paired ones (a scene carries a brightness, a colour a
 * saturation): the walk only ever needs the value that orders the list.
 *
 * When the lamp is not sitting on any entry - the dial swept it away, or another
 * action moved it - the walk starts at the first entry above the current value, so a
 * press still moves forward instead of backwards.
 *
 * @param {Array} list     parsed entries, in the order the user wrote them
 * @param {number} current the value the lamp is showing now
 * @param {(item: *) => number} valueOf
 * @returns {*} the next entry, or null when the list is empty
 */
export function walkList(list, current, valueOf) {
  if (!list.length) return null;
  const at = list.findIndex((item) => valueOf(item) === current);
  if (at >= 0) return list[(at + 1) % list.length];
  return list.find((item) => valueOf(item) > current) ?? list[0];
}

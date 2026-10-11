/**
 * Host UI helpers. The encoder display commands (setFeedbackLayout / setFeedback)
 * need UlanziStudio 3.3.0+; on older hosts they must not break the classic state
 * icon, so every call is individually guarded.
 */

export function setStateIcon($UD, context, state, text) {
  try {
    $UD.setStateIcon(context, state, text);
  } catch {
    /* host too old for this command */
  }
}

/**
 * State icon, sent once per key.
 *
 * Every action but Power declares a single state whose image never changes, so a
 * repaint that resends it asks the host to repaint something identical. That repaint is
 * not free of consequence: the state carries the name of its state - "CCT", "Saturation" -
 * and on a dial it showed that name for a frame before the level came back.
 *
 * The level is carried by `setTitle` on a button and by `setFeedback` on a dial, so
 * dropping the repeated state frame costs nothing. Power and Scan do keep sending it:
 * their state or their text genuinely changes, and they use `setStateIcon` directly.
 *
 * Re-sent when the key is added or removed, since the host rebuilds it either way.
 *
 * @param {object} $UD
 * @param {string} context
 * @param {number|string} state manifest state index
 * @param {string} [text]
 */
export function setStateIconOnce($UD, context, state, text) {
  const key = `${context}|${state}`;
  if (stateIconsSent.has(key)) return;
  stateIconsSent.add(key);
  setStateIcon($UD, context, state, text);
}

/** @type {Set<string>} */
const stateIconsSent = new Set();

/**
 * Forgets what was drawn on a key, so the next repaint sends it again.
 *
 * @param {string} context
 */
export function forgetStateIcon(context) {
  for (const key of [...stateIconsSent]) {
    if (key.startsWith(`${context}|`)) stateIconsSent.delete(key);
  }
}

export function setTitle($UD, context, text) {
  try {
    $UD.setTitle(context, text);
  } catch {
    /* ignore */
  }
}

/**
 * Encoder readout. Protocol V3.1 only ships built-in layout ids, and $UA1 is the
 * one every shipped plugin uses, so we stay on it and follow the documented
 * element shape ({ title: { text }, icon: { value } }). The value goes in the
 * title because that is the only element guaranteed to exist in $UA1.
 *
 * The layout is sent once per key, not on every repaint. Changing the layout is what
 * makes the host rebuild the key, and until the feedback that follows arrives it has
 * nothing to draw but the name of the state - so a dial flashed "Saturation" for a frame
 * every time anything else on the deck was touched. The content still goes out every
 * time; only the repeated layout switch is gone.
 */

/** Contexts whose encoder layout has already been applied. */
const layoutsApplied = new Set();

export function setEncoderText($UD, context, value, label, icon) {
  try {
    if (!layoutsApplied.has(context)) {
      $UD.setFeedbackLayout(context, '$UA1');
      layoutsApplied.add(context);
    }
    const layout = { title: { text: label ? `${label} ${value}` : String(value) } };
    if (icon) layout.icon = { value: icon };
    $UD.setFeedback(context, layout);
  } catch {
    /* host without V3.1 display support */
  }
}

/**
 * Forgets the layout of a key, so the next readout applies it again.
 *
 * Called when a key is added or removed: the host rebuilds the key either way, and a
 * layout that was applied to the previous instance is not necessarily applied to the new
 * one.
 *
 * @param {string} context
 */
export function forgetEncoderLayout(context) {
  layoutsApplied.delete(context);
}

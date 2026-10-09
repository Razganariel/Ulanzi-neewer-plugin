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
 */
export function setEncoderText($UD, context, value, label, icon) {
  try {
    $UD.setFeedbackLayout(context, '$UA1');
    const layout = { title: { text: label ? `${label} ${value}` : String(value) } };
    if (icon) layout.icon = { value: icon };
    $UD.setFeedback(context, layout);
  } catch {
    /* host without V3.1 display support */
  }
}

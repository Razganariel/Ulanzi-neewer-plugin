/**
 * Saturation dial inspector: which light to drive, the range to sweep, and the values
 * a press steps through.
 *
 * The rows are packed back into the single `presets` string by the shared editor, so
 * the service still reads one flat list of numbers and nothing downstream has to know
 * the panel was split into fields. The range and step fields above keep saving as they
 * are edited; only the rows wait for their own button.
 */

const editor = presetEditor({
  value: { label: 'Saturation', name: 'Value', min: 0, max: 100 },
});

PI.panel({ onSettings: (settings) => editor.render(settings) });

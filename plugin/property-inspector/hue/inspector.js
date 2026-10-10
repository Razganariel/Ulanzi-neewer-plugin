/**
 * Hue dial inspector: which light to drive, the step a rotation takes, and the colours
 * a press walks.
 *
 * The rows are packed back into the single `presets` string by the shared editor, so
 * the service still reads one flat "hue:saturation" list and nothing downstream has to
 * know the panel was split into fields. The step field above keeps saving as it is
 * edited; only the rows wait for their own button.
 *
 * This list belongs to the dial. The Hue Presets key carries its own.
 */

const editor = presetEditor({
  value: { label: 'Hue', name: 'Colour', min: 0, max: 359 },
  third: { label: 'saturation', min: 0, max: 100 },
});

PI.panel({ onSettings: (settings) => editor.render(settings) });

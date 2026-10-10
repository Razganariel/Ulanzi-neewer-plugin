/**
 * Hue Presets inspector: which light to drive, and the colour presets the key walks.
 *
 * The rows are packed back into the single `presets` string by the shared editor, so
 * the service still reads one flat "hue:saturation" list and nothing downstream has
 * to know the panel was split into fields.
 */

const editor = presetEditor({
  value: { label: 'Hue', min: 0, max: 359 },
  third: { label: 'Saturation', min: 0, max: 100 },
});

PI.panel({ onSettings: (settings) => editor.render(settings) });

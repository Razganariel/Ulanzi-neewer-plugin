/**
 * CCT Presets inspector: which light to drive, and the scenes the key walks.
 *
 * The rows are packed back into the single `presets` string by the shared editor, so
 * the service still reads one flat "kelvin:brightness" list and nothing downstream
 * has to know the panel was split into fields.
 */

const editor = presetEditor({
  value: { label: 'Temperature', min: 2500, max: 8500 },
  third: { label: 'Brightness', min: 1, max: 100 },
});

PI.panel({ onSettings: (settings) => editor.render(settings) });

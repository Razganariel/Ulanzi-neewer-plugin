/**
 * CCT dial inspector: which light to drive, the range to sweep, and the scenes a press
 * walks.
 *
 * The rows are packed back into the single `presets` string by the shared editor, so
 * the service still reads one flat "kelvin:brightness" list and nothing downstream has
 * to know the panel was split into fields. The step, range and wrap fields above keep
 * saving as they are edited; only the rows wait for their own button.
 *
 * This list belongs to the dial. The CCT Presets key carries its own.
 */

const editor = presetEditor({
  value: { label: 'Temperature', name: 'Scene', min: 2500, max: 8500 },
  third: { label: 'brightness', min: 1, max: 100 },
});

PI.panel({ onSettings: (settings) => editor.render(settings) });

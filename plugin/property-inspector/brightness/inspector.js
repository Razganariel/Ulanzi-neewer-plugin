/**
 * Brightness dial inspector: which light to drive, the range to sweep, and the values
 * a press steps through.
 *
 * The rows are packed back into the single `presets` string by the shared editor, so
 * the service still reads one flat list of numbers and nothing downstream has to know
 * the panel was split into fields. The range and step fields above keep saving as they
 * are edited; only the rows wait for their own button.
 */

const editor = presetEditor({
  value: { label: 'Brightness', name: 'Value', min: 1, max: 100 },
});

PI.panel({
  detail: (state) =>
    `${state.name || 'Neewer'} ${state.address || '-'} - ${state.brightness}% - mode ${state.mode}`,
  onSettings: (settings) => editor.render(settings),
});

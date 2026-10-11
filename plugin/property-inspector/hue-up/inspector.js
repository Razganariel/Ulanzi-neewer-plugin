/**
 * Hue Up inspector: which light to drive and how big a step a press takes.
 */

STEPPER_PI({
  field: 'hue',
  unit: '°',
  summary: 'Every press advances the hue one step, wrapping at 360°.',
});

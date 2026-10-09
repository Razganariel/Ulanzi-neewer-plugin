/**
 * Hue Down inspector: which light to drive and how big a step a press takes.
 */

STEPPER_PI({
  field: 'hue',
  unit: '°',
  summary: 'Every press steps the hue back, wrapping at 0°.',
});

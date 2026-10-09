/**
 * Parameter helpers shared by every encoder action.
 *
 * Each action owns one physical dial, so the same parsing rules would otherwise
 * be copy-pasted per file and drift apart. The host hands settings back as
 * strings sometimes and numbers other times depending on how they were typed in
 * the property inspector, so every read goes through clamp/parseList.
 */

/** Integer clamped into [min, max], falling back when absent or unparseable. */
export function clamp(value, min, max, fallback) {
  // `Number('')` is 0 and `Number('  ')` too, so a field the user emptied would
  // silently become 0 instead of keeping its default. Blank is not a number.
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Reads a dial step, refusing steps that would make the dial unusable: a step
 * wider than the range would freeze the fixture on its current value.
 */
export function dialStep(value, min, max, fallback, allowed = null) {
  const span = Math.max(1, max - min);
  // Clamping the raw value into [1, span] would quietly turn 0 into 1, so an
  // unusable step has to be recognised as such and replaced by the default.
  const blank = value === undefined || value === null || String(value).trim() === '';
  const n = blank ? NaN : Number(value);
  let step = Number.isFinite(n) ? Math.round(n) : NaN;
  if (!(step >= 1) || step > span) step = fallback;
  return allowed && !allowed.includes(step) ? fallback : step;
}

/** Comma separated integers, duplicates removed, order preserved. */
export function parseList(raw) {
  const seen = new Set();
  const out = [];
  for (const part of String(raw ?? '').split(',')) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const n = Number(trimmed);
    if (!Number.isFinite(n)) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/**
 * Next preset strictly after `current`, wrapping at the end. Stepping to the
 * first preset when every preset is already below `current` keeps a full sweep
 * always moving instead of sticking on the last one.
 */
export function nextPreset(presets, current) {
  if (!presets.length) return null;
  return presets.find((value) => value > current) ?? presets[0];
}

/** Boolean read from a setting the host may have stored as "false" or false. */
export function bool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const s = String(value).trim().toLowerCase();
  if (s === 'false' || s === '0' || s === 'no') return false;
  if (s === 'true' || s === '1' || s === 'yes') return true;
  return fallback;
}

/** Wrap `value` into [min, max] instead of clamping, for endless dials. */
export function wrap(value, min, max) {
  const span = max - min + 1;
  if (span <= 0) return min;
  return min + ((((Math.round(value) - min) % span) + span) % span);
}
/**
 * Row editor for the preset lists, shared by the Hue Presets and CCT Presets panels.
 *
 * The service reads `presets` as one flat string: "kelvin:brightness" for a scene,
 * "hue:saturation" for a colour. The rows on screen are a view over that string,
 * not a second copy of it: every save rewrites the whole string from the rows, so
 * the two can never drift apart.
 *
 * Saving is explicit, one button per row plus one to add. That is not a detail: the
 * panel rebuilds its rows whenever the settings arrive, and rebuilding while a cell
 * is being typed into would move the caret away mid-word. An explicit save means the
 * only time the rows are rebuilt is a time the user just asked for.
 *
 * The host echoes the settings back after a save. Rebuilding on that echo would be
 * harmless but pointless, and it would throw away the caret for no reason, so the
 * panel ignores an echo that matches what it just sent.
 */

(function () {
  const BLANK = { name: '', value: '', third: '' };
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // Floppy disk and bin. Inline rather than a file so the panel cannot fail to load
  // an icon, and so they follow the button colour.
  const SAVE_ICON = ['M5 3h10l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M8 3v5h7V3', 'M8 21v-6h8v6'];
  const DELETE_ICON = ['M4 7h16', 'M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12', 'M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2', 'M10 11v6', 'M14 11v6'];

  /**
   * A whole number inside [min, max], or null when the cell is not one.
   *
   * Out of range is refused rather than clamped. This editor saves on an explicit
   * button, so a 99999 typed into a 2500-8500 field is a mistake worth reporting:
   * silently storing 2500 would turn it into a real scene nobody asked for, and the
   * only symptom would be the lamp coming up in an unexpected colour.
   */
  function numberOrNull(cell, min, max) {
    const text = String(cell ?? '').trim();
    if (text === '') return null;
    const n = Number(text);
    if (!Number.isFinite(n)) return null;
    const rounded = Math.round(n);
    if (rounded < min || rounded > max) return null;
    return rounded;
  }

  function cell(tag, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  /**
   * @param {object} spec
   * @param {{label:string, unit:string, min:number, max:number}} spec.value
   *        the axis the presets are ordered by
   * @param {{label:string, unit:string, min:number, max:number}} spec.third
   *        the axis a preset carries alongside it; empty means "keep current"
   * @param {string} [spec.title]  column heading for the third axis
   */
  window.presetEditor = function createPresetEditor(spec) {
    const body = document.getElementById('preset-rows');
    const status = document.getElementById('preset-status');
    const addButton = document.getElementById('preset-add');
    /** What this panel last sent, so the host echo does not rebuild the rows. */
    let emitted = null;

    /**
     * Builds one editable row.
     *
     * The inputs are named after their position rather than sharing a name: a shared
     * name would come back from FormData as an array, and the position has to survive
     * a deletion for the numbering to stay right.
     */
    function row(index, entry) {
      const tr = cell('tr', 'preset-row');

      const number = cell('td', 'pick');
      number.dataset.index = String(index);
      tr.appendChild(number);

      for (const field of ['name', 'value', 'third']) {
        const td = cell('td');
        const input = document.createElement('input');
        input.type = 'text';
        input.name = `p${index}_${field}`;
        input.value = entry[field];
        input.dataset.field = field;
        td.appendChild(input);
        tr.appendChild(td);
      }

      const actions = cell('td', 'actions');
      actions.appendChild(iconButton('Save this preset', SAVE_ICON, () => save()));
      actions.appendChild(iconButton('Delete this preset', DELETE_ICON, () => remove(index)));
      tr.appendChild(actions);
      return tr;
    }

    /**
     * A button carrying only an icon.
     *
     * The label lives in `title` so it shows on hover and is announced, which is what
     * replaces the text the button used to spell out.
     */
    function iconButton(title, paths, onClick) {
      const node = document.createElement('button');
      // Never a submit button: a submit would navigate the WebView away.
      node.type = 'button';
      node.className = 'icon';
      node.title = title;
      node.setAttribute('aria-label', title);
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      for (const d of paths) {
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', d);
        svg.appendChild(path);
      }
      node.appendChild(svg);
      node.addEventListener('click', onClick);
      return node;
    }

    const rows = () => Array.from(body.querySelectorAll('tr'));

    function renumber() {
      rows().forEach((tr, index) => {
        const n = tr.querySelector('td');
        if (n) n.textContent = String(index + 1);
      });
    }

    function draw(entries) {
      body.textContent = '';
      entries.forEach((entry, index) => body.appendChild(row(index, entry)));
      if (!entries.length) body.appendChild(row(0, BLANK));
      renumber();
    }

    /** One empty row at the end, not saved until its own Save is pressed. */
    function addRow() {
      const list = rows();
      // Drop a trailing blank row first: one empty row is enough to type into.
      const last = list[list.length - 1];
      if (last && isBlank(readRow(last))) list[list.length - 1].remove();
      body.appendChild(row(rows().length, BLANK));
      renumber();
      clearStatus();
      const inputs = rows()[rows().length - 1].querySelectorAll('input');
      if (inputs[0]) inputs[0].focus();
    }

    function remove(index) {
      const tr = rows()[index];
      if (!tr) return;
      tr.remove();
      renumber();
      clearStatus();
      save();
    }

    function readRow(tr) {
      const out = { ...BLANK };
      for (const input of tr.querySelectorAll('input')) {
        out[input.dataset.field] = input.value.trim();
      }
      return out;
    }

    const isBlank = (entry) => !entry.name && !entry.value && !entry.third;

    function clearStatus() {
      if (status) {
        status.textContent = '';
        status.style.display = 'none';
      }
    }

    function fail(message, tr) {
      clearStatus();
      if (tr) for (const input of tr.querySelectorAll('input')) input.className = 'invalid';
      if (status) {
        status.textContent = message;
        status.style.display = 'block';
      }
    }

    /**
     * Validates the rows and, if they all hold together, writes them back.
     *
     * Nothing is sent when a cell is wrong: a half-saved preset list is worse than an
     * unsaved one, because the bad entry survives until it is noticed on the light.
     *
     * @returns {boolean} whether the settings were sent
     */
    function save() {
      const entries = [];
      for (const tr of rows()) {
        const entry = readRow(tr);
        // A row the user added and then abandoned is not a preset.
        if (isBlank(entry)) continue;
        for (const input of tr.querySelectorAll('input')) input.className = '';
        const problems = [];
        if (entry.name.includes(',')) {
          // Names travel in a comma separated list, so a comma inside one would split
          // it into two names and shift every name after it.
          problems.push('a name cannot contain a comma');
        }
        if (numberOrNull(entry.value, spec.value.min, spec.value.max) === null) {
          problems.push(`a value must be a number between ${spec.value.min} and ${spec.value.max}`);
        }
        if (entry.third !== '' && numberOrNull(entry.third, spec.third.min, spec.third.max) === null) {
          problems.push(`the ${spec.title || spec.third.label} must be empty or a number between ${spec.third.min} and ${spec.third.max}`);
        }
        if (problems.length) {
          fail(`${label(tr)}: ${problems.join('; ')}`, tr);
          return false;
        }
        entries.push(entry);
      }

      const packed = [];
      const names = [];
      entries.forEach((entry, index) => {
        const value = numberOrNull(entry.value, spec.value.min, spec.value.max);
        const third = entry.third === '' ? null : numberOrNull(entry.third, spec.third.min, spec.third.max);
        packed.push(third === null ? `${value}` : `${value}:${third}`);
        names.push(entry.name || `Scene ${index + 1}`);
      });
      const presets = packed.join(',');
      // Recorded before sending: the echo that follows must not rebuild the rows.
      emitted = presets;
      clearStatus();
      PI.push({ ...withoutRowFields(PI.read()), presets, presetNames: names.join(',') });
      return true;
    }

    /** Strips the per-row inputs so they are never persisted as settings of their own. */
    function withoutRowFields(settings) {
      const out = { ...settings };
      for (const key of Object.keys(out)) {
        if (/^p\d+_(name|value|third)$/.test(key)) delete out[key];
      }
      return out;
    }

    function label(tr) {
      const n = rows().indexOf(tr);
      return `Preset ${n + 1}`;
    }

    /** Rebuilds the rows from the stored string, unless this panel wrote it. */
    function render(settings) {
      const stored = String(settings.presets ?? '');
      if (emitted !== null && stored === emitted) return;
      emitted = null;
      clearStatus();
      const names = String(settings.presetNames ?? '')
        .split(',')
        .map((name) => name.trim());
      const entries = [];
      for (const part of stored.split(',')) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const [value, third] = trimmed.split(':');
        entries.push({
          name: names[entries.length] || '',
          value: value.trim(),
          // A bare entry means "keep the current value", and shows as an empty cell.
          third: third === undefined ? '' : third.trim(),
        });
      }
      draw(entries);
    }

    if (addButton) addButton.addEventListener('click', addRow);

    return { render, save, addRow };
  };
})();

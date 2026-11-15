import { DEFAULT_APPEARANCE, isDefaultAppearance } from '../instance-appearance.mjs';

const fields = [
  ['opacity', '不透明度', 0], ['brightness', '亮度', -100], ['contrast', '对比度', -100],
  ['saturation', '饱和度', -100], ['fog', '雾化', 0],
];
const colorText = color => '#' + color.toString(16).padStart(6, '0');
const equal = (left, right) => Object.keys(DEFAULT_APPEARANCE).every(key => left[key] === right[key]);

export function mountAppearancePanel(panel, properties, {preview, commit}) {
  const form = panel.querySelector('fieldset'), apply = panel.querySelector('[data-apply]'), reset = panel.querySelector('[data-reset]');
  const color = panel.querySelector('input[type="color"]');
  let instanceId, saved = DEFAULT_APPEARANCE, pending = false, disabled = true;
  const rows = fields.map(([key, name, min]) => {
    const row = document.createElement('div'), label = document.createElement('label');
    const input = document.createElement('input'), output = document.createElement('output');
    input.type = 'range'; input.id = 'appearance-' + key; input.min = min; input.max = 100; input.step = 1;
    label.htmlFor = input.id; label.textContent = name; output.htmlFor = input.id;
    row.className = 'appearance-row'; row.append(label, input, output);
    form.insertBefore(row, color.parentElement);
    return {key, input, output};
  });
  const draft = () => Object.fromEntries([...rows.map(({key,input}) => [key,input.valueAsNumber]), ['fogColor', Number.parseInt(color.value.slice(1),16)]]);
  function updateButtons() {
    form.disabled = disabled || pending;
    apply.disabled = equal(draft(), saved);
    reset.disabled = isDefaultAppearance(saved) && equal(draft(), saved);
  }
  function show(values) {
    for (const {key,input,output} of rows) { input.value = values[key]; output.value = values[key] + '%'; }
    color.value = colorText(values.fogColor);
    updateButtons();
  }
  function cancel() {
    if (instanceId) preview(instanceId, null);
    show(saved);
  }
  form.addEventListener('input', () => {
    if (!instanceId || form.disabled) return;
    const values = draft();
    for (const {key,output} of rows) output.value = values[key] + '%';
    preview(instanceId, values);
    updateButtons();
  });
  async function save(appearance) {
    if (!instanceId || form.disabled) return;
    pending = true; updateButtons();
    try { await commit(instanceId, appearance); }
    finally { pending = false; cancel(); }
  }
  apply.onclick = () => { const values = draft(); void save(isDefaultAppearance(values) ? null : values); };
  reset.onclick = () => { if (isDefaultAppearance(saved)) cancel(); else void save(null); };
  panel.addEventListener('toggle', () => { if (!panel.open && !pending) cancel(); });
  form.addEventListener('pointercancel', () => { if (!pending) cancel(); });
  window.addEventListener('blur', () => { if (!pending) cancel(); });
  window.addEventListener('keydown', event => { if (event.key === 'Escape' && !pending) cancel(); });
  new MutationObserver(() => { if (properties.hidden && !pending) cancel(); }).observe(properties, {attributes:true, attributeFilter:['hidden']});
  show(saved);
  return {
    sync(id, appearance, frozen) {
      const values = appearance ?? DEFAULT_APPEARANCE;
      if (id !== instanceId || !equal(values, saved)) {
        if (instanceId) preview(instanceId, null);
        instanceId = id; saved = values; show(saved);
      }
      if (frozen && !disabled && !pending) cancel();
      disabled = frozen; panel.hidden = !id;
      if (!id) panel.open = false;
      updateButtons();
    },
    cancel,
  };
}

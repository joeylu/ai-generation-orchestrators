import type { VisionObservation } from './vision-observation.ts';
import type { UiNodeType } from './tree-contract.ts';

const fields: Record<UiNodeType, readonly string[]> = {
  Image: [], Container: [], Text: ['text'], Button: ['label'], Switch: ['label', 'checked'], CheckBox: ['label', 'checked'],
  RadioGroup: ['selectedId'], Select: ['selectedId'], Input: ['value', 'placeholder', 'inputType'],
  ProgressBar: ['value', 'max'], Slider: ['value', 'min', 'max'], ScrollView: [], List: ['selectedId'],
  Panel: ['title'], Dialog: ['title', 'open'], Tabs: ['activeId'],
};
const labels: Record<string, string> = { text: '文字', label: '标签', title: '标题', checked: '是否勾选', open: '是否打开', value: '当前值', placeholder: '占位文字', inputType: '输入类型', min: '最小值', max: '最大值', selectedId: '选中项 ID（留空表示未选中）', activeId: '当前页 ID' };
type Observed = Extract<VisionObservation, { status: 'Observed' }>;

/** Edits a clone; original model observations are never mutated or resubmitted. */
export function createSemanticEditor(host: HTMLElement, observation: Observed, onDirty: () => void) {
  const draft = structuredClone(observation);
  host.replaceChildren();
  for (const component of draft.components) {
    const card = document.createElement('details');
    const heading = document.createElement('summary'); heading.textContent = `${component.componentType} · ${component.id}`;
    const typeLabel = document.createElement('label'); typeLabel.textContent = '组件类型';
    const type = document.createElement('select'); type.dataset.componentId = component.id; type.setAttribute('aria-label', `${component.id} 组件类型`);
    for (const name of Object.keys(fields)) { const option = document.createElement('option'); option.value = name; option.textContent = name; type.append(option); }
    type.value = component.componentType; typeLabel.append(type);
    const properties = document.createElement('div');
    function drawFields() {
      properties.replaceChildren();
      for (const key of fields[component.componentType]) {
        const row = document.createElement('label'); row.className = 'semantic-field';
        const caption = document.createElement('span'); caption.textContent = labels[key];
        const supplied = document.createElement('input'); supplied.type = 'checkbox'; supplied.checked = Object.hasOwn(component.visibleProps, key);
        supplied.setAttribute('aria-label', `${component.id} ${key} 已确认`);
        const input = key === 'checked' || key === 'open' || key === 'inputType' ? document.createElement('select') : document.createElement('input');
        input.setAttribute('aria-label', `${component.id} ${key}`);
        if (input instanceof HTMLSelectElement) {
          const values = key === 'inputType' ? ['text', 'password', 'email', 'number'] : ['true', 'false'];
          const unknown = document.createElement('option'); unknown.value = ''; unknown.textContent = '请选择'; input.append(unknown);
          for (const value of values) { const option = document.createElement('option'); option.value = value; option.textContent = value === 'true' ? '是' : value === 'false' ? '否' : value; input.append(option); }
        } else { input.type = ['min', 'max'].includes(key) || (key === 'value' && component.componentType !== 'Input') ? 'number' : 'text'; if (input.type === 'number') input.step = 'any'; input.placeholder = '未提供'; }
        input.value = component.visibleProps[key] == null ? '' : String(component.visibleProps[key]);
        function update() {
          if (!supplied.checked) delete component.visibleProps[key];
          else if (input.value === '' && (input instanceof HTMLSelectElement || (input instanceof HTMLInputElement && input.type === 'number') || key === 'activeId')) {
            delete component.visibleProps[key]; supplied.checked = false;
          }
          else if (key === 'checked' || key === 'open') component.visibleProps[key] = input.value === 'true';
          else if (input instanceof HTMLInputElement && input.type === 'number') component.visibleProps[key] = Number(input.value);
          else component.visibleProps[key] = key === 'selectedId' && input.value === '' ? null : input.value;
          onDirty();
        }
        input.addEventListener('input', () => { supplied.checked = true; update(); }); supplied.addEventListener('change', update);
        row.append(caption, input, supplied); properties.append(row);
      }
      const note = document.createElement('small'); note.textContent = '勾选右侧表示确认此值；文字可明确确认为空。选项内容与隐藏页面不能在这里自动补齐。'; properties.append(note);
    }
    type.addEventListener('change', () => {
      component.componentType = type.value as UiNodeType;
      component.visibleProps = {}; // A type correction cannot carry incompatible facts into the new type.
      heading.textContent = `${component.componentType} · ${component.id}`; drawFields(); onDirty();
    });
    drawFields(); card.append(heading, typeLabel, properties); host.append(card);
  }
  return { read: () => structuredClone(draft) };
}

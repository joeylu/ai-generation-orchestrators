/** Deterministic role-form editing fixture. Never submits a model request. */
export const formEditRequest = `保留现有角色名输入和按钮行为。
将角色名最大长度改为 16，占位文字改为“给角色起个名字”。
在角色名下新增“角色宣言”输入框，非必填，最多 30 个字符。
确认按钮同时提交角色名和角色宣言。
其余布局保持不变。`;

export function formEditDraft(context) {
  const section = context.spec.sections.find(section => section.rows.some(row => row.kind === 'input'));
  const input = section.rows.find(row => row.kind === 'input');
  const confirm = context.spec.sections.flatMap(section => section.rows).find(row => row.action?.kind === 'submit');
  const recipe = context.catalog.recipes.find(recipe => recipe.kind === 'input-row' && recipe.supports.includes('pixi'));
  const operations = [
    { op: 'set-input-properties', rowId: input.id, placeholder: '给角色起个名字', inputType: input.inputType,
      readOnly: input.readOnly, maxLength: 16, validation: structuredClone(input.validation) },
    { op: 'add-input-row', sectionId: section.id, afterRowId: input.id, id: 'declaration',
      recipeKey: `${recipe.id}@${recipe.version}`, label: '角色宣言', enabled: true, initial: '',
      placeholder: '', inputType: 'text', readOnly: false, maxLength: 30, required: false,
      minLength: 0, validationMessages: null },
    { op: 'set-button-action', rowId: confirm.id, action: { kind: 'submit', fields: [...confirm.action.fields, 'declaration'] } },
  ];
  return { codexEditDraftVersion: '0.2', contextSha256: context.sha256,
    patch: { patchVersion: '0.1', baseSpecSha256: context.baseSpecSha256, reason: 'Expand the input limit, add the requested optional declaration, and submit both fields.', operations },
    bases: operations.map(() => ({ kind: 'request-interpretation', quote: context.request.text })), unresolved: [] };
}

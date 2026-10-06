export const formRequest = { requestVersion: '0.1', id: 'role-name', target: 'pixi',
  text: '生成角色命名面板。角色名输入框，单行文本，初始为空，占位文字请输入角色名，必填，最少2个字符，最多12个字符。确认按钮校验并提交角色名；取消按钮只通知宿主，保留输入。' };
export function formIntent(context) {
  return { panelIntentVersion: '0.6', contextSha256: context.sha256, unresolved: [], panel: {
    id: context.request.id, title: '角色命名', themeKey: 'modern-mint-light@0.1.0', panelSurface: null,
    layout: { width: null, canvasWidth: null, canvasHeight: null, maxHeight: 480, overflow: 'auto' },
    body: { kind: 'column', children: [{ kind: 'section', id: 'section0', title: '创建角色', rows: [
      { id: 'row0', kind: 'input', label: '角色名', recipeKey: 'forms.input@0.1.0', sourceQuote: context.request.text,
        icon: null, enabled: true, initial: '', placeholder: '请输入角色名', inputType: 'text', readOnly: false, maxLength: 12, required: true, minLength: 2 },
      { id: 'row1', kind: 'button', label: '确认', recipeKey: 'settings.button@0.1.0', sourceQuote: context.request.text,
        icon: null, enabled: true, action: 'submit', resetRows: [], submitRows: ['row0'] },
      { id: 'row2', kind: 'button', label: '取消', recipeKey: 'settings.button@0.1.0', sourceQuote: context.request.text,
        icon: null, enabled: true, action: 'emit', resetRows: [], submitRows: [] },
    ] }] },
  } };
}

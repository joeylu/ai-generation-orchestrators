/** Explicit offline UI fixtures, never model interpretation. */
export const roleRequest = { requestVersion: '0.1', id: 'role-naming', target: 'pixi', text: '做一个角色命名界面，让玩家输入角色名后确认，也能取消。角色名初始为空，必填，至少2个字符，最多12个字符，占位请输入角色名。' };
export function roleIntent(context, theme = context.catalog.themes[0]) {
  const common = (kind, label) => ({ kind, label, recipeKey: `settings.${kind}@0.1.0`, sourceRef: 'request', icon: null });
  return { panelIntentVersion: '0.8', contextSha256: context.sha256, unresolved: [], panel: {
    id: context.request.id, title: '角色命名界面', themeKey: `${theme.id}@${theme.version}`, panelSurface: null,
    layout: { width: null, canvasWidth: null, canvasHeight: null, maxHeight: null, overflow: 'auto' },
    body: { kind: 'column', children: [{ kind: 'section', title: '角色命名', rows: [
      { ...common('input', '角色名'), recipeKey: 'forms.input@0.1.0', enabled: true, initial: '', placeholder: '请输入角色名', inputType: 'text', readOnly: false, maxLength: 12, required: true, minLength: 2 },
      { ...common('button', '确认'), enabled: true, action: 'submit', resetRows: [], submitRows: [0] },
      { ...common('button', '取消'), enabled: true, action: 'emit', resetRows: [], submitRows: [] },
    ] }] },
  } };
}

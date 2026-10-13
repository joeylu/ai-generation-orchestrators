/** Versioned Panel authoring capabilities. No renderer or provider dependencies. */
export const FULL_COMPONENT_KINDS = ['checkbox', 'radio', 'list', 'dialog'];
export const CONTENT_KINDS = ['slider', 'switch', 'select', 'button', 'text', 'progress', 'input', 'image', ...FULL_COMPONENT_KINDS];
export const CHOICE_KINDS = ['select', 'radio', 'list'];
export const fullComponents = spec => spec?.panelSpecVersion === '0.16';
export const choiceLimit = kind => kind === 'list' ? 64 : 8;

// This guard covers explicit component names, not general natural-language understanding.
// In particular an ordinary "确认面板" or "长列表设置" is not a Dialog/List demand.
export function explicitComponentRequirements(request) {
  const patterns = [
    ['checkbox', /\bCheckBox\b|复选框/giu],
    ['radio', /\bRadioGroup\b|单选按钮组|单选框组/giu],
    ['list', /\bList\b|动态列表|可选择的?列表|列表组件/giu],
    ['dialog', /\bDialog\b|模态(?:对话框|弹窗)|独立(?:对话框|弹窗)/giu],
  ];
  const required = new Set();
  const literals = [...request.matchAll(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"\r\n]*"|(?<![A-Za-z0-9])'[^'\r\n]*'(?![A-Za-z0-9])/gu)];
  for (const [kind, pattern] of patterns) for (const match of request.matchAll(pattern)) {
    const literal = literals.find(quote=>match.index>quote.index&&match.index<quote.index+quote[0].length-1);
    if(literal){
      const before=request.slice(Math.max(0,literal.index-32),literal.index);
      const after=request.slice(literal.index+literal[0].length);
      // A quoted label/body may literally say "Dialog" or "List". Only an exact
      // quoted type used as a component reference participates in this guard.
      const exactType=literal[0].slice(1,-1).trim().toLowerCase()===match[0].toLowerCase();
      const typeUse=/(?:使用|采用|新增|添加|生成|创建|放置|需要|要求|用|要|一个|use|add|create|need)\s*$/iu.test(before)
        || /^\s*(?:组件|控件|类型|component\b|widget\b)/iu.test(after);
      const copyUse=/(?:标签|标题|正文|文案|文字|内容|显示|名为|名称|label|title|body|text|copy)\s*(?:是|为|叫|逐字|必须|exactly|:|：|\s)*$/iu.test(before);
      if(!exactType||!typeUse||copyUse)continue;
    }
    const prefix = request.slice(Math.max(0, match.index - 28), match.index).split(/[。；;，,\n]/u).at(-1);
    if (/(?:不要|不需要|不使用|禁止|无需|移除|删除|不添加|不是|不能|不用|without|not)\s*(?:用|使用|添加)?[^。；;，,\n]{0,12}$/iu.test(prefix)) {
      // A later direct exclusion cancels an earlier simple requirement. Negating
      // an action ("不要修改 List 的文字") does not remove the existing List demand.
      if(/(?:不要|不需要|不使用|禁止|无需|移除|删除|不添加|不是|不能|不用|without|not)\s*(?:用|使用|添加|生成|显示|放置)?\s*(?:任何|这个|该|一个)?\s*[“"'「『]?\s*$/iu.test(prefix))required.delete(kind);
      continue;
    }
    required.add(kind);
  }
  return [...required];
}

export function missingExplicitComponents(request, spec) {
  const actual = new Set(spec.sections.flatMap(section => section.rows.map(row => row.kind)));
  return explicitComponentRequirements(request).filter(kind => !actual.has(kind));
}

export function extendedRowHeight(spec, row, textHeight) {
  const field = spec.state.find(field => field.id === row.bind);
  if (row.kind === 'radio') return Math.max(spec.layout.rowHeight, textHeight + 16 + field.options.length * 36 + 12);
  if (row.kind === 'list') return textHeight + 16 + row.visibleItems * row.itemHeight + 12;
  return null;
}

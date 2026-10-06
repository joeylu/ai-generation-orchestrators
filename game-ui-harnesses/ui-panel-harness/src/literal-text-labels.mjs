/** Narrow literal reading aid. No row inference, value repair or completeness claim. */
export function literalReadOnlyLabelPairs(text) {
  if (typeof text !== 'string' || text.length > 16000) throw new Error('REQUEST_READING_INPUT');
  // A literal scan cannot resolve historical, conditional or superseded facts.
  // Keep such requests on the Agent's ordinary interpretation path.
  if (/(?:改为|改成|改一下|更正|补充回答|原先|原来|曾经|如果|假如|例如|比如|示例)/u.test(text)) return [];
  const pairs = [];
  // Only the explicit consecutive syntax: read-only ..., label is X, display "Y".
  // Free prose, unquoted content and indirect/historical/negative examples are not contracts.
  const pattern = /只读(?:文本|文字|提示)[^，,。；;\r\n]{0,32}[，,][ \t]*标签(?:就是|为|是)[ \t]*(?:“([^”\r\n]{1,80})”|"([^"\r\n]{1,80})"|([^，,。；;“”"\r\n]{1,80}))[，,][ \t]*(?:显示|内容(?:为|是)|文本(?:为|是))[ \t]*(?:“([^”\r\n]{1,200})”|"([^"\r\n]{1,200})")/gu;
  for (const clause of text.split(/[。；;\r\n]/u)) {
    for (const match of clause.matchAll(pattern)) {
      const prefix = clause.slice(0, match.index);
      if (/(?:不要|不需要|无需|别用|例如|比如|示例|如果|假如|原先|原来|曾经)/u.test(prefix)) continue;
      pairs.push({ label: match[1] ?? match[2] ?? match[3].trim(), text: match[4] ?? match[5], quote: match[0] });
    }
  }
  return pairs.length <= 128 ? pairs : [];
}

/** Only definite label/content substitutions at the current native CLI boundary.
 * Shared content under several explicit labels is allowed; missing/other rows
 * and ambiguous prose still belong to normal business interpretation/gates. */
export function nativeReadOnlyLabelMismatch(request, body) {
  const pairs = literalReadOnlyLabelPairs(request); if (!pairs.length) return null;
  const visit = (node, path) => {
    if (node.kind === 'tabs') {
      for (let i = 0; i < node.pages.length; i++) { const result = visit(node.pages[i].body, `${path}.pages[${i}].body`); if (result) return result; }
    } else if (node.kind === 'section') {
      for (let i = 0; i < node.rows.length; i++) {
        const row = node.rows[i]; if (row.kind !== 'text') continue;
        const matches = pairs.filter(pair => pair.text === row.text);
        if (matches.length && !matches.some(pair => pair.label === row.label)) return `${path}.rows[${i}].label`;
      }
    } else for (let i = 0; i < node.children.length; i++) { const result = visit(node.children[i], `${path}.children[${i}]`); if (result) return result; }
    return null;
  };
  return visit(body, '$.panel.body');
}

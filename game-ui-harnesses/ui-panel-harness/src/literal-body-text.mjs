/** Exact body-copy hints only. This is not a general natural-language parser. */
export function literalBodyCopies(request) {
  if (typeof request !== 'string' || request.length > 16000) throw new Error('REQUEST_READING_INPUT');
  // Corrections and conditional examples need ordinary interpretation. Never
  // turn an earlier copy into a stale constraint on a later answer.
  if (/(?:更正|改为|改成|补充回答|原先|原来|曾经|例如|比如|示例)/u.test(request)) return [];
  const copies = []; let coveredUntil = 0;
  const intro = /(?:正文|说明|文案)(?:正文)?(?:按原文|原样)(?:完整)?(?:展示|显示|保留)(?:并(?:自动)?换行)?[：:][ \t]*/gu;
  for (const match of request.matchAll(intro)) {
    if (match.index < coveredUntil) continue;
    const prefix = request.slice(0, match.index), clause = prefix.split(/[。；;\r\n]/u).at(-1);
    if (/(?:不要|不需要|无需|别|如果|假如)/u.test(clause)) continue;
    const start = match.index + match[0].length, rest = request.slice(start);
    let text, end;
    if (rest.startsWith('【正文开始】')) {
      const close = rest.indexOf('【正文结束】', 6);
      if (close < 0) continue;
      text = rest.slice(6, close); end = start + close + 6;
    } else if (rest.startsWith('“') || rest.startsWith('"')) {
      let close = -1, depth = 1;
      for (let i = 1; i < rest.length; i++) {
        if (rest[0] === '“') {
          if (rest[i] === '“') depth++;
          if (rest[i] === '”' && --depth === 0) { close = i; break; }
        } else if (rest[i] === '"') {
          let slashes = 0; for (let j = i - 1; j >= 0 && rest[j] === '\\'; j--) slashes++;
          if (slashes % 2 === 0) { close = i; break; }
        }
      }
      if (close < 0) continue;
      text = rest.slice(1, close); end = start + close + 1;
    } else {
      // Unquoted prose has a definite end only when a previously named input
      // starts a separate property clause. Sentence/semicolon boundaries alone
      // never end the body; they may be part of the requested displayed copy.
      const labels = [...prefix.matchAll(/([\p{L}\p{N}_]{1,40})输入框/gu)].map(m => m[1]);
      const boundaries = labels.flatMap(label => {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const boundary = new RegExp('\\s+' + escaped + '(?:输入框)?(?:初始(?:值)?|默认(?:值)?|占位(?:文字|符))(?:为|是)?', 'gu');
        return [...rest.matchAll(boundary)].map(m => m.index);
      });
      if (!boundaries.length) continue;
      const close = Math.min(...boundaries); text = rest.slice(0, close); end = start + close;
    }
    coveredUntil = end;
    if (!text.trim() || [...text].length > 1000) continue;
    copies.push({text,quote:request.slice(match.index,end)});
  }
  return copies.length <= 32 ? copies : [];
}

/** Check only exact, bounded copy declarations at the current native boundary.
 * No output is repaired, and no label or additional control is inferred. */
export function nativeLiteralBodyMismatch(request, body) {
  const copies = literalBodyCopies(request); if (!copies.length) return null;
  const rows = [];
  const visit = (node,path) => {
    if (node.kind === 'tabs') node.pages.forEach((p,i) => visit(p.body,`${path}.pages[${i}].body`));
    else if (node.kind === 'section') node.rows.forEach((row,i) => { if (row.kind === 'text') rows.push({row,path:`${path}.rows[${i}].text`}); });
    else node.children.forEach((child,i) => visit(child,`${path}.children[${i}]`));
  };
  visit(body,'$.panel.body');
  for (const copy of copies) if (!rows.some(({row}) => row.text === copy.text)) {
    return rows.find(({row}) => copy.text.startsWith(row.text))?.path ?? (rows.length === 1 ? rows[0].path : '$.panel.body');
  }
  return null;
}

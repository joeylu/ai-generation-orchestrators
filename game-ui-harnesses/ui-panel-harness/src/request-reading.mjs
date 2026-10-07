/** Lossless reading aid only. It never infers control types, values or completeness. */
export function requestReading(text) {
  if (typeof text !== 'string' || text.length > 16000) throw new Error('REQUEST_READING_INPUT');
  const pieces = text.split(/(?<=[；;。\n])/u);
  const clauses = pieces.length <= 128 ? pieces : [text];
  const matches = [...text.matchAll(/(?:默认(?:值|选项)?(?:为|是|分别|改为)?|初值(?:为)?|初始(?:值|状态)?(?:为)?)[ \t]*[^，,。；;（）()\r\n]+/gu)].map(match => match[0]);
  return { clauses, literalDefaultMentions: matches.length <= 256 ? matches : [],
    interpretation: 'Literal substrings only. This scan does not assert missing facts, completeness or semantic correctness.' };
}

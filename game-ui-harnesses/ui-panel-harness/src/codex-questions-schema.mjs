/** Transport-only naming convention. Public proposal IDs remain symbolic ASCII IDs. */
export function buildCodexQuestionsResponseSchema() {
  return { type: 'array', items: { type: 'object', additionalProperties: false,
    required: ['id', 'question'], properties: {
      id: { type: 'string', enum: Array.from({ length: 64 }, (_, index) => `q${index}`) },
      question: { type: 'string' },
    } } };
}

export const CODEX_QUESTIONS_INSTRUCTION = `For unresolved questions, use distinct schema-provided ASCII IDs q0, q1, ... q63 in order. These are internal identifiers, never translated question text. Keep each question nonempty, concrete and at most 500 Unicode characters; return at most 64 questions. Return unresolved:[] when no business fact is missing. Do not invent missing defaults or claim compilation success.
Ask in the user's language about player-facing behavior, not protocol fields or control names. Reuse every business fact already explicit in the request; ask only for missing or conflicting facts. Where a concrete recommendation or alternative can help, append at most three complete suffix blocks to the single-line question text: 【推荐回答：<proposed answer>】 and/or 【备选回答：<alternative answer>】. At most one recommendation, each answer at most 160 Unicode characters. No newline/control characters, nested blocks, or text after these blocks. Example (syntax only, never supplies facts for the current request): 音量的范围、默认值和静音初值如何设置？【推荐回答：音量0～100，每次变化1，默认70；静音默认关闭，开启表示静音。】【备选回答：音量0～100，每次变化1，默认50；静音默认关闭，开启表示静音。】
These blocks are suggestions awaiting the user's choice, NEVER facts or authorization. In a request with 【补充回答】, the user's 回答 supplies the selected facts; unselected recommendation/alternative lines are not business evidence. Keep unresolved items exactly {id,question}; do not add choice fields. If no meaningful safe answer can be proposed, ask a plain question and allow free text. Unsupported features must be explained with supported alternatives, never a recommendation to invent runtime support.`;

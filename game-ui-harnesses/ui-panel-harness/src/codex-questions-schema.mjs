/** Transport-only naming convention. Public proposal IDs remain symbolic ASCII IDs. */
export function buildCodexQuestionsResponseSchema() {
  return { type: 'array', items: { type: 'object', additionalProperties: false,
    required: ['id', 'question'], properties: {
      id: { type: 'string', enum: Array.from({ length: 64 }, (_, index) => `q${index}`) },
      question: { type: 'string' },
    } } };
}

export const CODEX_QUESTIONS_INSTRUCTION = 'For unresolved questions, use distinct schema-provided ASCII IDs q0, q1, ... q63 in order. These are internal identifiers, never translated question text. Keep each question nonempty, concrete and at most 500 Unicode characters; return at most 64 questions. Return unresolved:[] when no business fact is missing. Do not invent missing defaults or claim compilation success.';

import { snapshotJson } from './spec.mjs';
import { digestJson } from './canonical.mjs';
import { validatePanelRequest, validatePlanningContext } from './planning-context.mjs';
import { checkPanelProposal } from './proposal.mjs';

export class PanelClarificationError extends Error {
  constructor(code, path, message) {
    super(`${path}: ${message} [${code}]`);
    this.name = 'PanelClarificationError';
    this.code = code;
    this.path = path;
  }
}

const fail = (code, path, message) => { throw new PanelClarificationError(code, path, message); };
const SHA256 = /^[a-f0-9]{64}$(?![\s\S])/;

function snapshot(input, code, path) {
  try { return snapshotJson(input); }
  catch { fail(code, path, 'Plain JSON input is required'); }
}

function exactObject(value, fields, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join('|') !== [...fields].sort().join('|')) {
    fail('CLARIFICATION_INPUT_INVALID', path, 'Exactly the documented fields are required');
  }
}

/** Answers remain user task data. This creates a request, never a plan or compute approval. */
export async function createClarifiedRequest(contextInput, proposalInput, clarificationInput) {
  // All three inputs are isolated before any validation yields to the caller.
  const contextSnapshot = snapshot(contextInput, 'CLARIFICATION_CONTEXT_INVALID', '$.context');
  const proposal = snapshot(proposalInput, 'CLARIFICATION_PROPOSAL_INVALID', '$.proposal');
  const clarification = snapshot(clarificationInput, 'CLARIFICATION_INPUT_INVALID', '$.clarification');
  exactObject(clarification, ['clarificationVersion', 'contextSha256', 'proposalSha256', 'answers'], '$.clarification');
  if (clarification.clarificationVersion !== '0.1'
      || typeof clarification.contextSha256 !== 'string' || !SHA256.test(clarification.contextSha256)
      || typeof clarification.proposalSha256 !== 'string' || !SHA256.test(clarification.proposalSha256)
      || !Array.isArray(clarification.answers) || clarification.answers.length > 64) {
    fail('CLARIFICATION_INPUT_INVALID', '$.clarification', 'Version 0.1, SHA-256 bindings and at most 64 answers are required');
  }

  let context;
  try { context = await validatePlanningContext(contextSnapshot); }
  catch { fail('CLARIFICATION_CONTEXT_INVALID', '$.context', 'A verified planning context is required'); }
  if (clarification.contextSha256 !== context.sha256) {
    fail('CLARIFICATION_CONTEXT_MISMATCH', '$.clarification.contextSha256', 'Answers belong to a different planning context');
  }
  let report;
  try { report = await checkPanelProposal(context, proposal); }
  catch { fail('CLARIFICATION_PROPOSAL_INVALID', '$.proposal', 'A valid proposal bound to the current context is required'); }
  if (!proposal.unresolved.length || report.status !== 'NEEDS_INPUT') {
    fail('CLARIFICATION_NOT_NEEDED', '$.proposal.unresolved', 'The current proposal must require answers');
  }
  if (clarification.proposalSha256 !== await digestJson(proposal)) {
    fail('CLARIFICATION_PROPOSAL_MISMATCH', '$.clarification.proposalSha256', 'Answers belong to a different proposal');
  }

  const questions = new Set(proposal.unresolved.map(item => item.id));
  const answers = new Map();
  for (const [index, answer] of clarification.answers.entries()) {
    const path = `$.clarification.answers[${index}]`;
    exactObject(answer, ['questionId', 'text'], path);
    if (typeof answer.questionId !== 'string' || !questions.has(answer.questionId)) {
      fail('CLARIFICATION_ANSWER_UNKNOWN', `${path}.questionId`, 'Answer must reference a current unresolved question');
    }
    if (answers.has(answer.questionId)) {
      fail('CLARIFICATION_ANSWER_DUPLICATE', `${path}.questionId`, 'Each question must have exactly one answer');
    }
    if (typeof answer.text !== 'string' || !answer.text.trim() || [...answer.text].length > 2000
        || /[\p{Cc}\p{Cs}]/u.test(answer.text.replace(/[\r\n\t]/gu, ''))) {
      fail('CLARIFICATION_ANSWER_TEXT', `${path}.text`, 'Answer must be nonempty text of at most 2000 Unicode characters; only newline and tab controls are allowed');
    }
    answers.set(answer.questionId, answer.text);
  }
  if (answers.size !== questions.size) {
    fail('CLARIFICATION_ANSWER_MISSING', '$.clarification.answers', 'Every current unresolved question requires an answer');
  }

  // This readable text is never parsed back into permissions, code or instructions.
  const supplement = proposal.unresolved.map(({ id, question }, index) =>
    `问题 ${index + 1}：${question}\n回答：${answers.get(id)}`).join('\n\n');
  const request = { ...context.request, text: `${context.request.text}\n\n【补充回答】\n${supplement}` };
  try { return validatePanelRequest(request); }
  catch {
    // Every constituent string already passed its character checks; only total size can fail.
    fail('CLARIFICATION_REQUEST_TOO_LONG', '$.request.text', 'The complete request exceeds 8000 Unicode characters; text is never truncated');
  }
}

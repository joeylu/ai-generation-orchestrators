import test from 'node:test';
import assert from 'node:assert/strict';
import { createCodexDiagnostic, createCodexMessageDiagnostic, validateCodexDiagnostic } from '../src/codex-diagnostics.mjs';

const binding = { operation: 'plan', contextSha256: 'a'.repeat(64), proposalJsonSha256: 'b'.repeat(64), stage: 'proposal-validation' };
const fixture = () => createCodexDiagnostic({ code: 'required', path: '$.state[0].initial',
  message: 'Private model values C:\\Users\\private-user https://private.invalid?token=SECRET' }, binding);

const messageFixture = (validatorCode = 'OUTPUT_MESSAGE_EMPTY', operation = 'plan') => createCodexMessageDiagnostic(
  validatorCode, { eventCount: validatorCode === 'OUTPUT_MESSAGE_DUPLICATE' ? 4 : 3,
    completedAgentMessages: validatorCode === 'OUTPUT_MESSAGE_DUPLICATE' ? 2 : 1,
    acceptedFinalMessages: validatorCode === 'OUTPUT_MESSAGE_DUPLICATE' ? 1 : 0 }, { ...binding, operation });

test('message diagnostics describe only rejected message structure for planning and editing', () => {
  for (const operation of ['plan', 'edit']) for (const code of ['OUTPUT_MESSAGE_EMPTY', 'OUTPUT_MESSAGE_NOT_TEXT', 'OUTPUT_MESSAGE_DUPLICATE']) {
    const diagnostic = messageFixture(code, operation);
    assert.deepEqual(validateCodexDiagnostic(diagnostic, { ...binding, operation, failureCode: 'CODEX_OUTPUT_INVALID' }), diagnostic);
    assert.equal(diagnostic.proposalJsonSha256, null); assert.equal(diagnostic.stage, 'event-validation');
    assert.equal(diagnostic.path, '$.item.text'); assert.equal(diagnostic.validatorCode, code);
    assert(!JSON.stringify(diagnostic).includes('SECRET'));
  }
});

test('message diagnostics reject raw fields, forged counters and mismatched operation, context or failure', () => {
  const value = messageFixture();
  for (const change of [{ message: 'SECRET' }, { targetIssue: 'duplicate' }, { cause: { validatorCode: 'required', path: '$' } },
    { proposalJsonSha256: binding.proposalJsonSha256 }, { stage: 'output-validation' }, { path: '$.state' },
    { validatorCode: 'OUTPUT_JSON' }, { validatorCode: 'OUTPUT_MESSAGE_DUPLICATE' }, { codexValidationDiagnosticVersion: '0.1' },
    { stream: { ...value.stream, text: 'SECRET' } }, { stream: { ...value.stream, eventCount: 2 } },
    { stream: { ...value.stream, completedAgentMessages: 2 } }, { stream: { ...value.stream, acceptedFinalMessages: 1 } },
    { stream: { ...value.stream, eventCount: 4 * 1024 * 1024 + 1 } }, { stream: { ...value.stream, eventCount: 3.5 } }])
    assert.throws(() => validateCodexDiagnostic({ ...value, ...change }), { code: 'CODEX_DIAGNOSTIC_INVALID' });
  for (const change of [{ operation: 'edit' }, { contextSha256: 'c'.repeat(64) }, { failureCode: 'CODEX_PROPOSAL_INVALID' }])
    assert.throws(() => validateCodexDiagnostic(value, { ...binding, ...change }), { code: 'CODEX_DIAGNOSTIC_INVALID' });
  let reads = 0;
  Object.defineProperty(value.stream, 'eventCount', { enumerable: true, get() { reads++; return 3; } });
  assert.throws(() => validateCodexDiagnostic(value), { code: 'CODEX_DIAGNOSTIC_INVALID' }); assert.equal(reads, 0);
});

test('diagnostics contain only bound validator constants, schema paths and fingerprints', () => {
  const value = fixture();
  assert.equal(value.validatorCode, 'required'); assert.equal(value.path, '$.state[0].initial');
  assert.deepEqual(validateCodexDiagnostic(value, binding), value);
  for (const secret of ['Private', 'private-user', 'private.invalid', 'SECRET']) assert.equal(JSON.stringify(value).includes(secret), false);
  assert.equal(createCodexDiagnostic({ message: '$.recipes: unavailable private ID' }, binding).path, '$.recipes');
});

test('unknown keys, raw messages and non-schema paths are redacted rather than echoed', () => {
  for (const path of ['$.privateToken', '$.state[0].privateToken', '$.request.secret', 'C:\\Users\\private', '$.state[9999].initial', '$.spec\n'])
    assert.equal(createCodexDiagnostic({ code: 'unknown-key', path }, binding).path, null);
  assert.equal(createCodexDiagnostic({ code: 'SECRET_TOKEN', message: 'raw secret' }, binding).validatorCode, 'VALIDATION_FAILED');
  assert.equal(createCodexDiagnostic({ code: 'required', path: '$["state"][0]["initial"]' }, binding).path, '$.state[0].initial');
});

test('diagnostics reject forged fields, unsafe paths, wrong operation or request fingerprints', () => {
  for (const change of [{ message: 'private' }, { operation: 'edit' }, { contextSha256: 'c'.repeat(64) },
    { validatorCode: 'SECRET_TOKEN' }, { path: '$.secret' }, { proposalJsonSha256: '' }, { stage: 'success' }, { codexValidationDiagnosticVersion: '2' }])
    assert.throws(() => validateCodexDiagnostic({ ...fixture(), ...change }, binding), { code: 'CODEX_DIAGNOSTIC_INVALID' });
});

test('diagnostic validation never reads caller accessors', () => {
  const value = fixture(); let reads = 0;
  Object.defineProperty(value, 'path', { enumerable: true, get() { reads++; return '$'; } });
  assert.throws(() => validateCodexDiagnostic(value), { code: 'CODEX_DIAGNOSTIC_INVALID' }); assert.equal(reads, 0);
});

test('target reasons are bounded constants and draft diagnostics cannot masquerade as editing', () => {
  for (const targetIssue of ['duplicate', 'unmatched', 'non-string']) {
    const diagnostic = createCodexDiagnostic({ code: 'PLAN_TARGET', path: '$.decisions[10].target', targetIssue }, binding);
    assert.equal(diagnostic.targetIssue, targetIssue); assert.deepEqual(validateCodexDiagnostic(diagnostic), diagnostic);
  }
  const draft = createCodexDiagnostic({ code: 'DRAFT_COUNT', path: '$.bases.sections[0].rows' }, { ...binding, stage: 'draft-validation' });
  assert.equal(draft.path, '$.bases.sections[0].rows'); assert.equal(draft.validatorCode, 'DRAFT_COUNT');
  for (const value of [{ ...fixture(), targetIssue: 'duplicate' }, { ...draft, operation: 'edit' },
    { ...fixture(), validatorCode: 'PLAN_TARGET', targetIssue: 'SECRET' }])
    assert.throws(() => validateCodexDiagnostic(value), { code: 'CODEX_DIAGNOSTIC_INVALID' });
});

test('format diagnostics allow only format codes and fixed paths, never raw parsing messages', () => {
  for (const validatorCode of ['OUTPUT_JSON', 'OUTPUT_WRAPPER', 'OUTPUT_PROPOSAL_JSON']) {
    const diagnostic = createCodexDiagnostic({ code: validatorCode, path: '$.proposalJson', message: 'SECRET_VALUE' },
      { ...binding, operation: 'edit', stage: 'output-validation' });
    assert.equal(diagnostic.validatorCode, validatorCode); assert.equal(JSON.stringify(diagnostic).includes('SECRET_VALUE'), false);
    for (const change of [{ path: '$.state[0]' }, { stage: 'proposal-check' }, { validatorCode: 'required' }, { targetIssue: 'duplicate' }])
      assert.throws(() => validateCodexDiagnostic({ ...diagnostic, ...change }), { code: 'CODEX_DIAGNOSTIC_INVALID' });
  }
  assert.throws(() => validateCodexDiagnostic({ ...fixture(), validatorCode: 'OUTPUT_JSON' }), { code: 'CODEX_DIAGNOSTIC_INVALID' });
});

test('wrapped edit result failures retain only the bounded underlying validation code and field', () => {
  const details = { ...binding, operation: 'edit' };
  const error = { code: 'EDIT_RESULT_SPEC', path: '$.patch', message: 'SECRET_VALUE',
    cause: { code: 'text', path: '$.sections[0].rows[1].validation.requiredMessage', message: 'SECRET_MESSAGE' } };
  const diagnostic = createCodexDiagnostic(error, details);
  assert.equal(diagnostic.validatorCode, 'EDIT_RESULT_SPEC');
  assert.deepEqual(diagnostic.cause, { validatorCode: 'text', path: '$.sections[0].rows[1].validation.requiredMessage' });
  assert.deepEqual(validateCodexDiagnostic(diagnostic, details), diagnostic);
  assert(!JSON.stringify(diagnostic).includes('SECRET'));
  for (const cause of [{ validatorCode: 'SECRET', path: '$' }, { ...diagnostic.cause, message: 'SECRET' },
    { ...diagnostic.cause, path: '$.privateToken' }, { ...diagnostic.cause, cause: diagnostic.cause }]) {
    assert.throws(() => validateCodexDiagnostic({ ...diagnostic, cause }, details), { code: 'CODEX_DIAGNOSTIC_INVALID' });
  }
  assert.throws(() => validateCodexDiagnostic({ ...diagnostic, validatorCode: 'EDIT_QUOTE' }), { code: 'CODEX_DIAGNOSTIC_INVALID' });
  const unknown = createCodexDiagnostic({ ...error, cause: { code: 'SECRET', path: '$.privateToken' } }, details);
  assert(!Object.hasOwn(unknown, 'cause'));
  const legacy = { ...diagnostic }; delete legacy.cause; assert.deepEqual(validateCodexDiagnostic(legacy, details), legacy);
});

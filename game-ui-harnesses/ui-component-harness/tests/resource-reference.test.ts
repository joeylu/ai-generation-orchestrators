import test from 'node:test';
import assert from 'node:assert/strict';
import { ResourceReferenceError, validateResourceReference } from '../src/resource-reference.ts';
import { HarnessError, validateButton } from '../src/contract.ts';
import { validateButtonIntent } from '../src/intent-compiler.ts';

test('accepts unchanged portable local and explicit HTTP(S) references', () => {
  for (const source of ['./assets/button.png', 'assets/button.png', 'https://cdn.example.test/a%20button.png', 'http://example.test/a.png']) {
    assert.equal(validateResourceReference(source, '$.source', 'contract'), source);
  }
});

for (const [name, source, code] of [
  ['path traversal', '../secret.png', 'PATH_TRAVERSAL_FORBIDDEN'],
  ['middle traversal', 'assets/../secret.png', 'PATH_TRAVERSAL_FORBIDDEN'],
  ['absolute Unix path', '/secret.png', 'ABSOLUTE_PATH_FORBIDDEN'],
  ['absolute Windows path', 'C:/secret.png', 'ABSOLUTE_PATH_FORBIDDEN'],
  ['backslash', 'assets\\button.png', 'BACKSLASH_FORBIDDEN'],
  ['encoded separator', 'assets%2fbutton.png', 'ENCODED_ESCAPE_FORBIDDEN'],
  ['encoded traversal', '%2e%2e/secret.png', 'ENCODED_ESCAPE_FORBIDDEN'],
  ['query in local path', 'assets/button.png?version=1', 'QUERY_OR_FRAGMENT_FORBIDDEN'],
  ['fragment in local path', 'assets/button.png#copy', 'QUERY_OR_FRAGMENT_FORBIDDEN'],
  ['Windows reserved path', 'assets/CON.png', 'WINDOWS_RESERVED_PATH'],
  ['Windows reserved path with spacing', 'assets/CON .png', 'WINDOWS_RESERVED_PATH'],
  ['Windows trailing dot', 'assets/button.', 'WINDOWS_RESERVED_PATH'],
  ['Windows alternate data stream', 'assets/button.png:stream', 'WINDOWS_FORBIDDEN_CHARACTER'],
  ['Windows forbidden angle bracket', 'assets/button<copy>.png', 'WINDOWS_FORBIDDEN_CHARACTER'],
  ['unsupported protocol', 'file:///secret.png', 'UNSUPPORTED_SCHEME'],
  ['credentialed URL', 'https://user:pass@example.test/button.png', 'CREDENTIALS_FORBIDDEN'],
  ['protocol relative URL', '//example.test/button.png', 'ABSOLUTE_PATH_FORBIDDEN'],
] as const) test(`rejects ${name}`, () => {
  assert.throws(
    () => validateResourceReference(source, '$.source', 'contract'),
    (error: unknown) => error instanceof ResourceReferenceError && error.path === '$.source' && error.stage === 'contract' && error.code === code,
  );
});

test('legacy contract and intent use the shared resource validation', () => {
  const button = {
    schemaVersion: '0.1', id: 'go', type: 'Button', layout: { x: 0, y: 0, width: 1, height: 1 }, props: { enabled: true },
    slots: { visual: { id: 'go-image', type: 'Image', props: { source: '../secret.png' } } },
  };
  assert.throws(() => validateButton(button), (error: unknown) => error instanceof HarnessError && error.stage === 'contract' && error.issues.some(issue => issue.code === 'PATH_TRAVERSAL_FORBIDDEN'));
  const intent = { intentVersion: '0.1', id: 'go', componentType: 'Button', visual: { source: 'https://user@example.test/a.png', mode: 'whole-image' }, text: { mode: 'none', value: '' } };
  assert.throws(() => validateButtonIntent(intent), (error: unknown) => error instanceof HarnessError && error.stage === 'intent' && error.issues.some(issue => issue.code === 'CREDENTIALS_FORBIDDEN'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../scripts/cli.mjs', import.meta.url));
function run(directory: string, ...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
async function temporaryDirectory(): Promise<string> { return mkdtemp(join(tmpdir(), 'ai-ui-component-cli-')); }
function document(source: string) {
  return { schemaVersion: '0.1', id: 'fixture', type: 'Button', layout: { x: 0, y: 0, width: 1, height: 1 }, props: { enabled: true }, slots: { visual: { id: 'fixture-image', type: 'Image', props: { source } } } };
}

test('self-test and doctor are offline and do not disclose a working path', async () => {
  const directory = await temporaryDirectory();
  const selfTest = await run(directory, 'self-test');
  assert.equal(selfTest.code, 0, selfTest.stderr); assert.deepEqual(JSON.parse(selfTest.stdout), { ok: true, offline: true });
  const doctor = await run(directory, 'doctor');
  assert.equal(doctor.code, 0, doctor.stderr);
  const result = JSON.parse(doctor.stdout);
  assert.equal(result.offline, true); assert.equal(result.providerConfigured, false);
  assert.equal(doctor.stdout.includes(directory), false);
});

test('compile reads supplied PNG dimensions without claiming vision', async () => {
  const directory = await temporaryDirectory();
  const intent = { intentVersion: '0.1', id: 'fixture', componentType: 'Button', visual: { source: 'assets/fixture.png', mode: 'whole-image' }, text: { mode: 'none', value: '' } };
  const policy = { canvas: { width: 10, height: 10 }, placement: 'center', scale: 1, enabled: true };
  await writeFile(join(directory, 'intent.json'), JSON.stringify(intent));
  await writeFile(join(directory, 'policy.json'), JSON.stringify(policy));
  await writeFile(join(directory, 'fixture.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlGQ7YAAAAASUVORK5CYII=', 'base64'));
  const result = await run(directory, 'compile', 'intent.json', 'policy.json', '--asset', 'fixture.png', '--output', 'document.json');
  assert.equal(result.code, 0, result.stderr);
  const compiled = JSON.parse(await readFile(join(directory, 'document.json'), 'utf8'));
  assert.deepEqual(compiled.layout, { x: 4.5, y: 4.5, width: 1, height: 1 });
  assert.equal(compiled.slots.visual.props.source, 'assets/fixture.png');
});

test('pack and unpack round trip verified bytes and refuse an existing target', async () => {
  const directory = await temporaryDirectory();
  await writeFile(join(directory, 'document.json'), JSON.stringify(document('assets/fixture.png')));
  await writeFile(join(directory, 'fixture.png'), new Uint8Array([1, 2, 3, 4]));
  const pack = await run(directory, 'pack', 'document.json', '--resource', 'assets/fixture.png=fixture.png', '--provenance-kind', 'programmatic-fixture', '--provenance-description', 'CLI test fixture', '--output', 'fixture.bundle.json');
  assert.equal(pack.code, 0, pack.stderr);
  const unpack = await run(directory, 'unpack', 'fixture.bundle.json', 'unpacked');
  assert.equal(unpack.code, 0, unpack.stderr);
  assert.deepEqual([...new Uint8Array(await readFile(join(directory, 'unpacked', 'assets', 'fixture.png')))], [1, 2, 3, 4]);
  assert.equal(JSON.parse(await readFile(join(directory, 'unpacked', 'ui-document.json'), 'utf8')).id, 'fixture');

  await mkdir(join(directory, 'blocked', 'assets'), { recursive: true });
  await writeFile(join(directory, 'blocked', 'assets', 'fixture.png'), 'keep');
  const blocked = await run(directory, 'unpack', 'fixture.bundle.json', 'blocked');
  assert.notEqual(blocked.code, 0); assert.match(blocked.stderr, /refusing to overwrite/);
  assert.equal(await readFile(join(directory, 'blocked', 'assets', 'fixture.png'), 'utf8'), 'keep');
});

test('inspect redacts query and fragment text from external references', async () => {
  const directory = await temporaryDirectory();
  await writeFile(join(directory, 'document.json'), JSON.stringify(document('https://example.test/asset.png?token=secret-value#private')));
  const result = await run(directory, 'inspect', 'document.json');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.includes('secret-value'), false);
  assert.match(result.stdout, /\?…#…/);
});

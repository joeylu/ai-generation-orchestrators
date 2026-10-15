import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { mkdtemp, writeFile, access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { harnessRoot } from '../src/io.mjs';
import { readPinnedTar, packagePanelRelease, verifyBrowserRuntimePortability, portableSdkReadme, portableDocumentation } from '../scripts/package-release.mjs';
import { verifyPanelSdk } from '../src/sdk.mjs';

function tar(name, content = 'fixture', type = '0') {
  const payload = Buffer.from(content), header = Buffer.alloc(512);
  header.write(name, 0, 100); header.write('0000644\0', 100); header.write('0000000\0', 108);
  header.write('0000000\0', 116); header.write(payload.length.toString(8).padStart(11, '0') + '\0', 124);
  header.write('00000000000\0', 136); header.fill(32, 148, 156); header.write(type, 156);
  header.write('ustar\0', 257); header.write('00', 263);
  const checksum = [...header].reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
  return gzipSync(Buffer.concat([header, payload, Buffer.alloc((512 - payload.length % 512) % 512), Buffer.alloc(1024)]));
}

test('browser release rejects absolute bundler module labels on Windows and POSIX', () => {
  for (const label of ['C:/workspace/dependency.js', 'D:\\workspace\\dependency.js', '/tmp/build/dependency.js', '\\\\host\\share\\dependency.js'])
    assert.throws(() => verifyBrowserRuntimePortability('const value=1;\n//#region ' + label + '\n'), /RELEASE_BROWSER_HOST_PATH/);
  assert.doesNotThrow(() => verifyBrowserRuntimePortability('//#region src/runtime.mjs\nexport const url="https://example.invalid";'));
});

test('the archive-root SDK README resolves its actual document links without moving web URLs or anchors', async () => {
  const text=portableSdkReadme(await readFile(new URL('../docs/sdk-release.md',import.meta.url),'utf8'));
  const links=[...text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map(match=>match[1]);
  assert(links.length>=5);
  for(const link of links)await access(new URL('../'+link.split('#')[0],import.meta.url));
  assert.equal(portableSdkReadme('[web](https://example.invalid/guide.md) [here](#api)'),'[web](https://example.invalid/guide.md) [here](#api)');
});

test('omitted documentation resolves to its verified source commit while bundled links stay local', () => {
  const files=new Map([['docs/guide.md',Buffer.from('[local](api.md#state) [history](history.md#scope) [web](https://example.invalid/x)')],['docs/api.md',Buffer.from('# API')]]);
  portableDocumentation(files,{repository:'https://github.com/example/repo',commit:'a'.repeat(40),hasSourceFile:name=>name==='docs/history.md'});
  assert.equal(new TextDecoder().decode(files.get('docs/guide.md')),'[local](api.md#state) [history](https://github.com/example/repo/blob/'+ 'a'.repeat(40)+'/game-ui-harnesses/ui-panel-harness/docs/history.md#scope) [web](https://example.invalid/x)');
  assert.throws(()=>portableDocumentation(new Map([['docs/guide.md',Buffer.from('[missing](missing.md)')]]),{repository:'https://github.com/example/repo',commit:'a'.repeat(40),hasSourceFile:()=>false}),/RELEASE_DOCUMENTATION_LINK/);
});

test('dependency archive reader preserves bytes and rejects unsafe paths and links', () => {
  assert.equal(new TextDecoder().decode(readPinnedTar(tar('package/lib/fixture.js')).get('package/lib/fixture.js')), 'fixture');
  for (const name of ['../outside', 'package/../outside', '/absolute', 'package/a//b'])
    assert.throws(() => readPinnedTar(tar(name)), /RELEASE_TAR_PATH/);
  for (const type of ['1', '2', '3', '4']) assert.throws(() => readPinnedTar(tar('package/link', '', type)), /RELEASE_TAR_TYPE/);
});

test('a wrong Component archive digest is rejected before building or creating output', async () => {
  const directory = await mkdtemp(join(harnessRoot, '.tmp', 'sdk-pin-'));
  const source = join(directory, 'wrong.tgz'), output = join(directory, 'output');
  await writeFile(source, tar('package/lib/fixture.js'));
  await assert.rejects(packagePanelRelease({ componentPackage: source, output }), /RELEASE_COMPONENT_DIGEST/);
  await assert.rejects(access(output), { code: 'ENOENT' });
});

test('a source checkout cannot masquerade as a verified installed SDK', async () => {
  await assert.rejects(verifyPanelSdk(), /SDK_RELEASE_REQUIRED/);
});

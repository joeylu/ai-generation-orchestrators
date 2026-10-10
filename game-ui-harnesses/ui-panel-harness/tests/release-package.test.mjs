import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { mkdtemp, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { harnessRoot } from '../src/io.mjs';
import { readPinnedTar, packagePanelRelease } from '../scripts/package-release.mjs';
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

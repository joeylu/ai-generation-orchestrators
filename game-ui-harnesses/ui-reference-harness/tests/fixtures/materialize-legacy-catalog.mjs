import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { createStoredZip } from '../../../ui-panel-harness/src/zip-store.mjs';
import { local, readJson, sha256 } from '../../src/common.mjs';

// Reconstruct only the deterministic archive wrapper. Historical records and
// images remain byte-identical; this helper never creates approvals or compute.
export function materializeLegacyCatalog(output) {
  assert.equal(fs.existsSync(output), false, 'Fixture output must be fresh.');
  fs.cpSync(new URL('./legacy-sample-catalog/', import.meta.url), output, { recursive: true });
  const records = readJson(new URL('./legacy-sample-catalog-zips.json', import.meta.url));
  const file = path.join(output, 'catalog.json'), catalog = readJson(file);
  assert.deepEqual(records.map(record => record.path), catalog.entries.map(entry => `${entry.id}/references.zip`));
  for (const record of records) {
    const directory = local(output, path.posix.dirname(record.path));
    const manifest = fs.readFileSync(local(directory, 'manifest.json'));
    const files = new Map(JSON.parse(manifest).files.map(item => {
      const bytes = fs.readFileSync(local(directory, item.path));
      assert.equal(bytes.length, item.bytes, item.path);
      assert.equal(sha256(bytes), item.sha256, item.path);
      return [item.path, bytes];
    }));
    files.set('manifest.json', manifest);
    const zip = Buffer.from(createStoredZip(files));
    assert.equal(zip.length, record.bytes, record.path);
    assert.equal(sha256(zip), record.sha256, record.path);
    fs.writeFileSync(local(output, record.path), zip, { flag: 'wx' });
  }
  return { file, catalog, output };
}

import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixtureFiles, materializeFixture } from './fixture-source.mjs';

const checkedRoot = fileURLToPath(new URL('../tests/fixtures/synthetic', import.meta.url));
const args = process.argv.slice(2);
try {
  if (args.length === 1 && args[0] === '--check') {
    const expected = buildFixtureFiles();
    const actual = [];
    function scan(folder, prefix = '') {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const name = `${prefix}${entry.name}`;
        if (lstatSync(join(folder, entry.name)).isSymbolicLink()) throw new Error('Fixture symlink is forbidden');
        if (entry.isDirectory()) scan(join(folder, entry.name), `${name}/`);
        else actual.push(name);
      }
    }
    scan(checkedRoot);
    if (actual.length !== expected.size || actual.some(name => !expected.has(name))) throw new Error('Fixture file inventory differs');
    for (const [name, bytes] of expected) if (!readFileSync(join(checkedRoot, name)).equals(bytes)) throw new Error('Fixture bytes differ from their deterministic producer');
    console.log(JSON.stringify({ ok: true, files: expected.size, operation: 'read-only-fixture-replay', generationCalls: 0 }));
  } else if (args.length === 2 && args[0] === '--output') {
    const output = resolve(args[1]);
    // Parent must exist, and the target itself must not exist.
    if (!lstatSync(dirname(output)).isDirectory()) throw new Error('Output parent is not a directory');
    const files = materializeFixture(output);
    console.log(JSON.stringify({ ok: true, files, operation: 'synthetic-fixture-materialization', generationCalls: 0 }));
  } else {
    throw new Error('Use --check or --output NEW_DIRECTORY');
  }
} catch {
  console.error(JSON.stringify({ ok: false, code: 'FIXTURE_OPERATION_FAILED', message: 'Fixture check/output failed; use an existing fixture or a fresh output directory' }));
  process.exitCode = 1;
}

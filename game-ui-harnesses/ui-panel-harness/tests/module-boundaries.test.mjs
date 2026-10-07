import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
async function modules(folder) {
  const result = [];
  for (const entry of await readdir(resolve(root, folder), { withFileTypes: true })) {
    const path = `${folder}/${entry.name}`;
    if (entry.isDirectory()) result.push(...await modules(path));
    else if (entry.name.endsWith('.mjs')) result.push([path, await readFile(resolve(root, path), 'utf8')]);
  }
  return result;
}
const references = source => [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g)].map(match => match[1]);

test('shared component imports stay behind the Node and browser adapters', async () => {
  for (const [path, source] of await modules('src')) {
    if (references(source).some(reference => reference.includes('ui-component-harness/'))) {
      assert(['src/component-adapter.mjs', 'src/workspace/component-browser.mjs'].includes(path), path);
    }
  }
});

test('development scripts do not import tool implementation filenames from sibling node_modules', async () => {
  for (const [path, source] of await modules('scripts')) {
    assert(!references(source).some(reference => reference.includes('/node_modules/')), path);
  }
});

test('texture package workflows and their shared rules have no import cycles', async () => {
  const all = new Map((await modules('src')).map(([path, source]) => [resolve(root, path), references(source)]));
  const done = new Set(), visiting = new Set();
  function visit(path, chain = []) {
    assert(!visiting.has(path), `Cycle: ${[...chain, path].join(' -> ')}`);
    if (done.has(path) || !all.has(path)) return;
    visiting.add(path);
    for (const ref of all.get(path).filter(value => value.startsWith('.'))) visit(resolve(dirname(path), ref), [...chain, path]);
    visiting.delete(path); done.add(path);
  }
  for (const name of ['texture-library', 'texture-redesign', 'texture-curation']) visit(resolve(root, `src/${name}.mjs`));
});

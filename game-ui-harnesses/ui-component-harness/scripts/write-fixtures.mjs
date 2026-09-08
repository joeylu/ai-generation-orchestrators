/** Materialize documented procedural examples from the actual fixture compiler. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fixtureInputs } from '../src/fixtures.ts';
import { compileTree } from '../src/tree-compiler.ts';
const root = new URL('../', import.meta.url);
for (const kind of ['composite', 'gallery']) {
  const sample = fixtureInputs(kind);
  const facts = {};
  function sources(node) {
    if (node.componentType === 'Image') facts[node.props.source] = null;
    if ('children' in node) node.children.forEach(sources);
  }
  sources(sample.intent.root);
  for (const source of Object.keys(facts)) {
    const svg = await readFile(new URL(`public/${source}`, root), 'utf8');
    const width = /<svg\b[^>]*\bwidth="([0-9.]+)"/.exec(svg);
    const height = /<svg\b[^>]*\bheight="([0-9.]+)"/.exec(svg);
    if (!width || !height) throw new Error('Programmatic fixture needs explicit SVG dimensions.');
    facts[source] = { width: Number(width[1]), height: Number(height[1]) };
  }
  const contract = compileTree(sample.intent, facts, sample.policy);
  await mkdir(new URL('examples/', root), { recursive: true });
  for (const [suffix, value] of Object.entries({ intent: sample.intent, policy: sample.policy, facts, document: contract, motion: sample.motion }))
    await writeFile(new URL(`examples/programmatic-${kind}.${suffix}.json`, root), JSON.stringify(value, null, 2) + '\n');
  console.log(`${kind}: generated intent, explicit policy, fixture dimensions, compiled document and separate motion`);
}

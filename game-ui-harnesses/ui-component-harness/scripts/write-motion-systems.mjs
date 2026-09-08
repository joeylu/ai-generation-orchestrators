/** Materialize explicit, validated three-style fixtures; no model or renderer. */
import { writeFile } from 'node:fs/promises';
import { fixtureDocument } from '../src/fixtures.ts';
import { walkNodes } from '../src/tree-contract.ts';
import { compileMotionSystem, motionSystemCatalog } from '../src/motion-system.ts';
const document = fixtureDocument('gallery');
const catalog = motionSystemCatalog();
for (const style of ['playful', 'premium', 'corporate']) {
  const request = { id: `gallery-${style}`, style, targets: walkNodes(document).map(node => node.id) };
  const system = compileMotionSystem(request, document);
  await writeFile(new URL(`../examples/motion-system-${style}.request.json`, import.meta.url), JSON.stringify(request, null, 2) + '\n');
  await writeFile(new URL(`../examples/motion-system-${style}.json`, import.meta.url), JSON.stringify(system, null, 2) + '\n');
}
await writeFile(new URL('../examples/motion-system-catalog.json', import.meta.url), JSON.stringify(catalog, null, 2) + '\n');
console.log(JSON.stringify({ styles: 3, componentTypes: 16, combinations: 48, source: 'programmatic-gallery', providerCalled: false }));

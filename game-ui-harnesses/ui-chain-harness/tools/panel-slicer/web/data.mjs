import { readFile } from 'node:fs/promises';
import { readContracts } from '../../../src/contracts/validate.mjs';
const root = new URL('../../../', import.meta.url);
export async function sliceEditorData() {
  const c = await readContracts({
    registry: new URL('configs/component-registry.draft.json', root),
    usage: new URL('configs/skin-usage.draft.json', root),
    template: new URL('configs/skin-template-set.draft.json', root),
  });
  return { registry: c.registry, usage: c.usage, template: c.template,
    profile: JSON.parse(await readFile(new URL('fixtures/neutral.skin.json', root), 'utf8')) };
}

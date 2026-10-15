import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { defaultConfig } from '../src/templates/build.mjs';

export const original = JSON.parse(await readFile(defaultConfig,'utf8'));
export const clone = () => structuredClone(original);
export const save = (path, value) => writeFile(path,JSON.stringify(value,null,2)+'\n');
export async function workspace(spec = clone()) {
  const base = fileURLToPath(new URL('../../../.tmp/ui-chain-tests/',import.meta.url));
  await mkdir(base,{ recursive: true });
  const directory = await mkdtemp(join(base,'case-'));
  const config = join(directory,'template.json'), output = join(directory,'out');
  await save(config,spec);
  return { directory, config, output };
}
export function extended() {
  const spec = clone();
  const part = structuredClone(spec.sheets[3].parts[0]);
  Object.assign(part, { code: 'E01', assetId: 'surface.extra', label: '测试新增底板', state: 'base', consumers: ['Panel'] });
  spec.sheets.push({ id: 'S05', filePrefix: 's05-extra', title: '扩展验收', parts: [part] });
  spec.revision++;
  return spec;
}
export function small() {
  const spec = clone();
  spec.coordinates = { ...spec.coordinates, width: 512, height: 512, outputScale: 2 };
  spec.sheets = [{ id: 'S01', filePrefix: 's01-fixture', title: '小方板', parts: [
    { ...structuredClone(spec.sheets[3].parts[0]), code: 'T01', assetId: 'test.box', consumers: ['Panel'], state: 'base', slotRect: [32,32,192,192], bodyRect: [80,80,96,96] },
    { ...structuredClone(spec.sheets[3].parts[4]), code: 'T02', assetId: 'test.ring', consumers: ['RadioGroup'], state: 'base', slotRect: [256,32,224,192], bodyRect: [320,80,96,96] },
  ] }];
  spec.stateGroups = [];
  return spec;
}
// An explicit test double, never used by the CLI or production preview directory.
export async function fakeRenderer({ spec, directory }) {
  const files = [];
  for (const sheet of spec.sheets) for (const role of ['clean','review']) {
    const file = `${sheet.filePrefix}.${role}.png`;
    await writeFile(join(directory,file),`test-double:${sheet.id}:${role}`);
    files.push({ file, role, sheetId: sheet.id });
  }
  return { renderer: 'test-double', files };
}

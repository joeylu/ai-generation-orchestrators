import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from '../src/index.mjs';
import { canvas, encodePng, rectangle } from '../src/png.mjs';
import { jsonBytes, local, readJson, seal } from '../src/common.mjs';

export const panelFile = fileURLToPath(new URL('../../ui-panel-harness/examples/audio-settings.panel.json', import.meta.url));
export const catalogFile = fileURLToPath(new URL('../../ui-panel-harness/catalog/modern-core.json', import.meta.url));
export async function setup(t, { activate = true } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-reference-test-'));
  t.after(() => {
    if (path.dirname(path.resolve(temp)) !== path.resolve(os.tmpdir()) || !path.basename(temp).startsWith('ui-reference-test-')) throw new Error('TEST_CLEANUP_PATH');
    fs.rmSync(temp, { recursive: true, force: true });
  });
  const root = path.join(temp, 'project'); api.initialize(root, 'demo-game');
  const style = api.createStyle(root, { preset: 'casual-clean' });
  if (activate) api.activateStyle(root, style.sha256, 'Test double approval; no provider calls.');
  await api.addPanel(root, { spec: panelFile, catalog: catalogFile });
  return { root, temp, style };
}
export function syntheticImage(width = 960, height = 640) {
  const image = canvas(width, height, '#EEEEEE'); rectangle(image, [10, 10, width - 20, height - 20], '#448877');
  return encodePng(image);
}
// Historical synthetic fixtures only. Never rewrite real project evidence.
export function archiveSyntheticRun(root, run, runtimeSha256) {
  const plan = readJson(local(root, `${run}/plan.json`));
  delete plan.sha256;
  plan.runtimeSha256 = runtimeSha256;
  const archived = seal(plan);
  fs.writeFileSync(local(root, `${run}/plan.json`), jsonBytes(archived));
  let authorizationSha256;
  for (const name of ['authorization', 'attempt', 'receipt', 'technical', 'review']) {
    const file = local(root, `${run}/${name}.json`);
    if (!fs.existsSync(file)) continue;
    const record = readJson(file);
    delete record.sha256;
    record.planSha256 = archived.sha256;
    if (name === 'attempt') record.authorizationSha256 = authorizationSha256;
    const sealed = seal(record);
    if (name === 'authorization') authorizationSha256 = sealed.sha256;
    fs.writeFileSync(file, jsonBytes(sealed));
  }
  return archived;
}
export function accepted(root, panelId = 'audio-settings', useAsAnchor = false) {
  const plan = api.createPlan(root, { panelId });
  api.authorize(root, plan.run, plan.planSha256, 'Test double compute approval.');
  const request = api.reserve(root, plan.run);
  const result = api.receive(root, plan.run, request.requestSha256, syntheticImage());
  api.reviewRun(root, plan.run, { imageSha256: result.imageSha256, layout: 'pass', style: 'pass', copy: 'pass', decision: 'accept', note: 'Synthetic fixture acceptance, not real art evidence.', useAsAnchor });
  return { plan, request, result };
}
export async function secondPanel(root, temp) {
  const spec = readJson(panelFile); spec.id = 'audio-secondary'; spec.title = '声音';
  const file = path.join(temp, 'second.json'); fs.writeFileSync(file, JSON.stringify(spec));
  return api.addPanel(root, { spec: file, catalog: catalogFile });
}

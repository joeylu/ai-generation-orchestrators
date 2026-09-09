#!/usr/bin/env node
/** Offline, explicit mapping of a legacy layered document to portable controls. */
import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { importLegacyLayeredZip, MAX_LEGACY_ARCHIVE_BYTES } from './legacy-layered-import.mjs';

async function api(name) {
  const source = new URL(`../src/${name}.ts`, import.meta.url);
  try { await access(source); return import(source.href); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return import(new URL(`../lib/${name}.js`, import.meta.url).href); }
}
const { createBundle, validateBundle } = await api('bundle');
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))) throw new Error('CASE_PLAN_FIELDS');
}
export async function createLegacyLayeredCase(bytes, plan) {
  const input = structuredClone(plan);
  exact(input, ['documentId', 'buttons', 'backgroundColor']);
  if (typeof input.documentId !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(input.backgroundColor)
    || !Array.isArray(input.buttons) || !input.buttons.length || input.buttons.length > 16) throw new Error('CASE_PLAN_INVALID');
  const buttons = new Map();
  for (const button of input.buttons) {
    exact(button, ['layerId', 'label']);
    if (typeof button.layerId !== 'string' || typeof button.label !== 'string' || button.label !== button.label.trim() || button.label.length > 256 || buttons.has(button.layerId)) throw new Error('CASE_BUTTON_INVALID');
    buttons.set(button.layerId, button);
  }
  const imported = await importLegacyLayeredZip(bytes);
  const selected = imported.documents.find(document => document.id === input.documentId);
  if (!selected) throw new Error('CASE_DOCUMENT_NOT_FOUND');
  if ([...buttons.keys()].some(id => !selected.layers.some(layer => layer.id === id))) throw new Error('CASE_BUTTON_LAYER_NOT_FOUND');
  const style = { backgroundColor: input.backgroundColor, borderColor: '#000000', borderWidth: 0, cornerRadius: 0, textColor: '#000000', fontFamily: 'sans-serif', fontSize: 16, fontWeight: 'normal', opacity: 1 };
  const document = { schemaVersion: '0.2', id: `legacy-${selected.id}`, canvas: { width: selected.width, height: selected.height }, root: {
    id: 'legacy-root', type: 'Container', layout: { x: 0, y: 0, width: selected.width, height: selected.height }, props: { style },
    children: selected.layers.map(layer => {
      const layout = { x: layer.left, y: layer.top, width: layer.width, height: layer.height };
      const button = buttons.get(layer.id);
      return button
        ? { id: `layer-${layer.id}`, type: 'Button', layout, props: { label: button.label, enabled: true, backgroundImage: layer.path, style }, children: [] }
        : { id: `layer-${layer.id}`, type: 'Image', layout, props: { source: layer.path, fit: 'stretch', drawBackground: false, style } };
    }),
  } };
  const resources = selected.layers.map(layer => layer.resource);
  const description = `Legacy layered pilot: original PNG layers, explicit Button mapping; other layers remain static raster images. No settings changes or navigation actions are wired. Source ZIP SHA-256: ${imported.archiveSha256}. Legacy format: ${imported.legacy.kind}. Layout is inherited, not original design metadata. No new human visual acceptance.`;
  const bundle = await validateBundle(await createBundle(document, resources, { kind: 'user-provided', description }));
  return { bundle, preview: selected.preview, report: {
    kind: 'legacy-layered-case-compilation-v1', status: 'compiled_not_browser_validated', sourceArchiveSha256: imported.archiveSha256,
    sourceDocumentId: selected.id, buttonIds: document.root.children.filter(n => n.type === 'Button').map(n => n.id),
    staticLayerIds: document.root.children.filter(n => n.type === 'Image').map(n => n.id),
    providerCalls: 0, humanVisualReview: 'NOT_RUN', businessActions: 'NOT_WIRED',
  } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, plan, output, ...extra] = process.argv.slice(2);
  if (!input || !plan || !output || extra.length) throw new Error('Usage: node scripts/legacy-layered-case.mjs <legacy.zip> <mapping.json> <new-output-directory>');
  const { size } = await (await import('node:fs/promises')).stat(input);
  if (size > MAX_LEGACY_ARCHIVE_BYTES) throw new Error('LEGACY_ARCHIVE_SIZE_LIMIT');
  if ((await (await import('node:fs/promises')).stat(plan)).size > 1024 * 1024) throw new Error('CASE_PLAN_SIZE_LIMIT');
  const planBytes = await readFile(plan);
  if (planBytes.length > 1024 * 1024) throw new Error('CASE_PLAN_SIZE_LIMIT');
  const result = await createLegacyLayeredCase(await readFile(input), JSON.parse(planBytes.toString('utf8')));
  await mkdir(output, { recursive: false });
  await writeFile(resolve(output, 'component.ui-bundle.json'), JSON.stringify(result.bundle, null, 2) + '\n', { flag: 'wx' });
  await writeFile(resolve(output, 'compilation.json'), JSON.stringify(result.report, null, 2) + '\n', { flag: 'wx' });
  await writeFile(resolve(output, 'source-preview.png'), result.preview.bytes, { flag: 'wx' });
  console.log(JSON.stringify(result.report));
}

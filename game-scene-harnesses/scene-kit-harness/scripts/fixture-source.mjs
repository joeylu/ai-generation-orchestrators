import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { encodeFixturePng } from '../src/png.mjs';
import { cellKey, NEIGHBORS, PROFILE, SIGNATURES } from '../src/topology.mjs';
import { sha256 } from '../src/validate.mjs';

const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

export function buildFixtureFiles() {
  const files = new Map();
  const kitRef = { kitId: 'synthetic-sideview', revision: 'fixture-v1' };
  const familyId = 'terrain.primary';
  function image(name, kind, signature = 0) {
    const width = 64, height = 64;
    const rgba = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      if (kind === 'environment' && Math.abs(x - 32) + Math.abs(y - 32) > 25) continue;
      const edge = kind === 'terrain' && (
        (!(signature & 1) && y < 4) || (!(signature & 4) && x >= 60)
        || (!(signature & 16) && y >= 60) || (!(signature & 64) && x < 4));
      rgba.set(edge ? [238, 190, 60, 255] : [45 + signature % 120, 85 + (x % 8) * 3, 105 + (y % 8) * 3, 255], offset);
      if (kind === 'terrain' && y >= 24 && y < 40 && x >= 8 && x < 56) {
        const bit = Math.floor((x - 8) / 6);
        if (signature & (1 << bit)) rgba.set([220, 235, 245, 255], offset);
      }
    }
    const path = `assets/${name}.png`;
    const bytes = encodeFixturePng(width, height, rgba);
    files.set(path, bytes);
    return {
      assetId: name, kind, source: { path, sha256: sha256(bytes), byteLength: bytes.length },
      pixelSize: { width, height }, footprint: { columns: 1, rows: 1 },
      anchorPx: { x: 0, y: 0 }, visualOffset: { x: 0, y: 0 },
      allowedTransforms: ['identity'], repeatAxis: kind === 'strip' ? 'x' : 'none',
    };
  }
  const modules = SIGNATURES.map(signature => image(`terrain-${String(signature).padStart(3, '0')}`, 'terrain', signature));
  modules.push(image('environment-marker', 'environment'), image('background-strip', 'strip'));
  const catalog = { format: 'ai_scene_module_catalog_v1', kitRef, modules };
  const rules = {
    format: 'ai_scene_terrain_rules_v1', kitRef, rulesId: 'terrain.primary', revision: 'rules-v1',
    profile: PROFILE, familyId,
    entries: SIGNATURES.map(signature => ({ signature, variantAssetIds: [`terrain-${String(signature).padStart(3, '0')}`] })),
  };
  const run = (x, y, length) => ({ x, y, length, familyId });
  const presets = {
    format: 'ai_scene_assembly_presets_v1', kitRef,
    presets: [
      { presetId: 'platform.small', sizeCells: { width: 4, height: 2 }, terrainRuns: [run(0, 1, 4)],
        instances: [{ instanceId: 'marker', assetId: 'environment-marker', x: 64, y: 0 }], assemblies: [] },
      { presetId: 'platform.pair', sizeCells: { width: 8, height: 3 }, terrainRuns: [], instances: [],
        assemblies: [{ instanceId: 'left', presetId: 'platform.small', column: 0, row: 0 },
          { instanceId: 'right', presetId: 'platform.small', column: 4, row: 1 }] },
    ],
  };
  function map(mapId, width, height) {
    return {
      format: 'ai_scene_document_v1', mapId, kitRef,
      rulesRef: { rulesId: rules.rulesId, revision: rules.revision },
      bounds: { x: 0, y: 0, width, height }, seed: 'fixture-v1',
      layers: [
        { layerId: 'background', kind: 'background', zIndex: 0, parallax: { x: 0.2, y: 1 }, visible: true },
        { layerId: 'terrain', kind: 'terrain', zIndex: 10, parallax: { x: 1, y: 1 }, visible: true },
        { layerId: 'environment', kind: 'environment', zIndex: 20, parallax: { x: 1, y: 1 }, visible: true },
      ],
      terrainRuns: [], instances: [], assemblyInstances: [],
      defaultCamera: { center: { x: 512, y: 288 }, viewport: { width: 1024, height: 576 }, scale: 1 },
      inspectionCases: [],
    };
  }
  const defaultMap = map('default.synthetic', 64, 9);
  defaultMap.terrainRuns = [run(0, 8, 28), run(32, 8, 32), run(0, 7, 14), run(0, 6, 7), run(17, 4, 4), run(39, 5, 6)];
  defaultMap.instances = [
    { instanceId: 'marker.main', assetId: 'environment-marker', layerId: 'environment', x: 512, y: 384 },
    { instanceId: 'strip.main', assetId: 'background-strip', layerId: 'background', x: 0, y: 0 },
  ];
  defaultMap.assemblyInstances = [{ instanceId: 'pair.main', presetId: 'platform.pair', layerId: 'environment', column: 50, row: 2 }];
  const inspection = map('inspection.synthetic', 40, 30);
  const cells = new Set();
  SIGNATURES.forEach((signature, index) => {
    const x = (index % 8) * 5 + 2, y = Math.floor(index / 8) * 5 + 2;
    cells.add(cellKey(x, y));
    for (const [dx, dy, bit] of NEIGHBORS) if (signature & bit) cells.add(cellKey(x + dx, y + dy));
    inspection.inspectionCases.push({ caseId: `signature-${signature}`, cell: { x, y }, expectedSignature: signature });
  });
  const coords = [...cells].map(key => key.split(',').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  for (const [x, y] of coords) {
    const last = inspection.terrainRuns.at(-1);
    if (last && last.y === y && last.x + last.length === x) last.length++;
    else inspection.terrainRuns.push(run(x, y, 1));
  }
  files.set('catalog.json', json(catalog)); files.set('rules.json', json(rules));
  files.set('presets.json', json(presets)); files.set('maps/default.scene.json', json(defaultMap));
  files.set('maps/inspection.scene.json', json(inspection));
  const fileRef = path => ({ path, sha256: sha256(files.get(path)) });
  files.set('kit.json', json({
    format: 'ai_scene_kit_v1', ...kitRef, profile: PROFILE, purpose: 'synthetic-fixture',
    grid: { width: 64, height: 64 }, pixelsPerUnit: { numerator: 1, denominator: 1 },
    files: { catalog: fileRef('catalog.json'), rules: fileRef('rules.json'), presets: fileRef('presets.json'),
      maps: { default: fileRef('maps/default.scene.json'), inspection: fileRef('maps/inspection.scene.json') } },
  }));
  return files;
}

export function materializeFixture(root) {
  // Fresh-only output: deterministic producer owns all fixture hashes and bundle records.
  mkdirSync(root);
  const files = buildFixtureFiles();
  for (const [path, bytes] of files) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), bytes, { flag: 'wx' });
  }
  return files.size;
}

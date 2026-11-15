import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSceneKit, readMap, compileMap, createEditor, saveMap, saveCompiledMap, loadMap, exportScene, openSceneExport } from '../src/index.mjs';
import { canonicalJson } from '../src/document.mjs';
import { makeFreshDirectory, writeFreshFile } from '../src/files.mjs';
import { demand, InvalidKit } from '../src/errors.mjs';

const args = process.argv.slice(2);
try {
  demand(args.length === 2 && args[0] === '--out', 'ARGUMENTS', 'command', '/', 'Use --out NEW_DIRECTORY');
  const source = fileURLToPath(new URL('../tests/fixtures/synthetic', import.meta.url));
  const kit = loadSceneKit(source), editor = createEditor(kit, readMap(kit));
  const before = editor.getScene();
  const commands = [
    { type: 'expand-assembly', instanceId: 'pair.main' },
    { type: 'erase-cells', cells: [{ x: 50, y: 3 }] },
    { type: 'paint-cells', familyId: 'terrain.primary', cells: [{ x: 30, y: 6 }] },
    { type: 'place-assembly', instance: { instanceId: 'demo.platform', presetId: 'platform.small', layerId: 'environment', column: 20, row: 0 } },
    { type: 'resize-bounds', bounds: { x: 0, y: 0, width: 80, height: 9 } },
    { type: 'paint-cells', familyId: 'terrain.primary', cells: [{ x: 72, y: 8 }] },
    { type: 'add-instance', instance: { instanceId: 'demo.marker', assetId: 'environment-marker', layerId: 'environment', x: 4608, y: 448 } },
  ];
  editor.execute(commands);
  const after = editor.getScene();
  editor.undo(); const undoRestored = editor.getScene().contentSha256 === before.contentSha256;
  editor.redo(); const redoRestored = editor.getScene().contentSha256 === after.contentSha256;
  demand(undoRestored && redoRestored, 'DEMO_HISTORY', 'demo-report.json', '/', 'Undo/redo did not restore the same compiled scene');
  const root = makeFreshDirectory(args[1], source);
  saveCompiledMap(kit, readMap(kit), join(root, 'initial.compiled.json'));
  saveMap(kit, editor.getDocument(), join(root, 'edited.scene.json'));
  saveCompiledMap(kit, editor.getDocument(), join(root, 'edited.compiled.json'));
  const reopenedHash = compileMap(kit, loadMap(kit, join(root, 'edited.scene.json'))).contentSha256;
  const exported = exportScene(kit, editor.getDocument(), join(root, 'export'));
  const imported = openSceneExport(join(root, 'export'));
  demand(reopenedHash === after.contentSha256 && imported.compiled.contentSha256 === after.contentSha256,
    'DEMO_REPLAY', 'demo-report.json', '/', 'Saved/exported map did not reproduce');
  const report = {
    status: 'offline-authoring-demo-passed', before: before.counts, after: after.counts,
    undoRestored, redoRestored, saveOpenRestored: true, exportReplayRestored: true,
    sourceKitSha256: kit.bundleSha256, compiledSha256: after.contentSha256,
    exportFileCount: exported.fileCount, visualAcceptance: 'not-assessed', generationCalls: 0,
  };
  writeFreshFile(join(root, 'commands.json'), Buffer.from(`${canonicalJson(commands, true)}\n`), source);
  writeFreshFile(join(root, 'demo-report.json'), Buffer.from(`${canonicalJson(report, true)}\n`), source);
  console.log(JSON.stringify({ ok: true, ...report }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, errors: error instanceof InvalidKit ? error.errors : [{ code: 'DEMO_FAILED', message: 'Offline demo failed; use a fresh output directory' }] }));
  process.exitCode = 1;
}

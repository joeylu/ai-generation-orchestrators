import { loadSceneKit, readMap, compileMap, createEditor, saveMap, loadMap, saveCompiledMap, exportScene, openSceneExport } from '../src/index.mjs';
import { parseJson, readSelectedFile, writeFreshFile } from '../src/files.mjs';
import { demand, InvalidKit } from '../src/errors.mjs';
import {prepareSharedTerrainLoop,upgradeSharedTerrainFieldKit,verifySharedTerrainFieldKit} from '../src/shared-terrain-upgrade.mjs';
import {contextFor} from '../src/kit.mjs';
import {createSharedTerrainFieldProfile} from '../src/shared-terrain-field.mjs';
import {resolveTerrainMaterialAppearance} from '../src/terrain-loop-material.mjs';
import {reviewScenePlacement} from '../src/scene-placement-review.mjs';
import {jsonBytes} from '../src/generation/common.mjs';
import {measureTerrainBodyBands} from '../src/terrain-material-loop.mjs';

const args = process.argv.slice(2);
const help = `Usage:
  scene.mjs compile --root KIT --map default|inspection --out NEW_JSON
  scene.mjs edit --root KIT --map default --commands COMMANDS_JSON --out NEW_JSON
  scene.mjs export --root KIT --document AUTHOR_JSON --out NEW_DIRECTORY
  scene.mjs verify-export --root EXPORT_DIRECTORY
  scene.mjs terrain-profile --root CHECKED_KIT --settings JSON --out NEW_JSON [--loop-options JSON]
  scene.mjs terrain-deliver --root CHECKED_KIT --profile JSON --out NEW_DIRECTORY [--document AUTHOR_JSON] [--loop-options JSON] [--placement JSON]
  scene.mjs terrain-verify --root CHECKED_KIT --profile JSON --out DELIVERY_DIRECTORY [--document AUTHOR_JSON] [--loop-options JSON] [--placement JSON]
  scene.mjs placement-review --root KIT --placement JSON --out NEW_JSON [--document AUTHOR_JSON]
Use --document AUTHOR_JSON instead of --map for compile/edit. Terrain delivery defaults to the checked kit default map, preserves all source PNGs, and never generates media.`;
if (args.length === 1 && args[0] === '--help') console.log(help);
else {
  let argumentPhase = true;
  try {
    const command = args.shift(), options = {};
    demand(['compile', 'edit', 'export', 'verify-export','terrain-profile','terrain-deliver','terrain-verify','placement-review'].includes(command), 'ARGUMENTS', 'command', '/', 'Unknown scene operation; use --help');
    demand(args.length % 2 === 0, 'ARGUMENTS', 'command', '/', 'Options require values');
    for (let index = 0; index < args.length; index += 2) {
      const key = args[index];
      demand(['--root', '--map', '--document', '--commands', '--out','--profile','--settings','--loop-options','--placement'].includes(key) && !Object.hasOwn(options, key), 'ARGUMENTS', 'command', '/', 'Unknown or repeated option');
      options[key] = args[index + 1];
    }
    const terrainDelivery=['terrain-deliver','terrain-verify'].includes(command);
    const supplied = (...keys) => keys.filter(key => options[key]);
    const expected = command === 'verify-export' ? ['--root'] : ['--root', '--out',
      ...(terrainDelivery ? ['--profile',...supplied('--document','--loop-options','--placement')]
        : command==='terrain-profile' ? ['--settings',...supplied('--loop-options')]
        : command==='placement-review' ? ['--placement',...supplied('--document')]
        : options['--document'] ? ['--document'] : ['--map']), ...(command === 'edit' ? ['--commands'] : [])];
    demand(Object.keys(options).length === expected.length && expected.every(key => options[key]), 'ARGUMENTS', 'command', '/', 'Operation options are incomplete or incompatible');
    argumentPhase = false;
    let result;
    if (command === 'verify-export') {
      const { compiled } = openSceneExport(options['--root']);
      result = { status: 'export-integrity-verified', counts: compiled.counts, contentSha256: compiled.contentSha256, visualAcceptance: 'not-assessed', generationCalls: 0 };
    } else {
      const kit = loadSceneKit(options['--root']);
      const read = name => parseJson(readSelectedFile(options[name]));
      const map = options['--document'] ? loadMap(kit, options['--document']) : readMap(kit, options['--map']??'default');
      if(terrainDelivery)result=(command==='terrain-deliver'?upgradeSharedTerrainFieldKit:verifySharedTerrainFieldKit)({root:options['--root'],document:map,profile:read('--profile'),output:options['--out'],
        ...(options['--loop-options']?{loopOptions:read('--loop-options')}:{}) ,...(options['--placement']?{placement:read('--placement')}:{})});
      else if(command==='terrain-profile'){
        const ctx=contextFor(kit);
        const derived=options['--loop-options']?prepareSharedTerrainLoop(ctx.kit,ctx.files,read('--loop-options')):undefined;
        const loop=derived?.record??ctx.kit.terrainMaterialLoop;
        const appearance=resolveTerrainMaterialAppearance(ctx.kit.terrainAppearance,loop);
        const profile=createSharedTerrainFieldProfile(appearance,read('--settings'));
        writeFreshFile(options['--out'],jsonBytes(profile),ctx.sourceRoot);
        result=derived?{...profile,bodyBandDiagnostics:{source:measureTerrainBodyBands(ctx.files.get(loop.sourceInput.path)),
          derived:measureTerrainBodyBands(derived.png)}}:profile;
      }
      else if(command==='placement-review'){
        const ctx=contextFor(kit);
        result=reviewScenePlacement(compileMap(kit,map),read('--placement'),path=>ctx.files.get(path));
        writeFreshFile(options['--out'],jsonBytes(result),ctx.sourceRoot);
        if(result.status==='blocked')process.exitCode=2;
      }
      else if (command === 'compile') result = saveCompiledMap(kit, map, options['--out']);
      else if (command === 'export') result = exportScene(kit, map, options['--out']);
      else {
        const editor = createEditor(kit, map);
        const change = editor.execute(parseJson(readSelectedFile(options['--commands']), 'commands.json'));
        result = { ...saveMap(kit, editor.getDocument(), options['--out']), change, counts: compileMap(kit, editor.getDocument()).counts };
      }
    }
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, errors: error instanceof InvalidKit ? error.errors : [{ code: 'SCENE_OPERATION_FAILED', artifact: 'command', path: '/', message: 'Scene operation failed; no automatic overwrite or retry' }] }, null, 2));
    process.exitCode = argumentPhase ? 2 : 1;
  }
}

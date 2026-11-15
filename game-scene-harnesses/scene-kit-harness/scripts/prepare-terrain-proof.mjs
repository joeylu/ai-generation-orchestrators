import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as workflow from '../src/generation/index.mjs';
import { isWithin, makeFreshDirectory, writeFreshFile } from '../src/files.mjs';
import { check, digest, jsonBytes } from '../src/generation/common.mjs';
import { TERRAIN_PROOF as profile, TERRAIN_PROOF_SHA256, layoutCells } from '../src/terrain-proof/profile.mjs';
import { encodeRgbaPng } from '../src/png.mjs';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
try {
  const args = process.argv.slice(2), keys = ['--root', '--reference', '--capabilities', '--id', '--out'], options = {};
  check(args.length === keys.length * 2, 'ARGUMENTS');
  for (let i = 0; i < args.length; i += 2) { check(keys.includes(args[i]) && !Object.hasOwn(options, args[i]), 'ARGUMENTS'); options[args[i]] = args[i + 1]; }
  const root = resolve(options['--root']);
  check(!isWithin(root, resolve(options['--out'])), 'OUTPUT_OVERLAP');
  const output = makeFreshDirectory(options['--out'], sourceRoot);
  const plan = workflow.freezeTerrainMaterialPlan(root, { planId: options['--id'], parents: [], referencePlanSha256: options['--reference'],
    capabilitiesSha256: options['--capabilities'], intent: '首轮纯侧视地形验证：遵循已接受场景的材料和风格，只生成一张苔草/石土材料源；由固定程序派生直段、台阶、断崖样张，检查对齐和接缝。不画地形顶部平面或完整风景。' });
  const report = { format: 'ai_scene_terrain_proof_preparation_v1', status: 'awaiting-compute-confirmation', planSha256: plan.sha256,
    requestSha256: digest(plan.request), acceptedReferenceRawSha256: plan.referenceEvidence[0].rawSha256,
    profileSha256: TERRAIN_PROOF_SHA256, maximumNewImageRequests: 1, derivedLayoutCount: 3, cardinalTileCount: 16,
    independentGeneratedModuleCount: 0, complete47RoleKit: false, newComputeAuthorizations: 0, newReservedAttempts: 0,
    actualNewMediaGenerationCalls: 0, visualAcceptance: 'not-assessed' };
  for (const [name, value] of Object.entries({ 'frozen-material-plan': plan, 'engineering-profile': profile, 'plan-ready-report': report })) {
    writeFreshFile(join(output, `${name}.json`), jsonBytes(value), sourceRoot);
  }
  writeFreshFile(join(output, 'material-prompt.txt'), Buffer.from(`${plan.request.prompt}\n`), sourceRoot);
  writeFreshFile(join(output, 'accepted-style-reference.png'), workflow.readGenerationInput(root, plan.sha256, 0), sourceRoot);
  // Deterministic engineering diagram, never a generated art sample.
  const width = 512, height = profile.layouts.reduce((sum, layout) => sum + layout.rows * 64, 0) + 32;
  const rgba = Buffer.alloc(width * height * 4); let top = 0;
  for (const layout of profile.layouts) {
    const cells = new Set(layoutCells(layout).map(({ x, y }) => `${x},${y}`));
    for (let y = 0; y < layout.rows * 64; y++) for (let x = 0; x < width; x++) {
      const occupied = cells.has(`${Math.floor(x / 64)},${Math.floor(y / 64)}`), p = ((y + top) * width + x) * 4;
      const color = occupied ? (x % 64 === 0 || y % 64 === 0 ? [58, 94, 98] : [118, 178, 164]) : [239, 244, 241];
      rgba.set([...color, 255], p);
    }
    top += layout.rows * 64 + 16;
  }
  writeFreshFile(join(output, 'geometry-preview.png'), encodeRgbaPng(width, height, rgba), sourceRoot);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error.errors?.[0]?.code ?? 'PREPARATION_FAILED',
    message: 'Terrain proof preparation failed; preserve partial evidence and inspect; never overwrite or automatically generate' }));
  process.exitCode = 1;
}

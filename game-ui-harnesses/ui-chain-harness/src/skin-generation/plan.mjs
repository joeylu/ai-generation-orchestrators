import { readFile, writeFile, mkdir, rename, lstat } from 'node:fs/promises';
import { dirname, join, resolve, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import Ajv from 'ajv';
import { defaults } from '../contracts/build.mjs';
import { readContracts } from '../contracts/validate.mjs';
import { defaultOutput, templateStatus } from '../templates/build.mjs';
import { deriveModelProjection } from '../templates/catalog.mjs';
import { hash, json, readSafe, bindingsOf } from '../skins/package.mjs';
import { decodePng } from '../skins/png.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const styleSchema = await readFile(join(root, 'schemas/skin-style.schema.json'));
const validateStyle = new Ajv({ allErrors: true, strict: true }).compile(JSON.parse(styleSchema));
const fail = message => { throw Object.assign(Error(message), { code: 'skin.plan' }); };
const digest = /^[a-f0-9]{64}$/;
const matches = (rule, id) => rule.match.assetId === id || (rule.match.assetPrefix && id.startsWith(rule.match.assetPrefix));
const record = (file, bytes) => ({ file, bytes: bytes.length, sha256: hash(bytes) });

async function noLinks(path) {
  let current = parse(resolve(path)).root;
  for (const part of resolve(path).slice(current.length).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) fail('Links/junctions are not supported.'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}
async function inputBytes(path, limit) {
  await noLinks(path);
  const info = await lstat(path);
  if (!info.isFile() || info.size < 1 || info.size > limit) fail('Expected a bounded regular input file.');
  return readFile(path);
}
async function toolIdentity() {
  const names = ['src/skin-generation/plan.mjs', 'schemas/skin-style.schema.json', 'src/templates/catalog.mjs',
    'src/templates/build.mjs', 'src/templates/contract.mjs', 'src/contracts/validate.mjs', 'src/contracts/props.mjs',
    'src/skins/package.mjs', 'src/skins/contract.mjs', 'src/skins/png.mjs', 'package-lock.json',
    'schemas/skin-template-set.schema.json', 'schemas/component-registry.schema.json', 'schemas/skin-usage.schema.json'];
  const files = [];
  for (const file of names.sort()) files.push(record(file, await readFile(join(root, file))));
  return { sha256: hash(json(files)), files };
}

function compilePrompt(style, geometry) {
  return [
    'Generate one transparent game UI skin atlas. Use-case: stylized-concept. This is a single asset sheet, not a finished panel.',
    'Input image 1 is STYLE REFERENCE ONLY: materials, colors, bevels and lighting. Do not copy its composition, text, scenery or complete controls.',
    'Input image 2 is the EXACT GEOMETRY TEMPLATE. Its colors are placeholders. Preserve its canvas, number of parts, positions, silhouettes and relative sizes.',
    `The JSON below uses top-left logical coordinates. Each bodyRect is [x,y,width,height]; multiply each value by outputScale=${geometry.coordinates.outputScale} for output pixels. Paint only inside that output bodyRect, including every border, highlight and shadow. Keep all other pixels genuinely transparent, not a checkerboard painting.`,
    'Do not render text, labels, IDs, numbers, guides, grids, functional icons, scenes or ornamental extra objects. Do not rotate, rearrange, merge, crop, resize or omit parts.',
    'Tracks must be empty tracks. Thumbs must be separate isolated thumbs. A track must never contain a knob, slider thumb or filled progress segment. The full-length bar.fill is a separate asset.',
    'Keep same-family states aligned with the same silhouette. Depict pressed states with shading inside the original bounds, not by shifting or resizing the geometry.',
    'For horizontal/vertical stretch parts, keep endcaps distinct and central material simple and continuous along the stretch axis; no motifs or long lighting gradients that would distort when stretched.',
    `Output: one ${geometry.coordinates.width * geometry.coordinates.outputScale} x ${geometry.coordinates.height * geometry.coordinates.outputScale} PNG with real continuous alpha.`,
    'STYLE DATA (observedRules describe the reference; extensionRules and partRules are proposed adaptations for the new parts):',
    json(style),
    'AUTHORITATIVE GEOMETRY DATA (asset IDs are metadata only and must not be drawn):',
    json(geometry),
  ].join('\n\n');
}

function review(plan, style) {
  return [
    '# 首套皮肤：单板试验计划', '',
    `风格：${style.name}；风格修订 ${style.revision}（draft，尚未作为人工接受记录）。`, '',
    `本次只请求 ${plan.sheetId}，${plan.assetCount} 个独立部件，${plan.request.width}×${plan.request.height}，1 张透明 PNG。`, '',
    '选择参考图不等于接受风格推导，也不等于计算授权。plan.json 的 SHA-256 是本次授权绑定对象。', '',
    '[原始参考图](reference.png) · [风格 JSON](inputs/style.json) · [无标注模板](template.clean.png) · [编号核对图](template.review.png) · [几何 JSON](geometry.json) · [完整提示词](prompt.txt) · [不可变计划](plan.json)', '',
    '## 视觉规则', '', ...style.observedRules.map(s => `- ${s}`), '',
    '## 本次适配建议', '', ...style.extensionRules.map(s => `- ${s}`), '',
    '| 资产 | 主体 x,y,w,h | 伸缩方式 |', '| --- | --- | --- |',
    ...plan.parts.map(p => `| ${p.assetId} | ${p.bodyRect.join(', ')} | ${p.stretch} |`), '',
    '## 验收与调用边界', '',
    '- 本地规划未提交模型请求。后续经单次明确授权才提交一张试验板；可能已接受的请求不自动重投。',
    '- 生成工具可以请求透明图，但坐标、原生尺寸、PNG 编码和 alpha 能力尚未实测，不能保证符合合同。',
    '- 原始结果先保留并检查尺寸、真实 alpha、部件非空、主体外像素及语义对应。错位不自动纠偏，不静默重采样或抠底。',
    '- 人工检查风格和状态识别，再确定实际切片/安全区/最小尺寸，检查拉伸。S03 通过不代表四板/30 部件或 16 类组件真实皮肤验收完成。',
    '- 本地命令支持输入冻结、摘要验证、单次授权预留和结果接收检查；模型提交仍是独立工具调用，人工美术接受另行记录。预留不代表模型已经提交或成功。', '',
    '![编号模板，仅用于人工核对](template.review.png)', '',
  ].join('\n');
}

/** Read-only planning w.r.t. providers. Copies inputs unchanged into a private, immutable bundle. */
export async function prepareGenerationPlan({ reference, style: stylePath, output, sheetId = 'S03', contracts = defaults, templateOutput = defaultOutput }) {
  const source = await readContracts(contracts), bindings = bindingsOf(source), tool = await toolIdentity();
  const status = await templateStatus({ config: contracts.template, output: templateOutput });
  if (status.status !== 'current') fail('Rebuild/repair the template PNGs before preparing a plan.');
  const selected = source.template.sheets.find(s => s.id === sheetId);
  if (!selected) fail('Unknown sheet ID.');
  const styleBytes = await inputBytes(stylePath, 256 * 1024), style = JSON.parse(styleBytes);
  if (!validateStyle(style)) fail('Invalid style draft. Check skin-style.schema.json.');
  const assetIds = source.template.sheets.flatMap(s => s.parts.map(p => p.assetId));
  for (const rule of style.partRules) if (!assetIds.some(id => matches(rule, id))) fail('A style rule matches no active template asset.');
  const referenceBytes = await inputBytes(reference, 32 * 1024 * 1024), referenceImage = decodePng(referenceBytes);
  const buildDir = join(templateOutput, 'builds', status.buildId);
  const clean = await readSafe(buildDir, selected.filePrefix + '.clean.png');
  const numbered = await readSafe(buildDir, selected.filePrefix + '.review.png');
  const model = deriveModelProjection(source.template, bindings.templateSha256);
  const geometry = { ...model, scope: 'Single-sheet geometry; exact placement is a validation requirement, not a model capability guarantee.', sheets: model.sheets.filter(s => s.id === sheetId) };
  const width = model.coordinates.width * model.coordinates.outputScale, height = model.coordinates.height * model.coordinates.outputScale;
  const decoded = decodePng(clean);
  if (decoded.width !== width || decoded.height !== height) fail('Template PNG dimensions differ from geometry.');
  const resources = new Map([
    ['reference.png', referenceBytes], ['template.clean.png', clean], ['template.review.png', numbered],
    ['inputs/style.json', styleBytes], ['inputs/template.json', source.bytes.template],
    ['inputs/registry.json', source.bytes.registry], ['inputs/usage.json', source.bytes.usage],
    ['geometry.json', Buffer.from(json(geometry))], ['prompt.txt', Buffer.from(compilePrompt(style, geometry))],
  ]);
  const plan = {
    kind: 'ui_skin_generation_plan', version: '0.1', status: 'awaiting-style-and-compute-confirmation', computeAuthorized: false,
    style: { id: style.id, revision: style.revision, status: style.status }, bindings, tool,
    reference: { file: 'reference.png', width: referenceImage.width, height: referenceImage.height, role: 'style-only' },
    sheetId, assetCount: selected.parts.length,
    parts: selected.parts.map(({ assetId, bodyRect, stretch }) => ({ assetId, bodyRect, stretch })),
    request: { images: 1, width, height, format: 'png', transparentBackground: true,
      inputImages: [{ file: 'reference.png', role: 'style-only' }, { file: 'template.clean.png', role: 'exact-geometry' }],
      promptFile: 'prompt.txt', geometryFile: 'geometry.json' },
    capabilityEvidence: { exactGeometry: 'unverified', nativeResolution: 'unverified', alpha: 'unverified', pngEncoding: 'unverified' },
    policy: { functionalIcons: false, bakedText: false, automaticRetry: false, silentResampling: false,
      automaticRecropping: false, automaticBackgroundRemoval: false, preserveRawOutput: true, visualAcceptance: 'unreviewed', productionReady: false },
    resources: [...resources].map(([name, b]) => record(name, b)),
  };
  const reviewBytes = Buffer.from(review(plan, style));
  resources.set('review.md', reviewBytes); plan.resources.push(record('review.md', reviewBytes));
  const planBytes = Buffer.from(json(plan)), planSha256 = hash(planBytes);
  await noLinks(output);
  const directory = join(resolve(output), planSha256), staging = join(resolve(output), '.staging', randomUUID());
  await noLinks(staging); await noLinks(directory);
  await mkdir(staging, { recursive: true });
  for (const [name, bytes] of [...resources, ['plan.json', planBytes]]) {
    await mkdir(dirname(join(staging, name)), { recursive: true });
    await writeFile(join(staging, name), bytes, { flag: 'wx' });
  }
  // Do not publish a mixture of edited source files or a replaced template build.
  if (hash(await inputBytes(reference, 32 * 1024 * 1024)) !== hash(referenceBytes) || hash(await inputBytes(stylePath, 256 * 1024)) !== hash(styleBytes)) fail('Reference/style changed during planning.');
  const after = await templateStatus({ config: contracts.template, output: templateOutput });
  if (after.status !== 'current' || after.buildId !== status.buildId) fail('Template build changed during planning.');
  await verifyGenerationPlan({ directory: staging, planSha256, contracts });
  try { await rename(staging, directory); }
  catch (e) {
    if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(e.code)) throw e;
    await verifyGenerationPlan({ directory, planSha256, contracts });
  }
  return { status: plan.status, directory, planSha256, sheetId, assets: plan.assetCount, computeAuthorized: false };
}

/** Integrity/freshness check only. Never authorizes or reserves a generation attempt. */
export async function verifyGenerationPlan({ directory, planSha256, contracts = defaults }) {
  if (!digest.test(planSha256 ?? '')) fail('The caller must supply the reviewed plan SHA-256.');
  const bytes = await readSafe(directory, 'plan.json', 2 * 1024 * 1024);
  if (hash(bytes) !== planSha256) fail('Plan digest mismatch.');
  const plan = JSON.parse(bytes);
  if (plan.kind !== 'ui_skin_generation_plan' || plan.version !== '0.1' || plan.computeAuthorized !== false) fail('Invalid planning record.');
  for (const f of plan.resources) {
    const b = await readSafe(directory, f.file);
    if (b.length !== f.bytes || hash(b) !== f.sha256) fail('A frozen plan resource changed.');
  }
  const bindings = bindingsOf(await readContracts(contracts));
  if (Object.keys(bindings).some(k => bindings[k] !== plan.bindings[k]) || (await toolIdentity()).sha256 !== plan.tool.sha256) fail('Contracts or planning tools changed; create a new plan.');
  return { status: 'verified-awaiting-confirmation', planSha256, sheetId: plan.sheetId, assets: plan.assetCount, computeAuthorized: false };
}

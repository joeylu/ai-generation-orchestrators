import { readFile, writeFile, mkdir, rename, unlink, open, readdir, lstat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { root, readTemplate, fail, TemplateError } from './contract.mjs';
import { deriveCatalog, deriveModelProjection, deriveOverview } from './catalog.mjs';

export const defaultConfig = fileURLToPath(new URL('configs/skin-template-set.draft.json', root));
export const defaultOutput = fileURLToPath(new URL('previews/skin-templates/', root));
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value,null,2)+'\n';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const digest = /^[a-f0-9]{64}$/;
const artifactName = /^[a-z0-9][a-z0-9.-]*\.(?:json|md|png)$/;
const derivedNames = spec => ['source.json','catalog.json','model-projection.json','overview.md', ...spec.sheets.flatMap(s => ['clean','review'].map(role => `${s.filePrefix}.${role}.png`))];

async function publishRename(from, to) {
  // Windows scanners can briefly hold a newly written file/directory open.
  // Retry only the same local rename, never rendering or provider work.
  for (let attempt = 0; ; attempt++) {
    try { await rename(from,to); return; }
    catch (error) {
      if (process.platform !== 'win32' || !['EPERM','EACCES','EBUSY'].includes(error.code) || attempt === 3) throw error;
      await delay(25 * (attempt+1));
    }
  }
}

export async function toolIdentity() {
  const names = ['package.json','package-lock.json','schemas/skin-template-set.schema.json','scripts/templates.mjs','scripts/render-templates.mjs'];
  for (const dir of ['src/templates']) {
    const entries = await readdir(new URL(`${dir}/`,root),{ withFileTypes: true });
    names.push(...entries.filter(e => e.isFile() && /\.(mjs|json)$/.test(e.name)).map(e => `${dir}/${e.name}`));
  }
  const files = [];
  for (const file of names.sort()) files.push({ file, sha256: hash(await readFile(new URL(file,root))) });
  return { sha256: hash(json(files)), files };
}

async function realDirectory(path) {
  await mkdir(path,{ recursive: true });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('/out','output.directory','产物目录不能是符号链接或普通文件。');
}
async function readRegularFile(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('/current','output.file','产物必须是普通文件。');
  return readFile(path);
}

// The renderer is injectable for offline failure tests; the CLI always uses the real renderer.
export async function buildTemplates({ config = defaultConfig, output = defaultOutput, channel = 'chromium', render } = {}) {
  const { bytes, spec } = await readTemplate(config);
  const sourceSha256 = hash(bytes), tool = await toolIdentity();
  const sourceRelative = relative(resolve(output),resolve(config));
  if (!sourceRelative || (sourceRelative !== '..' && !sourceRelative.startsWith(`..${sep}`) && !isAbsolute(sourceRelative))) fail('/out','output.source','源配置必须放在派生产物目录之外。');
  await realDirectory(output);
  const lockPath = join(output,'.build.lock');
  let lock;
  try { lock = await open(lockPath,'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') fail('/out','build.busy','存在 .build.lock；请等待其他构建完成。异常退出的恢复方法见字段说明。');
    throw error;
  }
  const buildId = randomUUID();
  let phase = 'prepare';
  let published;
  try {
    await lock.writeFile(json({ buildId }));
    for (const name of ['.staging','builds']) await realDirectory(join(output,name));
    const candidate = join(output,'.staging',buildId);
    await mkdir(candidate);
    const emit = (name, value) => writeFile(join(candidate,name),value,{ flag: 'wx' });
    const catalog = deriveCatalog(spec,sourceSha256);
    await emit('source.json',bytes);
    await emit('catalog.json',json(catalog));
    await emit('model-projection.json',json(deriveModelProjection(spec,sourceSha256)));
    await emit('overview.md',deriveOverview(catalog));
    phase = 'render';
    const renderer = render ?? (await import('./renderer.mjs')).renderSheets;
    const rendering = await renderer({ spec, directory: candidate, channel });
    const expectedPngs = derivedNames(spec).filter(n => n.endsWith('.png')).sort();
    const actualPngs = rendering.files.map(f => f.file).sort();
    if (JSON.stringify(expectedPngs) !== JSON.stringify(actualPngs)) fail('/render','render.files','渲染输出文件与模板板清单不一致。');
    phase = 'verify';
    const files = [];
    for (const file of derivedNames(spec)) {
      const data = await readRegularFile(join(candidate,file));
      files.push({ file, bytes: data.length, sha256: hash(data) });
    }
    if (hash(await readFile(config)) !== sourceSha256 || (await toolIdentity()).sha256 !== tool.sha256) fail('/source','build.changed','构建期间源配置或工具发生变化，请重新构建。');
    const record = {
      kind: 'ui_template_build', version: '0.1', buildId,
      scope: 'Offline documentation template build; not a generated skin pack or component acceptance.',
      source: { file: 'source.json', sha256: sourceSha256, templateVersion: spec.version, revision: spec.revision },
      tool, runtime: { node: process.versions.node, ...rendering }, files,
    };
    const recordBytes = json(record);
    await emit('build-record.json',recordBytes);
    phase = 'publish';
    await publishRename(candidate,join(output,'builds',buildId));
    const pointer = { kind: 'ui_template_current', version: '0.1', buildId, recordSha256: hash(recordBytes) };
    const pendingPointer = join(output,`.current-${buildId}.json`);
    await writeFile(pendingPointer,json(pointer),{ flag: 'wx' });
    // Both files are on the same volume. Readers see the previous or the completed build.
    await publishRename(pendingPointer,join(output,'current.json'));
    published = { status: 'built', buildId, sheetCount: spec.sheets.length, partCount: catalog.partCount,
      sourceSha256, overview: `builds/${buildId}/overview.md` };
    return published;
  } catch (error) {
    if (error instanceof TemplateError) throw error;
    const reason = typeof error.code === 'string' && /^[A-Z_]+$/.test(error.code) ? ` (${error.code})` : '';
    fail(`/build/${phase}`,'build.failed',`阶段 ${phase} 失败${reason}，候选 ${buildId} 未切换到 current.json。检查浏览器安装、目录权限和 .staging 候选；上一版仍保留。`);
  } finally {
    try { await lock.close(); await unlink(lockPath); }
    catch {
      // Publication has already succeeded; a cleanup problem must not report a
      // failed build or obscure the original pre-publication failure.
      if (published) published.warning = '构建已发布，但 .build.lock 清理失败；下次构建前请按维护说明检查并清理该锁。';
    }
  }
}

export async function templateStatus({ config = defaultConfig, output = defaultOutput } = {}) {
  let pointer;
  try { pointer = JSON.parse(await readRegularFile(join(output,'current.json'))); }
  catch (error) { return { status: error.code === 'ENOENT' ? 'missing' : 'corrupt', issues: [{ path: '/current', code: 'current.read', message: '当前入口不存在或无法读取。' }] }; }
  let record;
  try {
    if (pointer.kind !== 'ui_template_current' || pointer.version !== '0.1' || !uuid.test(pointer.buildId) || !digest.test(pointer.recordSha256)) throw new Error();
    const directory = join(output,'builds',pointer.buildId);
    for (const path of [output,join(output,'builds'),directory]) {
      const stat = await lstat(path);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error();
    }
    const bytes = await readRegularFile(join(directory,'build-record.json'));
    if (hash(bytes) !== pointer.recordSha256) throw new Error();
    record = JSON.parse(bytes);
    if (record.kind !== 'ui_template_build' || record.version !== '0.1' || record.buildId !== pointer.buildId || !digest.test(record.source.sha256) || !digest.test(record.tool.sha256)) throw new Error();
    const { spec, bytes: snapshot } = await readTemplate(join(directory,'source.json'));
    if (hash(snapshot) !== record.source.sha256 || JSON.stringify(record.files.map(f => f.file).sort()) !== JSON.stringify(derivedNames(spec).sort())) throw new Error();
    for (const entry of record.files) {
      if (!artifactName.test(entry.file) || !digest.test(entry.sha256)) throw new Error();
      const data = await readRegularFile(join(directory,entry.file));
      if (hash(data) !== entry.sha256 || data.length !== entry.bytes) throw new Error();
    }
  } catch { return { status: 'corrupt', issues: [{ path: '/current', code: 'current.integrity', message: '当前版本结构、路径或产物摘要校验失败。' }] }; }
  const previous = { buildId: pointer.buildId, sourceSha256: record.source.sha256, overview: `builds/${pointer.buildId}/overview.md` };
  let source;
  try { source = await readTemplate(config); }
  catch (error) { return { status: 'invalid-source', ...previous, issues: error.issues ?? [{ path: '/source', code: 'source.read', message: '无法读取源配置。' }] }; }
  const sourceChanged = hash(source.bytes) !== record.source.sha256;
  const toolChanged = (await toolIdentity()).sha256 !== record.tool.sha256;
  return { status: sourceChanged || toolChanged ? 'stale' : 'current', ...previous, sourceChanged, toolChanged };
}

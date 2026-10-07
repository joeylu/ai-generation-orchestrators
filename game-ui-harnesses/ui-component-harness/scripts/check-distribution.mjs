/** Offline regression of actual release artifacts; never dispatches compute. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, symlink, realpath, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { layerPlanningFixture, fixtureFindings, fixtureProceduralAdaptations } from '../tests/helpers/layer-planning-fixture.ts';
import { fixtureStyle } from '../src/fixtures.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw Error('Run via npm run test:distribution.');
await mkdir(join(root, '.tmp'), { recursive: true });
const folder = await mkdtemp(join(root, '.tmp/distribution-'));
const checks = [];
const command = (label, executable, args, cwd = root) => {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    timeout: 180000, env: { ...process.env, npm_config_cache: join(folder, 'npm-cache') } });
  // Keep the original diagnostics, including failures, in this fresh directory.
  const log = `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? String(result.error) : ''}`;
  return writeFile(join(folder, `${label}.log`), log).then(() => {
    assert.equal(result.status, 0, `${label} failed; inspect its retained log. ${log.slice(-1500)}`);
    return result.stdout;
  });
};
const fingerprint = async path => {
  const bytes = await readFile(path);
  return { file: path.slice(folder.length + 1).replaceAll('\\', '/'), bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex') };
};
let host, browser;
try {
  const fixture = await layerPlanningFixture();
  // The installed candidate must compile and preserve the new explicit policy.
  fixture.proposal.plan.document.root.props.drawBackground = false;
  // Explicit procedural release fixture, with no inferred user artwork/semantics.
  fixture.proposal.plan.document.root.children.push(
    { id: 'tips', type: 'Switch', layout: { x: 90, y: 10, width: 90, height: 30 }, props: {
      label: 'TIPS', checked: false, enabled: true, style: { ...fixtureStyle, fontSize: 12 } } },
    { id: 'volume', type: 'Slider', layout: { x: 90, y: 50, width: 90, height: 38 }, props: {
      value: 60, min: 0, max: 100, step: 1, enabled: true, style: { ...fixtureStyle, fontSize: 12 } } });
  fixture.proposal.plan.adaptations = fixtureProceduralAdaptations(fixture.proposal.plan.document);
  fixture.proposal.findings = fixtureFindings(fixture.proposal.plan.document);
  const archivePath = join(folder, 'fixture.zip');
  await writeFile(archivePath, fixture.bytes);
  const packed = JSON.parse(await command('npm-pack', process.execPath,
    [npmCli, 'pack', '--ignore-scripts', '--json', '--pack-destination', folder]));
  assert.equal(packed.length, 1);
  const packedFiles = new Set(packed[0].files.map(file => file.path));
  for (const file of ['lib/index.js', 'lib/browser.js', 'dist-browser/index.js', 'scripts/studio-codex-plan.mjs',
    'scripts/studio-layer-render.mjs', 'scripts/harness-module.mjs', 'scripts/layer-ui-interaction-check.mjs',
    'dist/layer-plan-check.html', 'prompts/layer-component-plan.md', 'docs/tree-contract.md', 'lib/tree-contract.d.ts'])
    assert.ok(packedFiles.has(file), `installed artifact missing ${file}`);
  for (const name of packedFiles) assert.ok(!name.startsWith('src/') && !name.split('/').includes('..') && !name.startsWith('/'));
  const consumer = join(folder, 'consumer'), nm = join(consumer, 'node_modules');
  await mkdir(nm, { recursive: true });
  const installed = join(nm, 'ai-ui-component-harness');
  // Extract directly: Windows can refuse renaming a freshly extracted tree.
  await mkdir(installed);
  await command('npm-extract', 'tar', ['-xzf', join(folder, packed[0].filename), '--strip-components=1', '-C', installed]);
  const installedMetadata = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  assert.equal(installedMetadata.version, packed[0].version);
  assert.equal(JSON.parse(await readFile(join(installed, 'skill.json'), 'utf8')).version, installedMetadata.version);
  for (const name of ['playwright', 'pixi.js'])
    await symlink(await realpath(join(root, 'node_modules', name)), join(nm, name), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(access(join(installed, 'src')));
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  const probe = `
    import assert from 'node:assert/strict';
    import {readFile,writeFile} from 'node:fs/promises';
    for(const key of ['window','document','navigator']) Object.defineProperty(globalThis,key,{get(){throw Error('browser import in Node entry');},configurable:true});
    const core=await import('ai-ui-component-harness');
    const adapter=await import('ai-ui-component-harness/planning');
    assert.equal(adapter.MAX_PLAN_CORRECTIONS,3);assert.equal(typeof adapter.createCodexLayerPlanner,'function');
    const archive=new Uint8Array(await readFile('../fixture.zip'));
    const input=await core.layerPlanningInput(archive,{semanticInputs:{version:'1.0',controls:[
      {subject:'action',target:{type:'Button',id:'action'},values:{enabled:true}},
      {subject:'tips',target:{type:'Switch',id:'tips'},values:{checked:false}},
      {subject:'volume',target:{type:'Slider',id:'volume'},values:{value:60,min:0,max:100,step:1}}
    ]}});
    const proposal=JSON.parse(await readFile('../proposal.json','utf8'));
    const plan=await core.validateLayerProposal(archive,input,proposal);
    const bundle=await core.compileLayerComponents(archive,plan);
    await core.validateBundle(bundle);
    assert.equal(bundle.document.root.props.drawBackground,false);
    await writeFile('../plan.json',JSON.stringify(plan));await writeFile('../bundle.json',JSON.stringify(bundle));
    // The installed adapter must resolve its prompt and public declaration files, with no checkout src.
    const {buildLayerPlanPrompt}=await import('./node_modules/ai-ui-component-harness/scripts/studio-codex-plan.mjs');
    const prompt=await buildLayerPlanPrompt(input,['reference.png']);
    assert.ok(prompt.includes('Frozen user semantic facts'));assert.ok(prompt.includes(input.semanticInputs.sha256));
    console.log(JSON.stringify({status:'PASS',semanticDigest:input.semanticInputs.sha256,archiveDigest:input.archiveSha256}));
  `;
  await writeFile(join(folder, 'proposal.json'), JSON.stringify(fixture.proposal));
  await writeFile(join(consumer, 'probe.mjs'), probe);
  await command('installed-node-entry', process.execPath, ['probe.mjs'], consumer);
  await command('installed-cli-build', process.execPath, [join(installed, 'scripts/cli.mjs'), 'layer-build', archivePath,
    '--plan', join(folder, 'plan.json'), '--output', join(folder, 'cli-bundle.json')], consumer);
  await command('installed-cli-validate', process.execPath, [join(installed, 'scripts/cli.mjs'), 'validate', join(folder, 'cli-bundle.json')], consumer);
  await command('installed-self-test', process.execPath, [join(installed, 'scripts/cli.mjs'), 'self-test'], consumer);
  await command('installed-doctor', process.execPath, [join(installed, 'scripts/cli.mjs'), 'doctor'], consumer);
  checks.push('installed Node import without browser globals', 'installed prompt/schema discovery', 'installed semantic compile and CLI', 'installed self-test and doctor');
  const bundle = JSON.parse(await readFile(join(folder, 'bundle.json'), 'utf8'));
  assert.deepEqual(JSON.parse(await readFile(join(folder, 'cli-bundle.json'), 'utf8')), bundle);
  const core = await import(pathToFileURL(join(installed, 'lib/index.js')).href);
  const renderer = await import(pathToFileURL(join(installed, 'scripts/layer-render-host.mjs')).href);
  host = await renderer.startLayerRenderServer();
  const render = await renderer.checkLayerPlanRender(bundle, { origin: host.origin, folder });
  await writeFile(join(folder, 'render-report.json'), JSON.stringify(render, null, 2));
  assert.equal(render.status, 'pass'); assert.equal(render.code, 'LAYER_RENDER_PASS');
  assert.equal(render.forbiddenRequests, 0); assert.deepEqual(render.errors, []);
  const { chromium } = await import('playwright');
  browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 400, height: 240 } });
  let forbidden = 0; const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const sdkBytes = await readFile(join(installed, 'dist-browser/index.js'));
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url === host.origin + '/assets/consumer-sdk.js') return route.fulfill({ contentType: 'text/javascript', body: sdkBytes });
    if (url.startsWith(host.origin + '/') || url.startsWith('blob:' + host.origin + '/')) return route.continue();
    forbidden++; return route.abort();
  });
  await page.goto(host.origin + '/layer-plan-check.html');
  await page.waitForFunction(() => Boolean(window.layerPlanCheck));
  await page.evaluate(async value => {
    window.layerPlanCheck.destroy();
    const api = await import('/assets/consumer-sdk.js');
    const bundle = await api.validateBundle(value);
    const resources = new Map(api.bundleResources(bundle).map(resource => [resource.path, resource]));
    const preview = await api.createTreePreview(document.getElementById('check-canvas'), error => { throw error; });
    const events = []; preview.subscribe(event => events.push(event));
    await preview.load(bundle.document, new AbortController().signal, async (source, signal) => {
      const resource = resources.get(source); if (!resource) throw Error('missing installed resource');
      const url = URL.createObjectURL(new Blob([resource.bytes], { type: resource.mime }));
      try { const image = new Image(); image.src = url; await image.decode(); signal.throwIfAborted(); return image; }
      finally { URL.revokeObjectURL(url); }
    });
    window.installedPreview = { api, preview, events, bundle };
  }, bundle);
  const button = page.locator('#check-canvas canvas');
  const bounds = await button.boundingBox(); assert.ok(bounds);
  const point = { x: bounds.x + 40, y: bounds.y + 35 };
  await page.mouse.click(point.x, point.y);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  const activations = () => page.evaluate(() => window.installedPreview.events.filter(event => event.id === 'action' && event.type === 'activate'));
  assert.deepEqual((await activations()).map(event => event.source), ['mouse', 'keyboard']);
  await page.evaluate(() => window.installedPreview.preview.setEnabled('action', false));
  await page.mouse.click(point.x, point.y); await page.keyboard.press('Enter');
  assert.equal((await activations()).length, 2);
  await assert.rejects(page.evaluate(async () => {
    const { api, preview, bundle } = window.installedPreview;
    return api.validateBundle({ ...bundle, document: preview.getDocument() });
  }), /LAYER_SOURCE_STALE/); // enabled remains a frozen contract field, not a permitted saved value.
  await page.evaluate(() => window.installedPreview.preview.setEnabled('action', true));
  await page.mouse.click(point.x, point.y);
  assert.equal((await activations()).length, 3);
  await page.mouse.click(bounds.x + 135, bounds.y + 25);
  assert.equal(await page.evaluate(() => window.installedPreview.preview.getDocument().root.children.find(node => node.id === 'tips').props.checked), true);
  await page.mouse.click(bounds.x + 135, bounds.y + 69);
  const sliderBefore = await page.evaluate(() => window.installedPreview.preview.getDocument().root.children.find(node => node.id === 'volume').props.value);
  assert.notEqual(sliderBefore, 60);
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowRight');
  const sliderSaved = await page.evaluate(() => window.installedPreview.preview.getDocument().root.children.find(node => node.id === 'volume').props.value);
  assert.equal(sliderSaved, sliderBefore + 1);
  const saved = await page.evaluate(async () => {
    const { api, preview, bundle } = window.installedPreview;
    return api.validateBundle({ ...bundle, document: preview.getDocument() });
  });
  const reopened = await core.validateBundle(JSON.parse(JSON.stringify(saved)));
  assert.equal(reopened.document.root.props.drawBackground, false);
  assert.equal(reopened.layerSource.plan.semanticInputs.sha256, bundle.layerSource.plan.semanticInputs.sha256);
  assert.deepEqual(Buffer.from(reopened.layerSource.base64, 'base64'), Buffer.from(fixture.bytes));
  for (const resource of reopened.resources) assert.deepEqual(Buffer.from(resource.base64, 'base64'), Buffer.from(fixture.entries.get(resource.path)));
  await writeFile(join(folder, 'saved-bundle.json'), JSON.stringify(saved));
  // Reuse the same validated byte resolver to reload all source art after state saving.
  await page.evaluate(async value => {
    const { api, preview } = window.installedPreview;
    const bundle = await api.validateBundle(value);
    const resources = new Map(api.bundleResources(bundle).map(resource => [resource.path, resource]));
    await preview.load(bundle.document, new AbortController().signal, async source => {
      const r = resources.get(source), url = URL.createObjectURL(new Blob([r.bytes], { type: r.mime }));
      try { const image = new Image(); image.src = url; await image.decode(); return image; } finally { URL.revokeObjectURL(url); }
    });
  }, reopened);
  const values = await page.evaluate(() => window.installedPreview.preview.getDocument().root.children
    .filter(node => ['action', 'tips', 'volume'].includes(node.id)).map(node => node.props));
  assert.equal(values[0].enabled, true); assert.equal(values[1].checked, true); assert.equal(values[2].value, sliderSaved);
  await button.screenshot({ path: join(folder, 'sdk-reopened.png') });
  await page.evaluate(() => window.installedPreview.preview.destroy());
  assert.equal(await button.count(), 0); assert.equal(forbidden, 0); assert.deepEqual(errors, []);
  checks.push('installed static host real Pixi measurement', 'standalone SDK real mouse/keyboard, disabled activation, toggle and slider',
    'frozen contract mutation refused; allowed states export/reopen with exact ZIP/resource bytes', 'browser teardown and zero outbound requests');
  // Source artifact extraction/build uses only its recorded files and existing locked dev tools.
  const python = process.env.UI_HARNESS_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  await command('source-package', python, [join(root, 'scripts/package_source.py'), '--output-dir', folder]);
  const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const sourceZip = join(folder, `ui-component-harness-v${metadata.version}-source.zip`);
  await command('source-extract', python, ['-c', `import zipfile,sys,hashlib,pathlib
p=pathlib.Path(sys.argv[2]);p.mkdir()
with zipfile.ZipFile(sys.argv[1]) as z:
 for name in z.namelist():
  assert not name.startswith('/') and '..' not in pathlib.PurePosixPath(name).parts
 z.extractall(p)
r=p/'ui-component-harness'
for row in (r/'SHA256SUMS').read_text().splitlines():
 sha,name=row.split('  ',1);assert hashlib.sha256((r/name).read_bytes()).hexdigest()==sha
`, sourceZip, join(folder, 'source')]);
  const sourceRoot = join(folder, 'source/ui-component-harness');
  await symlink(await realpath(join(root, 'node_modules')), join(sourceRoot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  await command('source-clean-build', process.execPath, [npmCli, 'run', 'build'], sourceRoot);
  checks.push('source ZIP member checksums and extracted clean build');
  const report = { status: 'PASS', kind: 'offline-installed-distribution-regression', node: process.version,
    platform: process.platform, browser: process.platform === 'win32' ? 'msedge' : 'chromium',
    checks, nativeModelDispatches: 0, nativeFullChainPassed: false, humanVisualAcceptance: false,
    artifacts: await Promise.all([join(folder, packed[0].filename), sourceZip, join(folder, 'bundle.json'),
      join(folder, 'saved-bundle.json'), join(folder, 'render.png'), join(folder, 'sdk-reopened.png')].map(fingerprint)) };
  await writeFile(join(folder, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, evidenceDirectory: folder }));
} catch (error) {
  await writeFile(join(folder, 'verification.json'), JSON.stringify({ status: 'FAIL', checks,
    error: String(error.message), nativeModelDispatches: 0 }, null, 2));
  console.error(`Distribution regression failed; retained evidence: ${folder}`); throw error;
} finally { await browser?.close(); await host?.close(); }

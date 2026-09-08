/** Record executed offline verification and exact implementation fingerprints. */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run via npm run verify so the active npm CLI is explicit.');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--report-prefix' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(args[1])))
  throw new Error('Usage: npm run verify -- [--report-prefix <portable-name>]');
const prefix = args[1] ?? 'current';
const reports = resolve(root, 'reports'); mkdirSync(reports, { recursive: true });
const redact = text => text.replaceAll(root.replaceAll('\\', '/'), '<harness>').replaceAll(root, '<harness>')
  .replace(/\x1b\[[0-9;]*m/g, '').replaceAll(process.env.USERPROFILE || '/nonexistent-user-home', '<user-home>');
const commands = [
  ['build', ['run', 'build']], ['unit', ['test']], ['self-test', ['run', 'self-test']],
  ['doctor', ['run', 'doctor']], ['browser', ['run', 'test:browser']],
];
const results = [];
for (const [name, args] of commands) {
  const start = Date.now();
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 300000,
    env: { ...process.env, UI_HARNESS_PREVIEW: '1' },
  });
  const output = redact(`${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? String(result.error) : ''}`);
  writeFileSync(resolve(reports, `${prefix}-${name}.log`), output);
  const record = { name, command: `npm ${args.join(' ')}`, exitCode: result.status,
    status: result.status === 0 ? 'PASS' : 'FAIL', durationMs: Date.now() - start, log: `${prefix}-${name}.log` };
  results.push(record); console.log(JSON.stringify(record));
  if (result.status !== 0) { console.error(output.slice(-5000)); break; }
}
const sources = {};
function fingerprint(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    // Task status records this run's outcome after it completes.
    if (path === resolve(root, 'docs/tasks.md')) continue;
    if (entry.isDirectory()) fingerprint(path);
    else sources[relative(root, path).replaceAll('\\', '/')] = createHash('sha256').update(readFileSync(path)).digest('hex');
  }
}
for (const directory of ['src', 'tests', 'scripts', 'skills', 'examples', 'docs', 'agents']) fingerprint(resolve(root, directory));
for (const name of ['package.json', 'package-lock.json', 'playwright.config.ts', 'vite.config.ts', 'index.html', 'workbench.html', 'SKILL.md', 'skill.json'])
  sources[name] = createHash('sha256').update(readFileSync(resolve(root, name))).digest('hex');
let browser;
if (results.some(result => result.name === 'browser')) {
  const report = JSON.parse(readFileSync(resolve(root, 'test-results/browser-results.json'), 'utf8'));
  browser = { stats: report.stats, cases: [] };
  const visit = suite => {
    for (const spec of suite.specs ?? []) browser.cases.push({ title: spec.title, file: spec.file.replaceAll('\\', '/'),
      ok: spec.ok, results: spec.tests.flatMap(test => test.results.map(result => ({ status: result.status, durationMs: result.duration }))) });
    for (const child of suite.suites ?? []) visit(child);
  };
  report.suites.forEach(visit);
}
const report = { generatedAt: new Date().toISOString(), node: process.version, platform: process.platform,
  browserChannel: process.env.UI_HARNESS_BROWSER || (process.platform === 'win32' ? 'msedge' : 'chromium'),
  mode: process.env.UI_HARNESS_EXTERNAL_SERVER === '1' ? 'external-local-server' : 'production-preview', graphics: 'software WebGL / SwiftShader',
  status: results.length === commands.length && results.every(result => result.status === 'PASS') ? 'PASS' : 'FAIL',
  commands: results, browser, sources };
writeFileSync(resolve(reports, `${prefix}-verification.json`), JSON.stringify(report, null, 2) + '\n');
if (report.status !== 'PASS') process.exitCode = 1;

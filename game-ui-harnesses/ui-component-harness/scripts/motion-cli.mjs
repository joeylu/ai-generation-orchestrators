#!/usr/bin/env node
/** Offline Motion Skill entry point. Core owns recipes, validation and sampling. */
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Choose one module graph. Source development must not mix stale lib and new TS.
let sourceTree = true;
try { await access(fileURLToPath(new URL('../src/motion-presets.ts', import.meta.url))); }
catch (error) { if (error?.code !== 'ENOENT') throw error; sourceTree = false; }
const load = name => import(new URL(sourceTree ? `../src/${name}.ts` : `../lib/${name}.js`, import.meta.url).href);
const [motion, presets, systems] = await Promise.all([load('motion'), load('motion-presets'), load('motion-system')]);
const help = `Usage: ai-ui-motion <command> [arguments]
  catalog [--output <new-file.json>]
  system <system-request.json> <v02-document.json> [--output <new-system.json>]
  validate-system <system.json> <v02-document.json> [--output <new-file.json>]
  capabilities <v02-document.json> [--output <new-file.json>]
  compile <recipe.json> <v02-document.json> [--output <new-motion.json>]
  compose <composition.json> <v02-document.json> [--output <new-motion.json>]
  validate <motion.json> <v02-document.json> [--output <new-file.json>]
  sample <motion.json> <v02-document.json> <milliseconds> [--output <new-file.json>]

All commands are offline. Only PixiJS has an implemented rendering adapter.
Timeline recipes address whole nodes. Motion systems bind style-aware presentation
to component events; committed business values remain owned by the UI runtime.`;
async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function run() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || ['--help', '-h', 'help'].includes(command)) { console.log(help); return; }
  const positionals = []; let output;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--output') {
      if (output !== undefined || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Expected one --output filename');
      output = args[++index];
    } else if (args[index].startsWith('--')) throw new Error(`Unsupported option: ${args[index]}`);
    else positionals.push(args[index]);
  }
  const arity = { catalog: 0, system: 2, 'validate-system': 2, capabilities: 1, compile: 2, compose: 2, validate: 2, sample: 3 };
  if (!Object.hasOwn(arity, command) || positionals.length !== arity[command]) throw new Error(help);
  let result;
  if (command === 'catalog') result = systems.motionSystemCatalog();
  else if (command === 'capabilities') result = motion.motionCapabilities(await json(positionals[0]));
  else {
    const input = await json(positionals[0]), ui = await json(positionals[1]);
    if (command === 'system') result = systems.compileMotionSystem(input, ui);
    else if (command === 'validate-system') {
      const checked = systems.validateMotionSystem(input, ui);
      result = { valid: true, id: checked.id, style: checked.style, bindings: checked.bindings.length };
    }
    else if (command === 'compile') result = presets.compileMotionPreset(input, ui);
    else if (command === 'compose') result = motion.composeMotions(input, ui);
    else {
      const checked = motion.validateMotion(input, ui);
      if (command === 'validate') result = { valid: true, id: checked.id, duration: checked.duration, tracks: checked.tracks.length };
      else {
        const time = positionals[2].trim() ? Number(positionals[2]) : NaN;
        result = { motionId: checked.id, time, samples: motion.sampleMotion(checked, time) };
      }
    }
  }
  const payload = JSON.stringify(result, null, 2) + '\n';
  if (output === undefined) process.stdout.write(payload);
  else { const path = resolve(output); await mkdir(dirname(path), { recursive: true }); await writeFile(path, payload, { flag: 'wx' }); }
}
run().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

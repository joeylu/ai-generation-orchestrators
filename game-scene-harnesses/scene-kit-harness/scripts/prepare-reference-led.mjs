import { join } from 'node:path';
import { check } from '../src/generation/common.mjs';
import { parseJson, readSelectedFile } from '../src/files.mjs';
import { referenceLedExample } from '../examples/reference-led/scene-briefs.mjs';
import { initReferenceLedProject, previewReferenceLedProject } from '../src/reference-led-pipeline.mjs';
try {
  const opts = {}, args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    check(['--out', '--brief', '--example', '--style-image'].includes(args[i]) && args[i + 1] && !Object.hasOwn(opts, args[i]), 'REFERENCE_ARGUMENTS'); opts[args[i]] = args[i + 1];
  }
  check(opts['--out'] && Boolean(opts['--brief']) !== Boolean(opts['--example']), 'REFERENCE_EXPLICIT_DESIGN_REQUIRED');
  check(!opts['--example'] || ['snow-castle', 'forest-slope'].includes(opts['--example']), 'REFERENCE_EXAMPLE');
  const brief = opts['--brief'] ? parseJson(readSelectedFile(opts['--brief'])) : referenceLedExample(opts['--example']);
  if (opts['--style-image']) brief.inputs.push({ role: 'style-reference', path: opts['--style-image'] });
  const state = initReferenceLedProject(opts['--out'], brief), preview = previewReferenceLedProject(opts['--out'], join(opts['--out'], 'design-preview'));
  console.log(JSON.stringify({ state, previewBundleSha256: preview.sha256, generationCalls: 0 }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error.errors?.[0]?.code ?? 'REFERENCE_PREPARATION_FAILED' })); process.exitCode = 1;
}

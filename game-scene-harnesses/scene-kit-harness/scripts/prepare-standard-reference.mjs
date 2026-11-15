import { join } from 'node:path';
import { initStandardReference, initComposedReference, previewStandardReference } from '../src/standard-pipeline.mjs';
import { snowCastleStandardBrief } from '../examples/standard-reference/snow-castle.mjs';
import { composedExampleBrief } from '../examples/standard-reference/composition-intents.mjs';
import { check } from '../src/generation/common.mjs';
import { parseJson, readSelectedFile } from '../src/files.mjs';

// Offline example preparation only. No review, plan or compute is fabricated.
try {
  const options = {}, args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    check(['--out', '--style-image', '--brief', '--example'].includes(args[i]) && args[i + 1] && !Object.hasOwn(options, args[i]), 'STANDARD_ARGUMENTS');
    options[args[i]] = args[i + 1];
  }
  check(options['--out'] && Boolean(options['--brief']) !== Boolean(options['--example']), 'STANDARD_EXPLICIT_DESIGN_REQUIRED');
  const legacy = options['--example'] === 'snow-castle-v1';
  check(!options['--example'] || ['snow-castle-v1', 'snow-valley', 'forest-slope', 'desert-canyon'].includes(options['--example']), 'STANDARD_EXAMPLE');
  const brief = options['--brief'] ? parseJson(readSelectedFile(options['--brief'])) : legacy
    ? snowCastleStandardBrief() : composedExampleBrief(options['--example']);
  if (options['--style-image']) brief.inputs.push({ role: 'style-reference', path: options['--style-image'] });
  const state = legacy ? initStandardReference(options['--out'], brief) : initComposedReference(options['--out'], brief);
  const bundle = previewStandardReference(options['--out'], join(options['--out'], 'design-preview'));
  console.log(JSON.stringify({ state, previewBundleSha256: bundle.sha256, generationCalls: 0 }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error.errors?.[0]?.code ?? 'STANDARD_OPERATION_FAILED' })); process.exitCode = 1;
}

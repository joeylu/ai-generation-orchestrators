/** Pin model-facing protocol bytes in finite evaluation plans, with portable paths only. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { harnessRoot } from './io.mjs';
import { digestBytes, digestJson } from './canonical.mjs';
export async function evaluationProtocolFingerprint() {
  const paths = ['src/codex-planner.mjs', 'src/panel-intent.mjs', 'prompts/panel-intent.md', 'prompts/panel-intent-v0.7.md', 'prompts/panel-intent-v0.7-quote-guard.md', 'prompts/panel-intent-v0.7-native-quotes.md', 'src/request-reading.mjs',
    'prompts/panel-intent-v0.8-request-refs.md', 'prompts/panel-intent-v0.8-text-labels.md', 'prompts/panel-intent-v0.8-panel-titles.md', 'src/literal-text-labels.mjs', 'src/codex-edit-schema.mjs', 'prompts/codex-panel-editor.md', 'src/planning-context.mjs', 'src/catalog.mjs'];
  const files = await Promise.all(paths.map(async path => ({ path, sha256: await digestBytes(await readFile(join(harnessRoot, path))) })));
  return { panelIntentVersion: '0.8', files, sha256: await digestJson(files) };
}

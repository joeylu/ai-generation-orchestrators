/** Pin model-facing protocol bytes in finite evaluation plans, with portable paths only. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { harnessRoot } from './io.mjs';
import { digestBytes, digestJson } from './canonical.mjs';
export async function evaluationProtocolFingerprint() {
  const paths = ['src/codex-planner.mjs', 'src/panel-intent.mjs', 'prompts/panel-intent.md', 'src/request-reading.mjs'];
  const files = await Promise.all(paths.map(async path => ({ path, sha256: await digestBytes(await readFile(join(harnessRoot, path))) })));
  return { panelIntentVersion: '0.3', files, sha256: await digestJson(files) };
}

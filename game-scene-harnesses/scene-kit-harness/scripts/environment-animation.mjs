import { fileURLToPath } from 'node:url';
import { createSceneCodexAdapter } from '../adapters/codex.mjs';
import { readSelectedFile } from '../src/files.mjs';
import { check } from '../src/generation/common.mjs';
import { readEnvironmentAnimationPlan } from '../src/generation/environment-animation-plan.mjs';
import { runEnvironmentAnimation } from '../src/generation/environment-animation-run.mjs';

const usage = 'node scripts/environment-animation.mjs inspect PLAN.zip | run PLAN.zip --confirm SHA256';
const [action, input, flag, confirmed, ...extra] = process.argv.slice(2);
try {
  check((action === 'inspect' && input && !flag) || (action === 'run' && input && flag === '--confirm' && confirmed && !extra.length), 'ANIMATION_CLI_USAGE');
  const archive = readSelectedFile(input, 17 * 1024 * 1024);
  if (action === 'inspect') {
    const { plan, archiveSha256 } = readEnvironmentAnimationPlan(archive);
    console.log(JSON.stringify({ plan, archiveSha256, imageCalls: 0 }, null, 2));
  } else {
    check(!process.env.OPENAI_API_KEY, 'CODEX_CHATGPT_LOGIN_ONLY');
    const root = fileURLToPath(new URL('../../../work/scene-kit-environment-animation/', import.meta.url));
    const result = await runEnvironmentAnimation({ archive, confirmed, root,
      createAdapter: workspace => createSceneCodexAdapter({ workspace }) });
    console.log(JSON.stringify(result));
    if (result.status !== 'pass') process.exitCode = 2;
  }
} catch (error) {
  console.error(JSON.stringify({ code: error.errors?.[0]?.code ?? 'ANIMATION_CLI_FAILURE', usage }));
  process.exitCode = 1;
}

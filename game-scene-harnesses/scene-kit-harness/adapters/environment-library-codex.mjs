import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSceneCodexAdapter } from './codex.mjs';
import { environmentContentFields } from '../src/generation/environment-library-plan.mjs';
import { CodexRpc } from '../../../game-ui-harnesses/ui-reference-harness/web/adapters/codex-rpc.mjs';
import { codexArgs } from '../../../game-ui-harnesses/ui-reference-harness/web/adapters/codex-cli.mjs';

export async function createEnvironmentLibraryAdapter({ workspace, executable = 'codex' }) {
  const images = await createSceneCodexAdapter({ workspace: join(workspace, 'images'), executable });
  const schema = {
    type: 'object',
    properties: Object.fromEntries(environmentContentFields.map(key => [key, { type: 'string' }])),
    required: environmentContentFields,
    additionalProperties: false,
  };
  return {
    preflight: () => images.preflight(),
    generate: input => images.generate(input),
    async interpretContent({ instruction, prompt, reference, attemptSha256 }) {
      const cwd = join(workspace, 'content', attemptSha256);
      mkdirSync(cwd, { recursive: true });
      const input = [{ type: 'text', text: JSON.stringify({ objectDescription: prompt }) }];
      if (reference) {
        const path = join(cwd, 'subject.png');
        writeFileSync(path, reference, { flag: 'wx' });
        input.push({ type: 'localImage', path });
      }
      const provider = 'scene_environment_content';
      const config = {
        model_provider: provider,
        approval_policy: 'never', sandbox_mode: 'read-only', web_search: 'disabled',
        'features.apps': false, 'features.shell_tool': false, 'features.unified_exec': false,
        'features.multi_agent': false, 'features.code_mode': false, 'features.image_generation': false,
        'features.hooks': false, 'features.unbounded_connection_retries': false,
        'hooks.PreToolUse': [], 'hooks.PostToolUse': [],
        [`model_providers.${provider}`]: {
          name: 'Scene Kit content extraction', requires_openai_auth: true, wire_api: 'responses',
          request_max_retries: 0, stream_max_retries: 0,
        },
      };
      // Keep only protocol categories in the private attempt directory.
      const evidence = entry => appendFileSync(join(cwd, 'protocol.jsonl'), JSON.stringify(entry) + '\n');
      let phase = 'initialize', threadId, timer, complete, fail;
      const final = new Promise((resolve, reject) => { complete = resolve; fail = reject; });
      final.catch(() => {});
      const messages = new Map();
      const rpc = new CodexRpc(executable, codexArgs(config), { cwd, onNotification({ method, params }) {
        if (params?.threadId && threadId && params.threadId !== threadId) return;
        const item = params?.item;
        if (['turn/started', 'turn/completed', 'error', 'adapter/closed', 'item/started'].includes(method)) {
          const info = (params?.error ?? params?.turn?.error)?.codexErrorInfo;
          const errorType = typeof info === 'string' ? info : Object.keys(info ?? {})[0];
          const httpStatus = info?.[errorType]?.httpStatusCode;
          evidence({ phase, event: method,
            ...(/^[a-zA-Z]{1,80}$/.test(item?.type ?? '') ? { itemType: item.type } : {}),
            ...(/^[a-zA-Z]{1,80}$/.test(errorType ?? '') ? { errorType } : {}),
            ...(Number.isInteger(httpStatus) ? { httpStatus } : {}),
            ...(method === 'turn/completed' ? { messages: messages.size, completed: params.turn?.status === 'completed' } : {}),
          });
        }
        if (method === 'adapter/closed' || method === 'error') fail(new Error('ENVIRONMENT_CONTENT_UNKNOWN'));
        if (method === 'item/started' && item && !['userMessage', 'reasoning', 'agentMessage'].includes(item.type)) {
          fail(new Error('ENVIRONMENT_CONTENT_TOOL_FORBIDDEN'));
          rpc.close();
        }
        if (method === 'item/completed' && item?.type === 'agentMessage' && item.phase !== 'commentary') messages.set(item.id, item.text);
        if (method === 'turn/completed') {
          const value = [...messages.values()][0];
          if (params.turn?.status !== 'completed' || messages.size !== 1 || typeof value !== 'string' || value.length > 8192)
            return fail(new Error('ENVIRONMENT_CONTENT_UNKNOWN'));
          try { complete(JSON.parse(value)); } catch { fail(new Error('ENVIRONMENT_CONTENT_INVALID')); }
        }
      } });
      try {
        timer = setTimeout(() => { fail(new Error('ENVIRONMENT_CONTENT_TIMEOUT')); rpc.close(); }, 180000);
        await rpc.initialize();
        phase = 'config/read';
        const effective = await rpc.request('config/read', { cwd, includeLayers: false });
        for (const key of Object.keys(effective.config?.mcp_servers ?? {})) config[`mcp_servers.${key}.enabled`] = false;
        for (const key of Object.keys(effective.config?.plugins ?? {})) config[`plugins.${key}.enabled`] = false;
        phase = 'thread/start';
        const thread = await rpc.request(phase, {
          cwd, ephemeral: true, modelProvider: provider, approvalPolicy: 'never', sandbox: 'read-only', config,
          developerInstructions: instruction + ' Do not use tools or read other files.',
        });
        threadId = thread.thread.id;
        phase = 'turn/start';
        await rpc.request(phase, { threadId, input, outputSchema: schema });
        phase = 'receive';
        return await final;
      } catch (error) {
        evidence({ phase, event: 'failed',
          ...(/^(CODEX|ENVIRONMENT)_[A-Z_]{1,70}$/.test(error.message) ? { code: error.message } : {}),
          ...(Number.isInteger(error.rpcCode) ? { rpcCode: error.rpcCode } : {}),
        });
        throw error;
      } finally {
        clearTimeout(timer);
        rpc.close();
      }
    },
  };
}

import { dirname, join } from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { check, digest, hash, seal } from '../src/generation/common.mjs';

// Read-only recovery inspection. It neither runs a CLI turn nor rewrites an
// unknown attempt. The public handoff excludes private transport/session data.
export async function inspectSceneCodexRecovery({ workspace, attemptSha256, planSha256, request,
  codexHome = process.env.CODEX_HOME || join(homedir(), '.codex') }) {
  check(typeof workspace === 'string' && /^[a-f0-9]{64}$/.test(attemptSha256)
    && /^[a-f0-9]{64}$/.test(planSha256), 'CODEX_RECOVERY_ARGUMENTS');
  const { loadRelayRequest } = await import('../../../game-ui-harnesses/ui-reference-harness/web/adapters/codex-relay-contract.mjs');
  const { findRelayLog, readRelayWindow, verifyRelayAudit, relayOutputs } = await import('../../../game-ui-harnesses/ui-reference-harness/web/adapters/codex-relay-session.mjs');
  const job = join(workspace, attemptSha256), read = name => JSON.parse(readFileSync(join(job, name)));
  const dispatch = read('dispatch.json'), session = read('session-result.json');
  const frozen = loadRelayRequest(job, dispatch.payloadSha256);
  check(dispatch.attemptSha256 === attemptSha256 && frozen.attemptSha256 === attemptSha256
    && dispatch.requestSha256 === digest(request) && frozen.requestSha256 === digest(request)
    && frozen.arguments.prompt === request.prompt
    && frozen.arguments.transparent_background === (request.output.alpha === 'transparent')
    && frozen.images.length === request.images.length
    && frozen.images.every((image, index) => image.sha256 === request.images[index].artifact.sha256), 'CODEX_RECOVERY_REQUEST_CHANGED');
  const audit = verifyRelayAudit(job, frozen, dispatch.payloadSha256, session.sessionId,
    readRelayWindow(findRelayLog(codexHome, session.sessionId)), { model: dispatch.model, effort: dispatch.effort });
  const outputs = readdirSync(job).filter(name => /^original-output-\d+\.png$/.test(name));
  check(outputs.length === 1 && session.automaticResubmissions === 0, 'CODEX_RECOVERY_OUTPUT_AMBIGUOUS');
  const bytes = readFileSync(join(job, outputs[0])), originals = relayOutputs(codexHome, session.sessionId);
  check(bytes.length <= 16777216 && originals.size === 1 && [...originals.values()][0] === hash(bytes)
    && audit.observedRelayCalls === 1 && audit.exactRelayProgram && audit.nestedImageGateVerified
    && audit.postImageGateVerified, 'CODEX_RECOVERY_EVIDENCE');
  return { bytes, handoff: seal({ format: 'ai_scene_completed_image_handoff_v1', sourcePlanSha256: planSha256,
    requestSha256: digest(request), rawSha256: hash(bytes), byteLength: bytes.length,
    inputSha256s: request.images.map(image => image.artifact.sha256), observedImageCalls: 1,
    exactArgumentsVerified: true, completedImageVerified: true, originalBytesPreserved: true }) };
}

// Optional local transport, deliberately outside the provider-neutral core.
// Reuse the audited at-most-once transports instead of copying their source.
export async function createSceneCodexAdapter({ workspace, executable = 'codex', nativeFactory, relayFactory } = {}) {
  const nativeDefault = !nativeFactory;
  const nativeModule = nativeDefault ? await import('../../../game-ui-harnesses/ui-reference-harness/web/adapters/codex-cli.mjs') : null;
  if (nativeDefault) nativeFactory = nativeModule.createCodexCliAdapter;
  if (!relayFactory) ({ createCodexCliRelayAdapter: relayFactory } = await import('../../../game-ui-harnesses/ui-reference-harness/web/adapters/codex-cli-relay.mjs'));
  check(typeof workspace === 'string' && workspace.length > 0, 'CODEX_WORKSPACE_REQUIRED');
  // One private root; each transport claims the unique attempt digest itself.
  // Its existing parent also allows read-only preflight before any job directory.
  let nativeTrust = null, rpcFactory;
  if (nativeDefault) {
    const { CodexRpc } = await import('../../../game-ui-harnesses/ui-reference-harness/web/adapters/codex-rpc.mjs');
    rpcFactory = (args, options) => new CodexRpc(executable,
      nativeTrust ? [...args, '-c', `hooks.state=${nativeModule.tomlValue(nativeTrust)}`] : args, options);
  }
  const native = nativeFactory({ executable, workspace, ...(rpcFactory ? { rpcFactory } : {}) });
  const opaque = relayFactory({ executable, workspace, transparentBackground: false });
  const transparent = relayFactory({ executable, workspace, transparentBackground: true });
  return {
    metadata: { name: 'Scene Kit local Codex image adapter', automaticRetry: false },
    async preflight() {
      if (nativeDefault && !nativeTrust) {
        // Same two adapter-owned hook definitions as the existing native
        // transport, trusted only by invocation flags, never global settings.
        const { trustRelayHooks } = await import('../../../game-ui-harnesses/ui-reference-harness/web/adapters/codex-relay-trust.mjs');
        const trusted = await trustRelayHooks(nativeModule.codexLaunchConfig(), existsSync(workspace) ? workspace : dirname(workspace), rpcFactory, nativeModule.codexArgs);
        nativeTrust = trusted['hooks.state'];
      }
      await native.preflight(); await opaque.preflight(); await transparent.preflight();
    },
    async generate(input) {
      const images = input.images.map(image => ({ role: image.role, sha256: image.artifact.sha256, bytes: image.bytes }));
      images.forEach(image => check(hash(image.bytes) === image.sha256, 'CODEX_REFERENCE_CHANGED'));
      const alpha = input.request.output.alpha;
      check(['opaque', 'transparent'].includes(alpha), 'CODEX_ALPHA_POLICY');
      check(alpha !== 'transparent' || images.length > 0, 'CODEX_TRANSPARENT_REFERENCE_REQUIRED');
      const transport = alpha === 'transparent' ? transparent : images.length ? opaque : native;
      // Transport selected before any dispatch. Never fall back on an error.
      return transport.generate({ prompt: input.request.prompt, requestSha256: input.requestSha256,
        attemptSha256: input.attemptSha256, images });
    },
  };
}

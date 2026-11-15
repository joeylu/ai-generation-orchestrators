import { lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFreshDirectory } from '../files.mjs';
import { check, digest, hash, jsonBytes, seal } from './common.mjs';
import { validateEnvironmentAnimationAtlas } from './environment-animation-atlas.mjs';
import { readEnvironmentAnimationPlan } from './environment-animation-plan.mjs';

export async function runEnvironmentAnimation({ archive, confirmed, root, adapterWorkspace, createAdapter }) {
  const { plan, reference } = readEnvironmentAnimationPlan(archive);
  check(confirmed === plan.sha256, 'CONFIRMATION_MISMATCH');
  const workspace = resolve(root);
  mkdirSync(workspace, { recursive: true });
  const run = makeFreshDirectory(join(workspace, plan.sha256), fileURLToPath(new URL('../../', import.meta.url)));
  const write = (name, bytes) => writeFileSync(join(run, name), bytes, { flag: 'wx', flush: true });
  write('input.zip', archive);
  const privateRoot = adapterWorkspace ?? join(run, 'private-adapter');
  mkdirSync(privateRoot, { recursive: Boolean(adapterWorkspace) });
  check(lstatSync(privateRoot).isDirectory(), 'ANIMATION_ADAPTER_WORKSPACE');
  const adapter = await createAdapter(privateRoot);
  await adapter.preflight?.();
  const authorization = seal({ planSha256: confirmed, decision: 'approve-compute' });
  write('authorization.json', jsonBytes(authorization));
  const requestSha256 = digest(plan.request);
  const reservation = seal({ planSha256: confirmed, requestSha256, authorizationSha256: authorization.sha256, state: 'reserved' });
  write('reservation.json', jsonBytes(reservation));
  let raw;
  try {
    raw = await adapter.generate({ request: plan.request, requestSha256, attemptSha256: reservation.sha256,
      images: [{ ...plan.request.images[0], bytes: reference }] });
    check(Buffer.isBuffer(raw) && raw.length > 0 && raw.length <= 16777216, 'ANIMATION_ATLAS_BYTES');
  } catch {
    const result = seal({ reservationSha256: reservation.sha256, state: 'unknown', automaticRetry: false });
    write('result.json', jsonBytes(result));
    return { result, status: 'unknown', issues: ['ANIMATION_GENERATION_UNKNOWN'] };
  }
  write('raw.png', raw);
  const result = seal({ reservationSha256: reservation.sha256, state: 'received', rawSha256: hash(raw), byteLength: raw.length });
  write('result.json', jsonBytes(result));
  const { columns, rows } = plan.input;
  const format = 'ai_scene_environment_animation_atlas_structure_v1';
  let report;
  try {
    const atlas = validateEnvironmentAnimationAtlas(raw, { columns, rows });
    report = seal({ format, ...atlas, status: 'pass', issues: [] });
  } catch (error) {
    report = seal({ format, rawSha256: result.rawSha256, status: 'fail',
      issues: [error.errors?.[0]?.code ?? 'ANIMATION_PNG_INVALID'] });
  }
  write('atlas-qa.json', jsonBytes(report));
  return { result, status: report.status, issues: report.issues,
    ...(report.status === 'pass' ? { humanVisualAcceptance: 'pending' } : {}) };
}

import { existsSync, linkSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { check, hash, isDigest, jsonBytes, seal, unseal } from './common.mjs';
import { readEnvironmentAnimationPlan } from './environment-animation-plan.mjs';
import { runEnvironmentAnimation } from './environment-animation-run.mjs';

const archiveLimit = 17 * 1024 * 1024;
function readBytes(path, limit) {
  const stat = lstatSync(path);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.size <= limit, 'ANIMATION_EXCHANGE_FILE');
  return readFileSync(path);
}
function readRecord(path) {
  if (!existsSync(path)) return null;
  const record = JSON.parse(readBytes(path, 32768));
  unseal(record);
  return record;
}
function publish(path, record, exclusive = false) {
  const temp = path + '.' + randomUUID() + '.tmp';
  writeFileSync(temp, jsonBytes(seal(record)), { flag: 'wx', flush: true });
  if (!exclusive) { renameSync(temp, path); return; }
  try { linkSync(temp, path); } finally { unlinkSync(temp); }
}
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

export function openEnvironmentAnimationExchange(directory) {
  const selected = resolve(directory);
  mkdirSync(selected, { recursive: true });
  check(!lstatSync(selected).isSymbolicLink(), 'ANIMATION_EXCHANGE_FILE');
  const root = realpathSync(selected), runs = join(root, 'runs');
  const currentPath = join(root, 'current.json'), workerPath = join(root, 'worker.json');
  const worker = () => {
    const record = readRecord(workerPath);
    return record && alive(record.pid) ? record : null;
  };
  function job(sha256) {
    check(isDigest(sha256), 'ANIMATION_PLAN_CHANGED');
    const path = join(root, sha256), stat = lstatSync(path);
    check(stat.isDirectory() && !stat.isSymbolicLink(), 'ANIMATION_EXCHANGE_FILE');
    return path;
  }
  function current() {
    const pointer = readRecord(currentPath);
    if (!pointer) return null;
    const path = job(pointer.planSha256), record = name => readRecord(join(path, name + '.json'));
    const decision = record('decision'), claim = record('claim'), result = record('completion');
    check(decision?.planSha256 === pointer.planSha256 && (!claim || claim.decisionSha256 === decision.sha256)
      && (!result || result.claimSha256 === claim?.sha256), 'ANIMATION_EXCHANGE_BINDING');
    const status = result?.status ?? (claim ? (alive(claim.pid) ? 'running' : 'unknown')
      : worker()?.id === decision.workerId ? 'ready' : 'unknown');
    return { path, decision, claim, result, status };
  }
  function publicView(item) {
    if (!item) return null;
    const { planSha256, assetId, input } = item.decision;
    return { planSha256, assetId, input, status: item.status, issues: item.result?.issues ?? [] };
  }
  return {
    available: () => Boolean(worker()),
    registerWorker() {
      check(!worker(), 'ANIMATION_WORKER_ACTIVE');
      const id = randomUUID();
      publish(workerPath, { id, pid: process.pid });
      return id;
    },
    submit(archive, confirmed) {
      const { plan, archiveSha256 } = readEnvironmentAnimationPlan(archive);
      check(plan.sha256 === confirmed, 'ANIMATION_PLAN_CHANGED');
      const previous = current();
      if (previous?.decision.planSha256 === confirmed) return publicView(previous);
      const activeWorker = worker();
      check(activeWorker, 'ANIMATION_WORKER_OFFLINE');
      check(!previous || !['ready', 'running'].includes(previous.status), 'ANIMATION_OPERATION_ACTIVE');
      const path = join(root, confirmed);
      check(!existsSync(path), 'ANIMATION_PLAN_USED');
      mkdirSync(path);
      writeFileSync(join(path, 'input.zip'), archive, { flag: 'wx', flush: true });
      publish(join(path, 'decision.json'), { planSha256: confirmed, archiveSha256, projectId: plan.projectId,
        kitSha256: plan.kitSha256, assetId: plan.assetId, input: plan.input, workerId: activeWorker.id, decision: 'approve-compute' }, true);
      publish(currentPath, { planSha256: confirmed });
      return publicView(current());
    },
    get(projectId, kitSha256) {
      const item = current();
      return item?.decision.projectId === projectId && item.decision.kitSha256 === kitSha256 ? publicView(item) : null;
    },
    preview(projectId, kitSha256, sha256) {
      const item = current();
      check(item?.decision.projectId === projectId && item.decision.kitSha256 === kitSha256 && item.decision.planSha256 === sha256
        && item.status === 'pass', 'ANIMATION_RESULT_UNAVAILABLE');
      const bytes = readBytes(join(runs, sha256, 'raw.png'), 16777216);
      check(hash(bytes) === item.result.rawSha256, 'ANIMATION_EXCHANGE_BINDING');
      return bytes;
    },
    async dispatch(workerId, createAdapter) {
      const item = current();
      if (item?.status !== 'ready' || item.decision.workerId !== workerId) return false;
      const { path, decision } = item, claimPath = join(path, 'claim.json');
      try { publish(claimPath, { decisionSha256: decision.sha256, pid: process.pid }, true); }
      catch (error) { if (error.code === 'EEXIST') return false; throw error; }
      const claim = readRecord(claimPath);
      let completion;
      try {
        const archive = readBytes(join(path, 'input.zip'), archiveLimit);
        check(hash(archive) === decision.archiveSha256, 'ANIMATION_EXCHANGE_BINDING');
        // The adapter already isolates its files by reservation digest. Keep
        // that directory beside runs to avoid nesting two digests in its cwd.
        const { result, status, issues } = await runEnvironmentAnimation({
          archive, confirmed: decision.planSha256, root: runs, adapterWorkspace: join(root, 'adapter'), createAdapter,
        });
        completion = { status, issues, rawSha256: result.rawSha256 ?? null };
      } catch (error) {
        completion = error.message === 'CODEX_WORKSPACE_PATH_TOO_LONG'
          ? { status: 'blocked', issues: ['CODEX_WORKSPACE_PATH_TOO_LONG'], rawSha256: null }
          : { status: 'unknown', issues: ['ANIMATION_GENERATION_UNKNOWN'], rawSha256: null };
      }
      publish(join(path, 'completion.json'), { claimSha256: claim.sha256, ...completion }, true);
      return true;
    },
  };
}

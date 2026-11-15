import { closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { check, digest, hash, imageRef, isDigest, jsonBytes, seal, text, unseal } from './common.mjs';
import { environmentLibraryRoles } from '../environment-library-roles.mjs';
import { assessEnvironmentLibraryOutput, compileEnvironmentLibraryPlan, environmentContentInstruction, environmentContentPolicy, environmentPngLimit, isEnvironmentLibraryMarginOnly, subjectImage, validateEnvironmentStyle } from './environment-library-plan.mjs';

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const jsonLimit = 32768;
const dispatchDeadlineMs = 30 * 60 * 1000;
const terminal = new Set(['candidate', 'added', 'import-failed', 'rejected', 'indeterminate']);
const automaticFlow = 'generate-and-add-v1';

function regular(path, limit) {
  const stat = lstatSync(path);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.size <= limit, 'ENVIRONMENT_EXCHANGE_FILE');
  return readFileSync(path);
}
function fresh(path, bytes) {
  const fd = openSync(path, 'wx');
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}
function publish(path, record) {
  const temp = path + '.' + randomUUID() + '.tmp';
  fresh(temp, jsonBytes(record));
  renameSync(temp, path);
}
function reserve(path, record) {
  const temp = path + '.' + randomUUID() + '.tmp';
  fresh(temp, jsonBytes(record));
  try { linkSync(temp, path); } finally { unlinkSync(temp); }
}
function live(reservation) {
  if (Date.now() >= reservation.deadline) return false;
  try { process.kill(reservation.pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

// Private on-disk exchange. Studio writes frozen records and decisions only.
// The separate CLI worker reads them and dispatches startup-selected adapters.
export function openEnvironmentLibraryExchange(root) {
  root = resolve(root);
  mkdirSync(root, { recursive: true });
  check(!lstatSync(root).isSymbolicLink(), 'ENVIRONMENT_EXCHANGE_PATH');
  root = realpathSync(root);
  const currentPath = join(root, 'current.json');
  const read = path => {
    if (!existsSync(path)) return null;
    const record = JSON.parse(regular(path, jsonLimit));
    unseal(record);
    return record;
  };
  const current = () => read(currentPath)?.jobId ?? null;
  const job = jobId => {
    check(uuid.test(jobId), 'ENVIRONMENT_JOB_ID');
    const path = join(root, jobId);
    const stat = lstatSync(path);
    check(stat.isDirectory() && !stat.isSymbolicLink(), 'ENVIRONMENT_EXCHANGE_PATH');
    return path;
  };
  function snapshot(jobId) {
    const path = job(jobId), record = name => read(join(path, name + '.json'));
    const brief = record('brief'), plan = record('plan'), originalResult = record('result'), recheck = record('edge-recheck');
    check(!recheck || (recheck.format === 'ai_scene_environment_library_edge_recheck_v1'
      && originalResult && !originalResult.sprite && recheck.originalResultSha256 === originalResult.sha256
      && recheck.planSha256 === originalResult.planSha256 && recheck.attemptSha256 === originalResult.attemptSha256
      && recheck.qa.strictQaSha256 === originalResult.qa.sha256 && recheck.sprite), 'ENVIRONMENT_EXCHANGE_BINDING');
    const result = recheck ?? originalResult;
    const automatic = brief?.flow === automaticFlow;
    const added = record('automatic-add');
    check(!added || (automatic && result?.sprite && added.resultSha256 === result.sha256
      && ['added', 'import-failed'].includes(added.status)), 'ENVIRONMENT_EXCHANGE_BINDING');
    check(brief?.jobId === jobId && (brief.placementRole === undefined || environmentLibraryRoles.includes(brief.placementRole))
      && (!plan || (plan.briefSha256 === brief.sha256 && plan.placementRole === brief.placementRole))
      && (!result || result.planSha256 === plan?.sha256), 'ENVIRONMENT_EXCHANGE_BINDING');
    const stage = plan ? 'image' : 'content';
    const authorization = record(stage + '-authorization');
    const reservation = record(stage + '-reservation'), failure = record('failure');
    const target = plan?.sha256 ?? brief.sha256;
    check((!authorization || (authorization.targetSha256 === target && (!automatic || authorization.flow === automaticFlow)))
      && (!reservation || (reservation.authorizationSha256 === authorization?.sha256 && reservation.targetSha256 === target))
      && (!result || result.attemptSha256 === reservation?.sha256), 'ENVIRONMENT_EXCHANGE_BINDING');
    const status = failure ? failure.status : result ? (result.sprite ? added?.status ?? 'candidate' : 'rejected') : reservation
      ? (live(reservation) ? stage + '-running' : 'indeterminate')
      : authorization ? stage + '-ready' : plan ? 'review-plan' : 'review-input';
    return { jobId, path, brief, plan, result, target, status, failure, recheck, automatic, added };
  }
  function scope(item, projectId) {
    check(item.brief.projectId === projectId, 'ENVIRONMENT_PROJECT_CHANGED');
    return item;
  }
  function view(item) {
    if (!item) return null;
    const { jobId, brief, plan, result, status } = item;
    return {
      jobId, status, prompt: brief.prompt, reference: brief.reference, styleName: brief.style.name,
      briefSha256: brief.sha256,
      ...(brief.placementRole !== undefined ? { placementRole: brief.placementRole } : {}),
      ...(item.automatic ? { automatic: true } : {}),
      ...(item.added?.issue ? { importIssue: item.added.issue } : {}),
      ...(plan ? { planSha256: plan.sha256, content: plan.content, renderPrompt: plan.request.prompt,
        styleAnchorSha256: plan.request.images[0].artifact.sha256 } : {}),
      ...(result ? { issues: result.qa.issues, sprite: result.sprite } : {}),
      ...(status === 'rejected' && isEnvironmentLibraryMarginOnly(result?.qa) ? { canRecheckMargin: true } : {}),
      ...(item.failure?.issues ? { issues: item.failure.issues } : {}),
    };
  }
  function replay(item) {
    const anchor = regular(join(item.path, 'style.png'), environmentPngLimit);
    check(hash(anchor) === item.brief.style.anchorSha256, 'ENVIRONMENT_STYLE_BINDING');
    if (item.plan) check(compileEnvironmentLibraryPlan(item.brief, item.plan.content, anchor).sha256 === item.plan.sha256,
      'ENVIRONMENT_EXCHANGE_BINDING');
    return anchor;
  }
  function candidate(item, expected) {
    check(['candidate', 'added', 'import-failed'].includes(item.status) && expected === item.result.sprite.sha256, 'ENVIRONMENT_CANDIDATE_CHANGED');
    replay(item);
    const raw = regular(join(item.path, 'raw.png'), environmentPngLimit);
    const { qa, sprite } = assessEnvironmentLibraryOutput(item.plan, raw);
    const bytes = regular(join(item.path, 'sprite.png'), environmentPngLimit);
    check(qa.sha256 === item.result.qa.sha256 && sprite && bytes.equals(sprite)
      && digest(imageRef(bytes)) === digest(item.result.sprite), 'ENVIRONMENT_EXCHANGE_BINDING');
    return bytes;
  }
  return {
    get(projectId) {
      const jobId = current();
      if (!jobId) return null;
      const item = snapshot(jobId);
      return item.brief.projectId === projectId ? view(item) : null;
    },
    create({ projectId, kitSha256, style, anchor, prompt, reference, placementRole, automatic = false }) {
      const currentId = current();
      if (currentId) {
        const previous = snapshot(currentId);
        check(terminal.has(previous.status) && !(previous.automatic && previous.status === 'candidate'), 'ENVIRONMENT_OPERATION_ACTIVE');
      }
      check(readdirSync(root).filter(name => uuid.test(name)).length < 64, 'ENVIRONMENT_EXCHANGE_LIMIT');
      check(uuid.test(projectId) && isDigest(kitSha256), 'ENVIRONMENT_PROJECT_CHANGED');
      check(placementRole === undefined || environmentLibraryRoles.includes(placementRole), 'ENVIRONMENT_PLACEMENT_ROLE');
      validateEnvironmentStyle(style);
      text(prompt, { empty: true, limit: 1200 });
      check(prompt.trim() || reference, 'ENVIRONMENT_SUBJECT_REQUIRED');
      check(hash(anchor) === style.anchorSha256, 'ENVIRONMENT_STYLE_BINDING');
      const jobId = randomUUID(), path = join(root, jobId);
      const brief = seal({
        format: 'ai_scene_environment_library_brief_v1', jobId, projectId, kitSha256, style,
        contentPolicy: environmentContentPolicy,
        instruction: environmentContentInstruction, prompt, reference: reference ? subjectImage(reference) : null,
        ...(placementRole !== undefined ? { placementRole } : {}),
        ...(automatic ? { flow: automaticFlow } : {}),
      });
      mkdirSync(path);
      fresh(join(path, 'style.png'), anchor);
      if (reference) fresh(join(path, 'reference.png'), reference);
      publish(join(path, 'brief.json'), brief);
      if (automatic) reserve(join(path, 'content-authorization.json'), seal({
        format: 'ai_scene_environment_library_authorization_v1', stage: 'content',
        targetSha256: brief.sha256, flow: automaticFlow,
      }));
      publish(currentPath, seal({ jobId }));
      return view(snapshot(jobId));
    },
    authorize({ projectId, kitSha256, style, jobId, targetSha256 }) {
      check(jobId === current(), 'ENVIRONMENT_JOB_CHANGED');
      const item = scope(snapshot(jobId), projectId);
      check(!item.automatic && item.brief.kitSha256 === kitSha256 && digest(item.brief.style) === digest(style) && item.target === targetSha256
        && ['review-input', 'review-plan'].includes(item.status), 'ENVIRONMENT_PLAN_CHANGED');
      const stage = item.plan ? 'image' : 'content';
      publish(join(item.path, stage + '-authorization.json'), seal({
        format: 'ai_scene_environment_library_authorization_v1', stage, targetSha256,
      }));
      return view(snapshot(jobId));
    },
    settleAutomatic(addToProject) {
      const jobId = current();
      if (!jobId) return;
      const item = snapshot(jobId);
      if (!item.automatic || item.status !== 'candidate') return;
      const { sprite } = item.result;
      let status = 'added', issue;
      try {
        const bytes = candidate(item, sprite.sha256);
        addToProject({ jobId, projectId: item.brief.projectId, kitSha256: item.brief.kitSha256,
          prompt: item.brief.prompt, placementRole: item.brief.placementRole, sprite, bytes });
      } catch (error) {
        status = 'import-failed';
        const code = error.errors?.[0]?.code ?? error.code;
        issue = typeof code === 'string' && /^[A-Z_]{1,80}$/.test(code) ? code : 'ENVIRONMENT_IMPORT_FAILED';
      }
      publish(join(item.path, 'automatic-add.json'), seal({
        format: 'ai_scene_environment_library_automatic_add_v1', resultSha256: item.result.sha256,
        status, ...(issue ? { issue } : {}),
      }));
    },
    abandon(projectId, jobId) {
      check(jobId === current(), 'ENVIRONMENT_JOB_CHANGED');
      const item = scope(snapshot(jobId), projectId);
      check(['review-input', 'review-plan'].includes(item.status), 'ENVIRONMENT_OPERATION_ACTIVE');
      publish(join(item.path, 'failure.json'), seal({ status: 'rejected', decision: 'cancelled-by-user' }));
      return view(snapshot(jobId));
    },
    recheckMargin({ projectId, kitSha256, jobId }) {
      check(jobId === current(), 'ENVIRONMENT_JOB_CHANGED');
      const item = scope(snapshot(jobId), projectId);
      check(item.brief.kitSha256 === kitSha256, 'ENVIRONMENT_KIT_CHANGED');
      if (item.recheck) return view(item);
      check(item.status === 'rejected' && isEnvironmentLibraryMarginOnly(item.result?.qa), 'ENVIRONMENT_MARGIN_RECHECK_UNAVAILABLE');
      replay(item);
      const raw = regular(join(item.path, 'raw.png'), environmentPngLimit);
      check(hash(raw) === item.result.qa.rawSha256, 'ENVIRONMENT_EXCHANGE_BINDING');
      const { qa, sprite } = assessEnvironmentLibraryOutput(item.plan, raw);
      check(sprite && qa.strictQaSha256 === item.result.qa.sha256, 'ENVIRONMENT_MARGIN_RECHECK_UNAVAILABLE');
      const spritePath = join(item.path, 'sprite.png');
      if (existsSync(spritePath)) check(regular(spritePath, environmentPngLimit).equals(sprite), 'ENVIRONMENT_EXCHANGE_BINDING');
      else fresh(spritePath, sprite);
      publish(join(item.path, 'edge-recheck.json'), seal({
        format: 'ai_scene_environment_library_edge_recheck_v1', originalResultSha256: item.result.sha256, planSha256: item.plan.sha256,
        attemptSha256: item.result.attemptSha256, qa, sprite: imageRef(sprite),
      }));
      return view(snapshot(jobId));
    },
    preview(projectId, jobId, spriteSha256) {
      return candidate(scope(snapshot(jobId), projectId), spriteSha256);
    },
    accept({ projectId, jobId, spriteSha256 }) {
      check(jobId === current(), 'ENVIRONMENT_JOB_CHANGED');
      const item = scope(snapshot(jobId), projectId), bytes = candidate(item, spriteSha256);
      check(item.status === 'candidate' && !item.automatic, 'ENVIRONMENT_CANDIDATE_CHANGED');
      const path = join(item.path, 'visual-review.json');
      const review = seal({ format: 'ai_scene_environment_library_visual_review_v1', projectId, spriteSha256,
        planSha256: item.plan.sha256, decision: 'accept-for-library' });
      const previous = read(path);
      if (previous) check(previous.sha256 === review.sha256, 'ENVIRONMENT_CANDIDATE_CHANGED');
      else publish(path, review);
      return { jobId, projectId, kitSha256: item.brief.kitSha256, prompt: item.brief.prompt,
        placementRole: item.brief.placementRole, bytes, sprite: item.result.sprite };
    },
    async dispatch(adapter) {
      const jobId = current();
      if (!jobId) return false;
      const item = snapshot(jobId);
      if (item.automatic && item.status === 'review-plan') {
        const contentAuth = read(join(item.path, 'content-authorization.json'));
        const contentAttempt = read(join(item.path, 'content-reservation.json'));
        check(contentAuth?.flow === automaticFlow && contentAuth.targetSha256 === item.brief.sha256
          && contentAttempt?.authorizationSha256 === contentAuth.sha256, 'ENVIRONMENT_EXCHANGE_BINDING');
        replay(item);
        try {
          reserve(join(item.path, 'image-authorization.json'), seal({
            format: 'ai_scene_environment_library_authorization_v1', stage: 'image',
            targetSha256: item.plan.sha256, flow: automaticFlow,
          }));
        } catch (error) { if (error.code !== 'EEXIST') throw error; }
        return true;
      }
      if (!['content-ready', 'image-ready'].includes(item.status)) return false;
      const stage = item.plan ? 'image' : 'content', file = name => join(item.path, name);
      const authorization = read(file(stage + '-authorization.json'));
      const anchor = replay(item);
      const ref = item.brief.reference, reference = ref ? regular(file('reference.png'), environmentPngLimit) : null;
      if (ref) check(digest(subjectImage(reference)) === digest(ref), 'ENVIRONMENT_REFERENCE_CHANGED');
      const reservation = seal({ format: 'ai_scene_environment_library_reservation_v1',
        authorizationSha256: authorization.sha256, jobId, targetSha256: item.target, stage,
        pid: process.pid, deadline: Date.now() + dispatchDeadlineMs,
      });
      try { reserve(file(stage + '-reservation.json'), reservation); }
      catch (error) { if (error.code === 'EEXIST') return false; throw error; }
      try {
        if (stage === 'content') {
          const content = await adapter.interpretContent({
            instruction: item.brief.instruction, prompt: item.brief.prompt, reference,
            planSha256: item.target, attemptSha256: reservation.sha256,
          });
          check(live(reservation), 'ENVIRONMENT_DISPATCH_EXPIRED');
          let plan;
          try { plan = compileEnvironmentLibraryPlan(item.brief, content, anchor); }
          catch (error) {
            if (!error.errors) throw error;
            publish(file('failure.json'), seal({ status: 'rejected', stage: 'content', reservationSha256: reservation.sha256,
              issues: error.errors.map(issue => issue.code) }));
            return true;
          }
          publish(file('plan.json'), plan);
        } else {
          const { request } = item.plan;
          const output = await adapter.generate({
            request, requestSha256: digest(request), attemptSha256: reservation.sha256,
            images: request.images.map(image => ({ ...image, bytes: anchor })),
          });
          if (!(output instanceof Uint8Array) || output.length === 0 || output.length > environmentPngLimit) {
            publish(file('failure.json'), seal({ status: 'rejected', reservationSha256: reservation.sha256,
              issues: ['ENVIRONMENT_OUTPUT_BYTES'] }));
            return true;
          }
          const bytes = Buffer.from(output);
          fresh(file('raw.png'), bytes);
          check(live(reservation), 'ENVIRONMENT_DISPATCH_EXPIRED');
          const { qa, sprite } = assessEnvironmentLibraryOutput(item.plan, bytes);
          if (sprite) fresh(file('sprite.png'), sprite);
          publish(file('result.json'), seal({ planSha256: item.plan.sha256, attemptSha256: reservation.sha256,
            qa, sprite: sprite ? imageRef(sprite) : null }));
        }
      } catch {
        // Adapter exceptions can occur after acceptance. Never submit again.
        publish(file('failure.json'), seal({ status: 'indeterminate', reservationSha256: reservation.sha256 }));
      }
      return true;
    },
  };
}

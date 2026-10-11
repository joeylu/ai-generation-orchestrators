import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { atomicJson, canonical, digestJson, exact, isDigest, isId, local, readJson, requireThat, seal, sha256, textValue, unseal, validationScope, withLock, writeJsonNew } from './common.mjs';
import { loadProject, projectStatus } from './project.mjs';
import { loadStyle, primaryStyleReference } from './styles.mjs';
import { loadPrototype } from './panel.mjs';
import { createPlan, createRevisionPlan, runtimeDigest, validateIntent, verifyPlan } from './compiler.mjs';
import { authorize, finish, generateWithAdapter, inspectRun, receive, reserve, reviewRun, stopAttempt, verifyResult, verifyReview } from './generation.mjs';
import { exportProject, validateDelivery } from './output.mjs';
import { resolutionPolicy } from './resolution.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const RUN = /^runs\/[a-f0-9-]{36}$/;
const TERMINAL = ['failed', 'indeterminate', 'rejected_technical'];
const TURN = ['prepare', 'revise', 'retry'];
const ACTIONS = [...TURN, 'authorize', 'generate', 'request', 'receive', 'finish', 'stop', 'review', 'export'];
const stages = ['plan', 'generation', 'raw-qa', 'post-process', 'post-qa', 'visual-review'];
const panelNode = (id, stage) => `panel/${id}/${stage}`;

function primaryTopology(panels) {
  const nodes = topology(panels, null, true).filter(node => node.id !== 'anchor');
  nodes.splice(1, 0, { id: 'primary-reference', type: 'confirmed-primary-style', panelId: null, dependsOn: ['inputs'] });
  for (const node of nodes) node.dependsOn = node.dependsOn.map(id => id === 'anchor' ? 'primary-reference' : id);
  return nodes;
}
function topology(panels, anchorPanelId, initialAnchor) {
  const nodes = [{ id: 'inputs', type: 'frozen-project-inputs', panelId: null, dependsOn: [] }];
  for (const panel of panels) {
    let previous = initialAnchor || panel.panelId !== anchorPanelId ? 'anchor' : 'inputs';
    for (const stage of stages) {
      const id = panelNode(panel.panelId, stage);
      nodes.push({ id, type: stage, panelId: panel.panelId, dependsOn: [previous] });
      previous = id;
    }
    // Export selects the latest accepted image, as Studio does, even if a newer
    // revision is still being reviewed. Its evidence is independent of that turn.
    nodes.push({ id: panelNode(panel.panelId, 'accepted'), type: 'accepted-selection', panelId: panel.panelId, dependsOn: ['inputs'] });
  }
  nodes.push({ id: 'anchor', type: 'accepted-project-anchor', panelId: anchorPanelId,
    dependsOn: initialAnchor ? ['inputs'] : [panelNode(anchorPanelId, 'visual-review')] });
  nodes.push({ id: 'output', type: 'verified-project-delivery', panelId: null,
    dependsOn: panels.map(panel => panelNode(panel.panelId, 'accepted')) });
  return nodes;
}
function verifyGraph(nodes) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  requireThat(byId.size === nodes.length, 'DAG_DUPLICATE_NODE');
  const active = new Set(), done = new Set();
  function visit(id) {
    requireThat(byId.has(id) && !active.has(id), 'DAG_CYCLE_OR_MISSING_DEPENDENCY');
    if (done.has(id)) return;
    active.add(id); byId.get(id).dependsOn.forEach(visit); active.delete(id); done.add(id);
  }
  nodes.forEach(node => visit(node.id));
}
function anchorEvidence(root, project, styleSha256) {
  const anchor = project.baselines[styleSha256];
  if (!anchor) return null;
  const result = verifyResult(root, anchor.run), review = verifyReview(root, anchor.run, result);
  requireThat(review.decision === 'accept' && review.useAsAnchor && result.plan.styleSha256 === styleSha256
    && result.plan.sha256 === anchor.planSha256 && review.sha256 === anchor.reviewSha256
    && result.technical.imageSha256 === anchor.image.sha256, 'DAG_ANCHOR_INVALID');
  return { panelId: result.plan.panelId, run: anchor.run, planSha256: anchor.planSha256,
    reviewSha256: anchor.reviewSha256, imageSha256: anchor.image.sha256 };
}

export function createProjectDag(root, { anchorPanelId = null, panelIds = null, intents = [], resolution = 'native' } = {}) {
  return withLock(root, () => {
    const project = loadProject(root); requireThat(project.activeStyle, 'PROJECT_STYLE_REQUIRED');
    resolutionPolicy(resolution);
    const selected = panelIds ?? Object.keys(project.panels);
    requireThat(Array.isArray(selected) && selected.length > 0 && selected.length <= 64
      && new Set(selected).size === selected.length && selected.every(id => isId(id) && Object.hasOwn(project.panels, id)), 'DAG_PANEL_SELECTION');
    requireThat(Array.isArray(intents) && intents.every(intent => selected.includes(intent?.panelId))
      && new Set(intents.map(intent => intent.panelId)).size === intents.length, 'DAG_INTENTS');
    // Legacy representative selection is accepted as an inert compatibility input.
    // It cannot select or replace the confirmed project primary reference.
    requireThat(anchorPanelId === null || selected.includes(anchorPanelId), 'DAG_PANEL_SELECTION');
    const primaryReference = primaryStyleReference(root, project.activeStyle);
    anchorPanelId = null; const initialAnchor = null;
    const status = projectStatus(root);
    const panels = selected.map(panelId => {
      const prototype = project.panels[panelId].prototype;
      const accepted = status.panels.find(item => item.panelId === panelId);
      // The representative panel needs a fresh explicit anchor choice unless a
      // same-style anchor already exists. Never promote a prior accepted image.
      const adoptedRun = accepted.status === 'accepted_current_style' ? accepted.acceptedRun : null;
      const previousIntent = adoptedRun ? verifyPlan(root, adoptedRun, { allowLegacy: true }).intent : null;
      const intent = intents.find(item => item.panelId === panelId) ?? previousIntent ?? { kind: 'ui_reference_intent_v1', panelId, note: '', emphasisIds: [] };
      validateIntent(intent, loadPrototype(root, prototype));
      requireThat(!previousIntent || canonical(previousIntent) === canonical(intent), 'DAG_ADOPTED_INTENT_CHANGED');
      return { panelId, prototype, intent, adoptedRun };
    });
    const definition = seal({ kind: 'ui_reference_project_dag_v2', id: randomUUID(), projectId: project.id,
      runtimeSha256: runtimeDigest(), styleSha256: project.activeStyle, selection: panelIds === null ? 'all-registered' : 'explicit-subset',
      resolution, anchorPanelId, initialAnchor, primaryReference, maximumRevisions: 3, panels, nodes: primaryTopology(panels) });
    verifyGraph(definition.nodes);
    const dag = `dags/${definition.id}/dag.json`; writeJsonNew(root, dag, definition);
    return { dag, dagSha256: definition.sha256, computeCalls: 0, ...inspectProjectDag(root, dag) };
  });
}

function readDefinition(root, dag) {
  requireThat(typeof dag === 'string' && /^dags\/[a-f0-9-]{36}\/dag\.json$/.test(dag), 'DAG_PATH_INVALID');
  const definition = readJson(local(root, dag)); unseal(definition);
  const primaryPolicy = definition.kind === 'ui_reference_project_dag_v2';
  exact(definition, ['kind', 'id', 'projectId', 'runtimeSha256', 'styleSha256', 'selection', 'resolution', 'anchorPanelId', 'initialAnchor', 'maximumRevisions', 'panels', 'nodes', 'sha256', ...(primaryPolicy ? ['primaryReference'] : [])]);
  requireThat((primaryPolicy || definition.kind === 'ui_reference_project_dag_v1') && UUID.test(definition.id)
    && dag === `dags/${definition.id}/dag.json` && isId(definition.projectId) && isDigest(definition.runtimeSha256)
    && isDigest(definition.styleSha256) && definition.maximumRevisions === 3
    && ['all-registered', 'explicit-subset'].includes(definition.selection)
    && Array.isArray(definition.panels) && definition.panels.length > 0 && definition.panels.length <= 64
    && new Set(definition.panels.map(item => item.panelId)).size === definition.panels.length, 'DAG_CONTRACT');
  resolutionPolicy(definition.resolution);
  for (const panel of definition.panels) {
    exact(panel, ['panelId', 'prototype', 'intent', 'adoptedRun']);
    requireThat(isId(panel.panelId) && (panel.adoptedRun === null || RUN.test(panel.adoptedRun)), 'DAG_PANEL_CONTRACT');
    validateIntent(panel.intent, loadPrototype(root, panel.prototype));
    if (panel.adoptedRun) {
      const result = verifyResult(root, panel.adoptedRun), review = verifyReview(root, panel.adoptedRun, result);
      requireThat(review.decision === 'accept' && result.plan.projectId === definition.projectId
        && result.plan.panelId === panel.panelId && result.plan.styleSha256 === definition.styleSha256
        && result.plan.prototype.sha256 === panel.prototype.sha256, 'DAG_ADOPTED_IMAGE_INVALID');
    }
  }
  requireThat(primaryPolicy ? definition.anchorPanelId === null && definition.initialAnchor === null
    && canonical(definition.primaryReference) === canonical(primaryStyleReference(root, definition.styleSha256))
    : definition.initialAnchor ? definition.initialAnchor.panelId === definition.anchorPanelId
    : definition.panels.some(item => item.panelId === definition.anchorPanelId), 'DAG_ANCHOR_PANEL_REQUIRED');
  requireThat(canonical(definition.nodes) === canonical(primaryPolicy ? primaryTopology(definition.panels) : topology(definition.panels, definition.anchorPanelId, definition.initialAnchor)), 'DAG_TOPOLOGY_CHANGED');
  verifyGraph(definition.nodes); return definition;
}
const directory = (root, dag) => local(root, dag.replace('/dag.json', ''));
function operations(root, dag, definition) {
  const base = directory(root, dag), folder = local(base, 'operations');
  if (!fs.existsSync(folder)) return [];
  const items = fs.readdirSync(folder).filter(name => name.endsWith('.json')).map(name => {
    requireThat(UUID.test(name.slice(0, -5)), 'DAG_OPERATION_PATH');
    const op = readJson(local(base, `operations/${name}`)); unseal(op);
    exact(op, ['kind', 'dagSha256', 'operationId', 'sequence', 'action', 'panelId', 'input', 'run', 'state', 'error', 'sha256']);
    requireThat(op.kind === 'ui_reference_dag_operation_v1' && op.dagSha256 === definition.sha256
      && op.operationId === name.slice(0, -5) && Number.isSafeInteger(op.sequence) && op.sequence >= 0
      && ACTIONS.includes(op.action) && (op.panelId === null || definition.panels.some(p => p.panelId === op.panelId))
      && (op.run === null || RUN.test(op.run)) && ['started', 'complete', 'error'].includes(op.state)
      && (op.error === null || /^[A-Z][A-Z0-9_]{1,100}$/.test(op.error)), 'DAG_OPERATION_INVALID');
    return op;
  }).sort((a, b) => a.sequence - b.sequence);
  requireThat(new Set(items.map(item => item.sequence)).size === items.length, 'DAG_OPERATION_SEQUENCE');
  return items;
}
function readContext(root, dag) {
  return validationScope(() => readContextEvidence(root, dag));
}
function readContextEvidence(root, dag) {
  const definition = readDefinition(root, dag), project = loadProject(root), ops = operations(root, dag, definition);
  const currentContext = project.id === definition.projectId && project.activeStyle === definition.styleSha256
    && definition.panels.every(panel => project.panels[panel.panelId]?.prototype.sha256 === panel.prototype.sha256)
    && (definition.selection !== 'all-registered' || Object.keys(project.panels).length === definition.panels.length);
  const primaryPolicy = definition.kind === 'ui_reference_project_dag_v2';
  const anchor = primaryPolicy ? null : anchorEvidence(root, project, definition.styleSha256);
  if (definition.initialAnchor) requireThat(canonical(anchor) === canonical(definition.initialAnchor), 'DAG_ANCHOR_CHANGED');
  if (anchor && !definition.initialAnchor) requireThat(anchor.panelId === definition.anchorPanelId, 'DAG_ANCHOR_PANEL_MISMATCH');
  // Revision budget belongs to the project/style/prototype session, not to a
  // disposable graph ID. A newly created DAG cannot reset three spent rounds.
  const budgets = new Map();
  if (fs.existsSync(local(root, 'runs'))) for (const name of fs.readdirSync(local(root, 'runs'))) {
    if (!UUID.test(name) || !fs.existsSync(local(root, `runs/${name}/plan.json`))) continue;
    const candidate = readJson(local(root, `runs/${name}/plan.json`));
    const panel = definition.panels.find(item => item.panelId === candidate.panelId);
    if (candidate.revision && panel && candidate.styleSha256 === definition.styleSha256 && candidate.prototype?.sha256 === panel.prototype.sha256) {
      const verified = verifyPlan(root, `runs/${name}`, { allowLegacy: true });
      budgets.set(panel.panelId, Math.max(budgets.get(panel.panelId) ?? 0, verified.revision.round));
    }
  }
  const panels = definition.panels.map(panel => {
    const turns = ops.filter(op => op.panelId === panel.panelId && TURN.includes(op.action) && op.run).map(op => {
      const plan = verifyPlan(root, op.run, { allowLegacy: true });
      requireThat(plan.projectId === definition.projectId && plan.panelId === panel.panelId && plan.styleSha256 === definition.styleSha256
        && plan.prototype.sha256 === panel.prototype.sha256 && canonical(plan.intent) === canonical(panel.intent)
        && plan.request.resolution.mode === definition.resolution, 'DAG_RUN_CONTEXT_MISMATCH');
      requireThat(op.action !== 'revise' || (plan.revision?.round === op.input.round
        && plan.revision.run === op.input.sourceRun && plan.revision.note === op.input.note), 'DAG_REVISION_BINDING');
      if (primaryPolicy) {
        requireThat(plan.anchor === null && plan.request.images.some(image => image.role === 'primary-style'
          && image.artifact.sha256 === definition.primaryReference.sha256), 'DAG_RUN_PRIMARY_MISMATCH');
      } else if (panel.panelId !== definition.anchorPanelId || definition.initialAnchor) {
        requireThat(anchor && plan.anchor?.image.sha256 === anchor.imageSha256 && plan.anchor.planSha256 === anchor.planSha256, 'DAG_RUN_ANCHOR_MISMATCH');
      }
      return { operationId: op.operationId, run: op.run, round: plan.revision?.round ?? 0, ...inspectRun(root, op.run) };
    });
    if (panel.adoptedRun) turns.unshift({ operationId: null,
      round: verifyPlan(root, panel.adoptedRun, { allowLegacy: true }).revision?.round ?? 0, ...inspectRun(root, panel.adoptedRun) });
    const latest = turns.at(-1) ?? null;
    const source = [...turns].reverse().find(turn => turn.imageSha256 && ['pending_visual_review', 'accepted', 'rejected_visual'].includes(turn.status)) ?? null;
    const used = Math.max(budgets.get(panel.panelId) ?? 0, ...turns.map(turn => turn.round), 0);
    const acceptedRun = project.panels[panel.panelId]?.acceptedRun ?? null;
    let accepted = null;
    if (acceptedRun && currentContext) {
      const result = verifyResult(root, acceptedRun), review = verifyReview(root, acceptedRun, result);
      if (review.decision === 'accept' && result.plan.styleSha256 === definition.styleSha256
        && result.plan.prototype.sha256 === panel.prototype.sha256) accepted = { run: acceptedRun, imageSha256: result.technical.imageSha256 };
    }
    return { panelId: panel.panelId, prototypeSha256: panel.prototype.sha256,
      sessionKey: digestJson({ projectId: definition.projectId, panelId: panel.panelId, styleSha256: definition.styleSha256, prototypeSha256: panel.prototype.sha256 }),
      turns, latest, source, accepted,
      revisionsUsed: used, revisionsRemaining: 3 - used, deliveryUsesOlderAccepted: !!accepted && !!latest && accepted.run !== latest.run };
  });
  return { definition, project, ops, anchor, panels, currentContext, primaryPolicy, runtimeCurrent: definition.runtimeSha256 === runtimeDigest() };
}
function assertWritable(context) {
  requireThat(context.currentContext, 'DAG_CONTEXT_STALE');
  requireThat(context.runtimeCurrent, 'DAG_RUNTIME_CHANGED');
}
function nodeStates(context) {
  const { definition, panels, anchor } = context;
  const state = new Map([['inputs', context.currentContext ? 'complete' : 'stale'], ['primary-reference', 'complete'], ['anchor', anchor ? 'complete' : 'waiting_review']]);
  for (const panel of panels) {
    const status = panel.latest?.status;
    const eligible = context.primaryPolicy || !!anchor || panel.panelId === definition.anchorPanelId;
    const values = ['blocked', 'blocked', 'blocked', 'blocked', 'blocked', 'blocked'];
    values[0] = panel.latest ? 'complete' : eligible ? 'ready' : 'blocked';
    if (panel.latest) {
      values[1] = status === 'awaiting_authorization' ? 'waiting_authorization' : status === 'authorized' ? 'ready'
        : status === 'reserved_no_resubmit' ? 'awaiting_result' : TERMINAL.includes(status) && !panel.latest.rawSha256 ? status : 'complete';
      if (panel.latest.rawSha256) values[2] = status === 'rejected_technical' ? 'failed' : status === 'raw_received_needs_finish' ? 'ready' : 'complete';
      if (panel.latest.imageSha256 && ['pending_visual_review', 'accepted', 'rejected_visual'].includes(status)) {
        values[3] = values[4] = 'complete';
        values[5] = status === 'accepted' ? 'complete' : status === 'rejected_visual' ? 'rejected' : 'waiting_review';
      }
    }
    stages.forEach((stage, index) => state.set(panelNode(panel.panelId, stage), values[index]));
    state.set(panelNode(panel.panelId, 'accepted'), panel.accepted ? 'complete' : 'blocked');
  }
  state.set('output', panels.every(panel => panel.accepted) ? 'ready' : 'blocked');
  return definition.nodes.map(node => ({ ...node, status: context.currentContext ? state.get(node.id) : 'stale' }));
}
export function inspectProjectDag(root, dag) {
  return validationScope(() => {
    const context = readContext(root, dag), nodes = nodeStates(context);
    const selectionSha256 = context.panels.every(panel => panel.accepted)
      ? digestJson(context.panels.map(panel => ({ panelId: panel.panelId, ...panel.accepted }))) : null;
    const delivery = selectionSha256 ? `${dag.replace('/dag.json', '')}/deliveries/${selectionSha256}` : null;
    let output = null;
    if (delivery && fs.existsSync(local(root, `${delivery}/manifest.json`))) {
      const checked = validateDelivery(local(root, delivery)), manifest = readJson(local(root, `${delivery}/manifest.json`));
      requireThat(manifest.projectId === context.definition.projectId && manifest.styleSha256 === context.definition.styleSha256
        && canonical(manifest.panelIds) === canonical(context.panels.map(panel => panel.panelId).sort()), 'DAG_DELIVERY_SELECTION');
      for (const panel of context.panels) requireThat(readJson(local(root, `${delivery}/panels/${panel.panelId}/provenance.json`)).imageSha256 === panel.accepted.imageSha256, 'DAG_DELIVERY_SELECTION');
      output = { delivery, selectionSha256, panelIds: manifest.panelIds, ...checked };
      nodes.find(node => node.id === 'output').status = 'complete';
    }
    const waiting = nodes.filter(node => ['waiting_review', 'waiting_authorization', 'awaiting_result'].includes(node.status));
    const status = !context.currentContext ? 'stale' : output ? 'delivered' : nodes.find(node => node.id === 'output').status === 'ready' ? 'ready_for_delivery'
      : context.panels.some(panel => TERMINAL.includes(panel.latest?.status) || panel.latest?.status === 'rejected_visual') ? 'needs_decision'
      : nodes.some(node => node.status === 'ready') ? 'ready' : waiting.length ? 'waiting' : 'ready';
    return { kind: 'ui_reference_project_dag_status_v1', dag, dagSha256: context.definition.sha256, projectId: context.definition.projectId,
      styleSha256: context.definition.styleSha256, selection: context.definition.selection, currentContext: context.currentContext,
      runtimeCurrent: context.runtimeCurrent, primaryReference: context.definition.primaryReference ?? null, status, anchor: context.anchor, panels: context.panels, nodes, output,
      interruptedOperations: context.ops.filter(op => op.state === 'started' && (!op.run
        || ['authorized', 'awaiting_authorization', 'reserved_no_resubmit', 'raw_received_needs_finish'].includes(inspectRun(root, op.run).status)))
        .map(op => ({ operationId: op.operationId, action: op.action, panelId: op.panelId, run: op.run })),
      computeCalls: new Set(context.ops.filter(op => TURN.includes(op.action) && op.run
        && fs.existsSync(local(root, `${op.run}/attempt.json`))).map(op => op.run)).size };
  });
}

function begin(root, dag, action, panelId, operationId, input, work) {
  requireThat(UUID.test(operationId), 'DAG_OPERATION_ID_REQUIRED');
  return withLock(directory(root, dag), () => {
    const context = readContext(root, dag);
    // Archived compute is forbidden. Explicit human review and verified export
    // remain available for completed images of the current project context.
    requireThat(context.currentContext, 'DAG_CONTEXT_STALE');
    if (!['review', 'export'].includes(action)) assertWritable(context);
    requireThat(panelId === null || context.panels.some(panel => panel.panelId === panelId), 'DAG_PANEL_UNKNOWN');
    const previous = context.ops.find(op => op.operationId === operationId);
    if (previous) {
      requireThat(previous.action === action && previous.panelId === panelId && canonical(previous.input) === canonical(input), 'DAG_OPERATION_CONFLICT');
      return { replay: true, operation: previous };
    }
    const op = { kind: 'ui_reference_dag_operation_v1', dagSha256: context.definition.sha256, operationId,
      sequence: context.ops.length, action, panelId, input, run: null, state: 'started', error: null };
    const relative = `operations/${operationId}.json`, base = directory(root, dag);
    writeJsonNew(base, relative, seal(op));
    const save = () => atomicJson(base, relative, seal(op));
    try { work(context, op, save); save(); return { replay: false, operation: op }; }
    catch (error) { op.state = 'error'; op.error = /^[A-Z][A-Z0-9_]{1,100}$/.test(error.message) ? error.message : 'DAG_OPERATION_FAILED'; save(); throw error; }
  });
}
function end(root, dag, op, error = null) {
  return withLock(directory(root, dag), () => {
    const current = readJson(local(directory(root, dag), `operations/${op.operationId}.json`)); unseal(current);
    const { sha256, ...value } = current;
    value.state = error ? 'error' : 'complete'; value.error = error ? (/^[A-Z][A-Z0-9_]{1,100}$/.test(error.message) ? error.message : 'DAG_OPERATION_FAILED') : null;
    atomicJson(directory(root, dag), `operations/${op.operationId}.json`, seal(value));
  });
}
const selected = (context, panelId) => context.panels.find(panel => panel.panelId === panelId);
function ready(context, panelId) {
  requireThat(context.primaryPolicy || context.anchor || panelId === context.definition.anchorPanelId, 'DAG_ANCHOR_NOT_ACCEPTED');
}
export function prepareProjectDagPanel(root, dag, panelId, { operationId }) {
  begin(root, dag, 'prepare', panelId, operationId, {}, (context, op) => {
    ready(context, panelId); const panel = selected(context, panelId);
    requireThat(!panel.latest, 'DAG_PANEL_ALREADY_PLANNED');
    const spec = context.definition.panels.find(item => item.panelId === panelId);
    op.run = createPlan(root, { panelId, intent: spec.intent, resolution: context.definition.resolution }).run; op.state = 'complete';
  });
  return inspectProjectDag(root, dag);
}
export function advanceProjectDag(root, dag, { operationId }) {
  requireThat(UUID.test(operationId), 'DAG_OPERATION_ID_REQUIRED');
  const context = readContext(root, dag); assertWritable(context);
  for (const panel of context.panels.filter(panel => !panel.latest && (context.primaryPolicy || context.anchor || panel.panelId === context.definition.anchorPanelId))) {
    const hash = digestJson({ operationId, panelId: panel.panelId });
    const childId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
    prepareProjectDagPanel(root, dag, panel.panelId, { operationId: childId });
  }
  return inspectProjectDag(root, dag);
}
export function authorizeProjectDagPanel(root, dag, panelId, { operationId, run, planSha256, approval }) {
  textValue(approval, 2000); requireThat(RUN.test(run) && isDigest(planSha256), 'DAG_RUN_REQUIRED');
  begin(root, dag, 'authorize', panelId, operationId, { run, planSha256, approval }, (context, op) => {
    ready(context, panelId); requireThat(selected(context, panelId).latest?.run === run, 'DAG_RUN_STALE'); op.run = run;
    authorize(root, run, planSha256, approval); op.state = 'complete';
  });
  return inspectProjectDag(root, dag);
}
// The durable operation is published before the provider call. Replaying an
// operation only reads evidence; a new operation cannot reserve the same run.
export async function generateProjectDagPanel(root, dag, panelId, { operationId, run }, adapter) {
  requireThat(RUN.test(run), 'DAG_RUN_REQUIRED');
  requireThat(adapter && typeof adapter.generate === 'function', 'ADAPTER_GENERATE_REQUIRED');
  const started = begin(root, dag, 'generate', panelId, operationId, { run }, (context, op) => {
    ready(context, panelId); requireThat(selected(context, panelId).latest?.run === run, 'DAG_RUN_STALE');
    requireThat(inspectRun(root, run).status === 'authorized', 'DAG_RUN_NOT_AUTHORIZED'); op.run = run;
  });
  if (!started.replay) {
    try { await generateWithAdapter(root, run, adapter); end(root, dag, started.operation); }
    catch (error) { end(root, dag, started.operation, error); throw error; }
  }
  return inspectProjectDag(root, dag);
}
export function requestProjectDagPanel(root, dag, panelId, { operationId, run }) {
  requireThat(RUN.test(run), 'DAG_RUN_REQUIRED'); let exchange = null;
  begin(root, dag, 'request', panelId, operationId, { run }, (context, op, save) => {
    ready(context, panelId); requireThat(selected(context, panelId).latest?.run === run, 'DAG_RUN_STALE'); op.run = run; save();
    exchange = reserve(root, run); op.state = 'complete';
  });
  // A replay deliberately does not expose a new dispatch instruction.
  return { ...inspectProjectDag(root, dag), exchange };
}
export function actProjectDagPanel(root, dag, panelId, { operationId, run, action, payload }, bytes = null) {
  requireThat(RUN.test(run) && ['receive', 'finish', 'stop', 'review'].includes(action), 'DAG_ACTION_INVALID');
  if (action === 'receive') exact(payload, ['requestSha256', 'rawSha256']);
  if (action === 'receive') requireThat(bytes instanceof Uint8Array && sha256(bytes) === payload.rawSha256, 'DAG_RECEIVE_BYTES_MISMATCH');
  begin(root, dag, action, panelId, operationId, { run, payload }, (context, op, save) => {
    ready(context, panelId); requireThat(selected(context, panelId).latest?.run === run, 'DAG_RUN_STALE'); op.run = run; save();
    if (action === 'receive') receive(root, run, payload.requestSha256, bytes);
    if (action === 'finish') { exact(payload, ['rawSha256']); finish(root, run, payload.rawSha256); }
    if (action === 'stop') { exact(payload, ['requestSha256', 'outcome']); stopAttempt(root, run, payload.requestSha256, payload.outcome); }
    if (action === 'review') {
      exact(payload, ['imageSha256', 'layout', 'style', 'copy', 'decision', 'note'], ['useAsAnchor']);
      requireThat(!payload.useAsAnchor, 'PROJECT_ANCHOR_REMOVED');
      reviewRun(root, run, payload);
    }
    op.state = 'complete';
  });
  return inspectProjectDag(root, dag);
}
export function reviseProjectDagPanel(root, dag, panelId, { operationId, sourceRun, note }) {
  textValue(note, 8000); requireThat(RUN.test(sourceRun), 'DAG_RUN_REQUIRED');
  const context = readContext(root, dag), panel = selected(context, panelId);
  requireThat(panel, 'DAG_PANEL_UNKNOWN');
  const previous = context.ops.find(op => op.operationId === operationId);
  const round = previous?.input.round ?? panel.revisionsUsed + 1;
  begin(root, dag, 'revise', panelId, operationId, { sourceRun, note, round }, (current, op) => {
    ready(current, panelId); const value = selected(current, panelId);
    requireThat(value.source?.run === sourceRun, 'DAG_REVISION_SOURCE_STALE');
    requireThat(!['authorized', 'reserved_no_resubmit', 'raw_received_needs_finish', 'awaiting_authorization'].includes(value.latest?.status), 'DAG_ATTEMPT_NEEDS_DECISION');
    requireThat(round <= 3 && round === value.revisionsUsed + 1, 'REVISION_LIMIT_REACHED');
    op.run = createRevisionPlan(root, { sourceRun, note, round }).run; op.state = 'complete';
  });
  return inspectProjectDag(root, dag);
}
export function retryProjectDagPanel(root, dag, panelId, { operationId, sourceRun, decision }) {
  textValue(decision, 2000); requireThat(RUN.test(sourceRun), 'DAG_RUN_REQUIRED');
  begin(root, dag, 'retry', panelId, operationId, { sourceRun, decision }, (context, op) => {
    ready(context, panelId); const panel = selected(context, panelId);
    requireThat(panel.latest?.run === sourceRun && TERMINAL.includes(panel.latest.status) && !panel.source, 'DAG_RETRY_NOT_INITIAL_TERMINAL');
    const spec = context.definition.panels.find(item => item.panelId === panelId);
    op.run = createPlan(root, { panelId, intent: spec.intent, resolution: context.definition.resolution, parentRun: sourceRun }).run; op.state = 'complete';
  });
  return inspectProjectDag(root, dag);
}
export function exportProjectDag(root, dag, { operationId }) {
  begin(root, dag, 'export', null, operationId, {}, (context, op) => {
    requireThat(context.panels.every(panel => panel.accepted), 'DAG_DELIVERY_NOT_READY');
    const selection = digestJson(context.panels.map(panel => ({ panelId: panel.panelId, ...panel.accepted })));
    const output = local(directory(root, dag), `deliveries/${selection}`);
    if (fs.existsSync(output)) validateDelivery(output);
    else exportProject(root, output, context.definition.panels.map(panel => panel.panelId));
    op.state = 'complete';
  });
  return inspectProjectDag(root, dag);
}

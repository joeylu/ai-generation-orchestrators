import { snapshotJson, validatePanelState } from './spec.mjs';
import { validateCatalog } from './catalog.mjs';
import { validatePanelRequest, createPlanningContext } from './planning-context.mjs';
import { validatePanelProposal, checkPanelProposal } from './proposal.mjs';
import { createPanelBundle, validatePanelBundle, panelBundleAssetInputs } from './panel-bundle.mjs';
import { panelAssetKeys, panelAssetPath } from './panel-assets.mjs';
import { applyPanelPatch } from './patch.mjs';
import { canonicalJson, digestJson } from './canonical.mjs';
import { createClarifiedRequest } from './clarification.mjs';
import { createPanelEditContext, validatePanelEditProposal, checkPanelEditProposal } from './edit-planning.mjs';
import { validateWorkbenchAssetPool, workbenchRetrieval, workbenchAssetInputs, verifyWorkbenchContextPool } from './workbench-assets.mjs';

const clone = value => structuredClone(value);
const stale = () => ({ status: 'STALE' });
const fail = code => { throw new Error(code); };

// The seed may contain a large resource pool. Inspect its own fields without
// sending the entire pool through PanelSpec's much smaller JSON node budget.
function seedFields(input) {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype) fail('WORKBENCH_SEED');
  const fields = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(fields);
  if (keys.length !== 2 || keys.some(key => !['catalog', 'pool'].includes(key))
    || keys.some(key => !Object.hasOwn(fields[key], 'value') || !fields[key].enumerable)) fail('WORKBENCH_SEED');
  return { catalog: fields.catalog.value, pool: fields.pool.value };
}

/** Local state machine only: an external Agent supplies every proposal. */
export async function createWorkbenchModel(seedInput, core, presentPanel) {
  if (presentPanel !== undefined && typeof presentPanel !== 'function') fail('WORKBENCH_PRESENTATION_REQUIRED');
  const seed = seedFields(seedInput), catalog = validateCatalog(snapshotJson(seed.catalog));
  // Pool validation owns its synchronous input isolation, byte and index limits.
  const pool = seed.pool === null ? null : await validateWorkbenchAssetPool(seed.pool);
  let state = { phase: 'empty', context: null, proposal: null, report: null, panel: null,
    assetEvidence: null, history: [], canUndo: false };
  let revision = 0, disposed = false, planning = false, undoEntries = [];
  const emptyEdit = () => ({ context: null, proposal: null, report: null });
  let edit = emptyEdit();
  const getEditSnapshot = () => clone(edit);
  const guard = () => { if (disposed) fail('WORKBENCH_DISPOSED'); };
  const getSnapshot = () => clone(planning ? { ...state, phase: 'planning', context: null, proposal: null, report: null } : state);
  const begin = () => { guard(); planning = false; return ++revision; };
  const isCurrent = ticket => !disposed && ticket === revision;
  const commit = (ticket, next, nextUndo = undoEntries) => {
    if (!isCurrent(ticket)) return stale();
    if (next.panel?.sha256 !== state.panel?.sha256 || next.context?.sha256 !== state.context?.sha256) edit = emptyEdit();
    state = next; undoEntries = nextUndo; planning = false;
    return getSnapshot();
  };
  const recover = (ticket, error) => {
    if (!isCurrent(ticket)) return stale();
    planning = false;
    throw error;
  };
  // A UI host may validate and atomically mount a candidate before it becomes
  // the current authored model. Failed text/image rendering must retain history.
  const commitPanel = async (ticket, next, nextUndo) => {
    if (!isCurrent(ticket)) return stale();
    if (presentPanel) await presentPanel(clone(next.panel), () => isCurrent(ticket));
    return commit(ticket, next, nextUndo);
  };

  async function assetsFor(spec, previous) {
    if (!spec.assets) return undefined;
    if (pool && canonicalJson(spec.assets.library) === canonicalJson({ id: pool.index.id, sha256: pool.index.sha256 })) {
      return workbenchAssetInputs(spec, pool);
    }
    if (!previous?.spec.assets) fail('WORKBENCH_ASSETS_REQUIRED');
    // A defensive clone no longer carries the adapter's validated-object identity.
    // Revalidate its component envelope before materializing any embedded bytes.
    const componentBundle = await core.validateBundle(previous.componentBundle);
    const input = panelBundleAssetInputs({ ...previous, componentBundle }, core), keys = new Set(panelAssetKeys(spec));
    const records = input.closure.records.filter(record => keys.has(record.key));
    const paths = new Set(records.map(panelAssetPath));
    return { closure: { ...input.closure, records }, resources: input.resources.filter(resource => paths.has(resource.path)) };
  }
  async function packagePanel(spec, panelCatalog, values, assets) {
    return validatePanelBundle(await createPanelBundle(spec, panelCatalog, core, values, assets), core);
  }
  async function patchCandidate(base, previousUndo, patch, stateInput, editEvidence) {
    if (!base.panel) fail('WORKBENCH_PANEL_REQUIRED');
    if (previousUndo.length >= 16) fail('WORKBENCH_HISTORY_LIMIT');
    const values = validatePanelState(base.panel.spec, stateInput === undefined ? base.panel.state : stateInput);
    const { spec, receipt } = await applyPanelPatch(base.panel.spec, patch);
    const beforeAssets = await assetsFor(base.panel.spec, base.panel);
    const before = await packagePanel(base.panel.spec, base.panel.catalog, values, beforeAssets);
    const nextValues = validatePanelState(spec, Object.fromEntries(spec.state.map(field => [field.id,
      Object.hasOwn(values, field.id) ? values[field.id] : field.initial])));
    const assets = await assetsFor(spec, before);
    const panel = await packagePanel(spec, before.catalog, nextValues, assets);
    const entry = { patch, receipt, ...(editEvidence ? { editEvidence } : {}) };
    return { next: { ...base, phase: 'ready', panel, history: [...base.history, entry], canUndo: true },
      nextUndo: [...previousUndo, before] };
  }

  return Object.freeze({
    getSnapshot, getEditSnapshot,
    async prepareEdit(requestInput) {
      const ticket = begin();
      try {
        const request = validatePanelRequest(requestInput), panel = clone(state.panel);
        if (!panel) fail('WORKBENCH_PANEL_REQUIRED');
        const context = await createPanelEditContext(panel.spec, panel.catalog, request);
        if (!isCurrent(ticket)) return stale();
        edit = { context, proposal: null, report: null };
        return getEditSnapshot();
      } catch (error) { return recover(ticket, error); }
    },
    async acceptEditProposal(proposalInput, stateInput) {
      const source = getEditSnapshot(), ticket = begin();
      try {
        const input = snapshotJson(proposalInput), base = clone(state), previousUndo = clone(undoEntries);
        const values = stateInput === undefined ? undefined : snapshotJson(stateInput);
        if (!source.context || !base.panel) fail('WORKBENCH_EDIT_CONTEXT_REQUIRED');
        const context = source.context;
        if (context.baseSpecSha256 !== await digestJson(base.panel.spec)
          || context.catalogSha256 !== await digestJson(base.panel.catalog)) fail('WORKBENCH_EDIT_STALE');
        const proposal = await validatePanelEditProposal(context, input);
        const report = await checkPanelEditProposal(context, proposal);
        if (!isCurrent(ticket)) return stale();
        if (['NEEDS_INPUT', 'NO_CHANGES'].includes(report.status)) {
          edit = { context, proposal, report };
          return getEditSnapshot();
        }
        const candidate = await patchCandidate(base, previousUndo, proposal.patch, values, { context, proposal, report });
        const result = await commitPanel(ticket, candidate.next, candidate.nextUndo);
        // Even a no-op patch consumes its prepared proposal after a real commit.
        if (result.status !== 'STALE') edit = emptyEdit();
        return result;
      } catch (error) { return recover(ticket, error); }
    },
    async prepare(requestInput, optionsInput = { style: null }) {
      const ticket = begin();
      try {
        const request = validatePanelRequest(requestInput), options = snapshotJson(optionsInput);
        if (!options || Object.getPrototypeOf(options) !== Object.prototype
          || Object.keys(options).some(key => !['style', 'retrieveAssets'].includes(key)) || !Object.hasOwn(options, 'style')
          || (Object.hasOwn(options, 'retrieveAssets') && typeof options.retrieveAssets !== 'boolean')) fail('WORKBENCH_PREPARE_OPTIONS');
        if (options.style !== null && (typeof options.style !== 'string'
          || !/^[a-z0-9.-]{1,96}$(?![\s\S])/.test(options.style))) fail('WORKBENCH_PREPARE_STYLE');
        const base = clone(state);
        const retrieval = pool && options.retrieveAssets !== false ? workbenchRetrieval(request.text, pool, { style: options.style }) : undefined;
        planning = true;
        const context = await createPlanningContext(request, catalog, retrieval);
        return commit(ticket, { ...base, phase: 'awaiting-proposal', context, proposal: null, report: null });
      } catch (error) { return recover(ticket, error); }
    },
    async clarify(clarificationInput) {
      const visible = getSnapshot(), ticket = begin();
      try {
        const input = snapshotJson(clarificationInput), base = clone(state);
        if (!visible.context || !visible.proposal || visible.report?.status !== 'NEEDS_INPUT') fail('WORKBENCH_CLARIFICATION_REQUIRED');
        planning = true;
        const request = await createClarifiedRequest(visible.context, visible.proposal, input);
        if (!isCurrent(ticket)) return stale();
        const options = { style: visible.context.assetRetrieval?.policy.style ?? null };
        const retrieval = pool ? workbenchRetrieval(request.text, pool, options) : undefined;
        const context = await createPlanningContext(request, catalog, retrieval);
        return commit(ticket, { ...base, phase: 'awaiting-proposal', context, proposal: null, report: null });
      } catch (error) { return recover(ticket, error); }
    },
    async acceptProposal(proposalInput) {
      const visible = getSnapshot(), ticket = begin();
      try {
        const input = snapshotJson(proposalInput), base = clone(state), context = visible.context;
        if (!context) fail('WORKBENCH_CONTEXT_REQUIRED');
        const proposal = await validatePanelProposal(context, input);
        if (proposal.spec?.assets && !context.assetRetrieval) fail('WORKBENCH_ASSET_CONTEXT_REQUIRED');
        const report = await checkPanelProposal(context, proposal);
        if (report.status === 'NEEDS_INPUT') {
          return commit(ticket, { ...base, phase: 'needs-input', context, proposal, report });
        }
        if (context.assetRetrieval) {
          if (!pool) fail('WORKBENCH_ASSETS_REQUIRED');
          await verifyWorkbenchContextPool(context, pool);
        }
        const assets = proposal.spec.assets ? await workbenchAssetInputs(proposal.spec, pool) : undefined;
        const panel = await packagePanel(proposal.spec, context.catalog, undefined, assets);
        const assetEvidence = context.assetRetrieval ? {
          workbenchAssetEvidenceVersion: '0.1', status: 'EMBEDDED_POOL_CHECKED', poolSha256: pool.sha256,
          library: clone(context.assetRetrieval.library), contextSha256: context.sha256,
          selectedKeys: panelAssetKeys(proposal.spec), sourceReplay: 'NOT_RUN',
        } : null;
        return await commitPanel(ticket, { phase: 'ready', context, proposal, report, panel, assetEvidence, history: [], canUndo: false }, []);
      } catch (error) { return recover(ticket, error); }
    },
    async patch(patchInput, stateInput) {
      const ticket = begin();
      try {
        const patch = snapshotJson(patchInput), base = clone(state), previousUndo = clone(undoEntries);
        const values = stateInput === undefined ? undefined : snapshotJson(stateInput);
        const candidate = await patchCandidate(base, previousUndo, patch, values);
        return await commitPanel(ticket, candidate.next, candidate.nextUndo);
      } catch (error) { return recover(ticket, error); }
    },
    async undo() {
      const ticket = begin();
      try {
        if (!undoEntries.length) fail('WORKBENCH_UNDO_EMPTY');
        const previousUndo = clone(undoEntries), panel = previousUndo.pop();
        return await commitPanel(ticket, { ...state, phase: 'ready', panel,
          history: state.history.slice(0, -1), canUndo: previousUndo.length > 0 }, previousUndo);
      } catch (error) { return recover(ticket, error); }
    },
    async importPanel(panelInput) {
      const ticket = begin();
      try {
        const input = snapshotJson(panelInput);
        const panel = await validatePanelBundle(input, core);
        return await commitPanel(ticket, { phase: 'ready', context: null, proposal: null, report: null,
          panel, assetEvidence: null, history: [], canUndo: false }, []);
      } catch (error) { return recover(ticket, error); }
    },
    async exportPanel(stateInput) {
      guard();
      const ticket = revision;
      try {
        const panel = clone(state.panel);
        if (!panel) fail('WORKBENCH_PANEL_REQUIRED');
        const values = validatePanelState(panel.spec, stateInput === undefined ? panel.state : stateInput);
        const assets = await assetsFor(panel.spec, panel);
        const exported = await packagePanel(panel.spec, panel.catalog, values, assets);
        return isCurrent(ticket) ? exported : stale();
      } catch (error) { if (!isCurrent(ticket)) return stale(); throw error; }
    },
    dispose() { disposed = true; revision += 1; planning = false; },
  });
}

import { canonicalJson } from './canonical.mjs';
import { validatePanelState } from './spec.mjs';
import { validateWorkbenchEditUsage } from './workbench-edit-budget.mjs';

export const WORKBENCH_STORAGE_KEY = 'ui-panel-studio.workspace.v1';
export const WORKBENCH_STORAGE_LIMITS = Object.freeze({ versions: 8, chars: 1_800_000 });
const clone = value => structuredClone(value);
const fail = code => { throw new Error(code); };
const object = value => value && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const draftKeys = ['text', 'id', 'style', 'editText', 'manualId'];
export const emptyWorkbenchDraft = () => ({ text: '', id: 'my-panel', style: '', editText: '', manualId: false });
function draftFor(value) {
  if (!exact(value, draftKeys) || typeof value.manualId !== 'boolean'
    || draftKeys.filter(key => key !== 'manualId').some(key => typeof value[key] !== 'string' || value[key].length > 100_000)) fail('WORKSPACE_INVALID');
  return clone(value);
}
// A version describes authored inputs. Playing with values must not create a version.
const identity = panel => canonicalJson([panel.spec, panel.catalog, panel.compilerVersion, panel.assetClosure ?? null]);
const empty = () => ({ workspaceVersion: '0.2', draft: emptyWorkbenchDraft(), currentId: null, versions: [], editUsage: {} });

/** Synchronous, atomic single-key writes. No provider state, jobs or authorization is persisted.
 * Bundle recompilation is deliberately performed by the existing model on restore.
 */
export function createWorkbenchStorage(storage, { key = WORKBENCH_STORAGE_KEY,
  limits = WORKBENCH_STORAGE_LIMITS, now = () => new Date().toISOString(), nextId = () => crypto.randomUUID() } = {}) {
  let baseline, data = empty(), blocked = false;
  const readRaw = () => {
    try { return storage.getItem(key); } catch { fail('WORKSPACE_UNAVAILABLE'); }
  };
  const write = next => {
    if (blocked || baseline === undefined) fail('WORKSPACE_BLOCKED');
    if (readRaw() !== baseline) { blocked = true; fail('WORKSPACE_CONFLICT'); }
    const raw = JSON.stringify(next);
    if (raw.length > limits.chars) fail('WORKSPACE_TOO_LARGE');
    try { storage.setItem(key, raw); } catch { fail('WORKSPACE_QUOTA'); }
    baseline = raw; data = next;
    return clone(data);
  };
  return Object.freeze({
    read() {
      blocked = true;
      const raw = readRaw();
      let next = empty();
      if (raw !== null) {
        if (raw.length > limits.chars) fail('WORKSPACE_INVALID');
        try { next = JSON.parse(raw); } catch { fail('WORKSPACE_INVALID'); }
        const legacy = next?.workspaceVersion === '0.1';
        if (!exact(next, ['workspaceVersion', 'draft', 'currentId', 'versions', ...(legacy ? [] : ['editUsage'])]) || !['0.1', '0.2'].includes(next.workspaceVersion)
          || !Array.isArray(next.versions) || next.versions.length > limits.versions) fail('WORKSPACE_INVALID');
        try { next.editUsage = legacy ? {} : validateWorkbenchEditUsage(next.editUsage); } catch { fail('WORKSPACE_INVALID'); }
        next.workspaceVersion = '0.2';
        next.draft = draftFor(next.draft);
        const ids = new Set();
        for (const entry of next.versions) {
          if (!exact(entry, ['id', 'savedAt', 'panel', 'state', 'draft']) || typeof entry.id !== 'string'
            || !/^[A-Za-z0-9_-]{1,64}$/.test(entry.id) || ids.has(entry.id)
            || typeof entry.savedAt !== 'string' || !Number.isFinite(Date.parse(entry.savedAt))
            || !object(entry.panel) || !object(entry.state)) fail('WORKSPACE_INVALID');
          entry.draft = draftFor(entry.draft); ids.add(entry.id);
        }
        if (next.currentId !== null && !ids.has(next.currentId)) fail('WORKSPACE_INVALID');
      }
      baseline = raw; data = next; blocked = false;
      return clone(data);
    },
    snapshot() { return clone(data); },
    save({ draft, panel = null, state = null, editUsage }) {
      if (blocked || baseline === undefined) fail('WORKSPACE_BLOCKED');
      if (readRaw() !== baseline) { blocked = true; fail('WORKSPACE_CONFLICT'); }
      draft = draftFor(draft);
      const next = clone(data); next.draft = draft;
      if (editUsage !== undefined) next.editUsage = validateWorkbenchEditUsage(editUsage);
      if (panel) {
        const values = validatePanelState(panel.spec, state ?? panel.state), authored = identity(panel);
        let entry = next.versions.find(item => identity(item.panel) === authored);
        if (!entry) {
          entry = { id: nextId(), savedAt: now(), panel: clone(panel), state: values, draft };
          next.versions.push(entry);
        }
        if (canonicalJson(entry.state) !== canonicalJson(values) || canonicalJson(entry.draft) !== canonicalJson(draft)) entry.savedAt = now();
        entry.state = clone(values); entry.draft = draft; next.currentId = entry.id;
      } else if (next.currentId) fail('WORKSPACE_PANEL_REQUIRED');
      // Drop oldest inactive versions first; never evict the active panel to claim a successful save.
      let removed = 0;
      while (next.versions.length > limits.versions || JSON.stringify(next).length > limits.chars) {
        const index = next.versions.findIndex(item => item.id !== next.currentId);
        if (index < 0) fail('WORKSPACE_TOO_LARGE');
        next.versions.splice(index, 1); removed++;
      }
      if (JSON.stringify(next) === baseline) return { workspace: clone(next), removed };
      return { workspace: write(next), removed };
    },
    // Start a blank workspace while retaining saved panels and their edit usage.
    startNew() {
      const next = { ...clone(data), draft: emptyWorkbenchDraft(), currentId: null };
      if (blocked || baseline === undefined) fail('WORKSPACE_BLOCKED');
      if (readRaw() !== baseline) { blocked = true; fail('WORKSPACE_CONFLICT'); }
      return JSON.stringify(next) === baseline ? clone(data) : write(next);
    },
    // Clear only this Studio's key after an explicit user action, even if its old data is unreadable.
    reset() {
      baseline = readRaw(); blocked = false;
      return write(empty());
    },
    backup() { return readRaw(); },
  });
}

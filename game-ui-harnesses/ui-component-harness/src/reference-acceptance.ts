import { validateBundle, bundleResources, type UiBundle } from './bundle.ts';
import { createTreePreview, type TreePreview } from './tree-runtime.ts';
import { validatePersistedHandoff } from './reference-persistence.ts';
import { replayReferenceState } from './reference-replay.ts';
import { compareReference, mappedReference } from './reference-visual.ts';
import type { ReferenceEvidence } from './reference-evidence.ts';

let runtime: TreePreview | undefined, evidence: ReferenceEvidence;
let fatal: unknown;
const events: unknown[] = [];
const api = {
  async load(input: UiBundle) {
    runtime?.destroy(); runtime = undefined; fatal = undefined; events.length = 0;
    const bundle = await validateBundle(input);
    evidence = bundle.componentHandoff ? await validatePersistedHandoff(bundle.componentHandoff, bundle) : { status: 'missing_reference_evidence', visualComparisonReady: false, unknownFields: [], humanVisualAcceptance: false, files: [] };
    const resources = new Map(bundleResources(bundle).map(r => [r.path, r]));
    runtime = await createTreePreview(document.getElementById('runtime')!, error => { fatal = String(error); });
    runtime.subscribe(event => events.push(event));
    try {
      await runtime.load(bundle.document, new AbortController().signal, async path => {
        const resource = resources.get(path.replace(/^\.\//, '')); if (!resource) throw new Error('MISSING_LOCAL_RESOURCE');
        const url = URL.createObjectURL(new Blob([new Uint8Array(resource.bytes).buffer], { type: resource.mime }));
        try { const image = new Image(); image.src = url; await image.decode(); return image; } finally { URL.revokeObjectURL(url); }
      }, async path => { const r = resources.get(path.replace(/^\.\//, '')); if (!r) throw new Error('MISSING_LOCAL_FONT'); return new Uint8Array(r.bytes).buffer; });
      if (evidence.status === 'complete') replayReferenceState(evidence, runtime);
      await api.settle(); return api.inspect();
    } catch (error) { runtime.destroy(); runtime = undefined; throw error; }
  },
  async settle() { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); if (fatal) throw new Error(String(fatal)); },
  inspect() { if (!runtime) throw new Error('NO_RUNTIME'); return { inspection: runtime.inspect(), document: runtime.getDocument(), events, evidenceStatus: evidence.status, unknownFields: evidence.unknownFields, human_visual_acceptance: false }; },
  async replay() { if (!runtime) throw new Error('NO_RUNTIME'); const result = replayReferenceState(evidence, runtime); await api.settle(); return result; },
  async compare(screenshot: string) {
    if (!runtime) throw new Error('NO_RUNTIME');
    const image = new Image(); image.src = `data:image/png;base64,${screenshot}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; canvas.getContext('2d')!.drawImage(image, 0, 0);
    return compareReference(evidence, runtime.inspect(), canvas);
  },
  async mapped() { return (await mappedReference(evidence)).toDataURL('image/png').split(',')[1]; },
  destroy() { runtime?.destroy(); runtime = undefined; },
};
(window as any).referenceAcceptance = api;

/** Provider-neutral layer ZIP -> complete model plan -> strict source-bound bundle DAG. */
import { compileLayerComponents, intakeLayerComponents, layerSha256, validateLayerComponentPlan, type LayerComponentPlan } from './layer-component.ts';
import { importLayerPackage, type Layer } from './layer-package.ts';
import { validateDocument } from './tree-contract.ts';
import { validateLayerPlanningEvidence, isPortableLayerPlanningNote, LayerPlanningUnresolvedError,
  LayerPlanningIncompleteError, validateLayerPlanningDiagnostic } from './layer-planning-evidence.ts';
import type { UiBundle } from './bundle.ts';
import { LAYER_ADAPTATION_POLICY_V1 } from './layer-adaptation.ts';
import { bindLayerSemanticInputs, type BoundLayerSemanticInputs } from './layer-semantic-inputs.ts';

export type LayerAutoStage = 'intake' | 'session-plan' | 'validate' | 'compile';
export interface LayerAutoNode { stage: LayerAutoStage; status: 'complete' | 'blocked' }
export interface LayerPlanningInput {
  version: '1.0'; archiveSha256: string; canvas: { width: number; height: number };
  textPolicy: string; layers: readonly Layer[]; reviewIssues: readonly string[];
  reference: { path: 'reference.png'; sha256: string; bytes: Uint8Array };
  adaptationPolicy: typeof LAYER_ADAPTATION_POLICY_V1;
  responseVersion: '1.1';
  semanticInputs?: BoundLayerSemanticInputs;
}
export interface LayerAutoDagResult {
  kind: 'ui-layer-auto-dag-result'; version: '2.0'; status: 'draft_pending_visual_review';
  archiveSha256: string; referenceSha256: string; responseSha256: string;
  automaticRetries: 0; humanVisualAcceptance: false;
  nodes: LayerAutoNode[]; issues: string[]; plan: LayerComponentPlan; bundle: UiBundle;
}
export class LayerAutoDagError extends Error {
  readonly stage: LayerAutoStage; readonly nodes: LayerAutoNode[];
  constructor(stage: LayerAutoStage, nodes: LayerAutoNode[], cause: unknown) {
    super(`LAYER_AUTO_${stage.toUpperCase().replaceAll('-', '_')}_BLOCKED`, { cause });
    this.stage = stage; this.nodes = nodes;
  }
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonical(row[key])}`).join(',')}}`;
}
export async function layerPlanningInput(bytes: Uint8Array, options: { semanticInputs?: unknown } = {}): Promise<LayerPlanningInput> {
  const semanticInputs = options.semanticInputs === undefined ? undefined : await bindLayerSemanticInputs(options.semanticInputs);
  const intake = await intakeLayerComponents(bytes), pack = await importLayerPackage(bytes);
  const reference = pack.files.get('reference.png');
  if (!reference) throw new Error('LAYER_AUTO_REFERENCE_MISSING');
  return { version: '1.0', archiveSha256: intake.archiveSha256, canvas: intake.canvas,
    textPolicy: intake.textPolicy, layers: intake.layers, reviewIssues: intake.reviewIssues,
    reference: { path: 'reference.png', sha256: await layerSha256(reference), bytes: new Uint8Array(reference) },
    adaptationPolicy: LAYER_ADAPTATION_POLICY_V1, responseVersion: '1.1', ...(semanticInputs ? { semanticInputs } : {}) };
}
/** Validate every model decision against authenticated inputs; no rule-based plan synthesis. */
export async function validateLayerProposal(bytes: Uint8Array, input: LayerPlanningInput, value: unknown): Promise<LayerComponentPlan> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('LAYER_PLANNING_RESPONSE_INVALID');
  const row = structuredClone(value) as Record<string, unknown>;
  const keys = ['version', 'archiveSha256', 'referenceSha256', 'status', 'summary', 'plan', 'findings', 'issues',
    ...(row.version === '1.1' ? ['reason', 'missingInputs'] : [])];
  if (Object.keys(row).sort().join('|') !== keys.sort().join('|') || !['1.0', '1.1'].includes(String(row.version))
    || row.archiveSha256 !== input.archiveSha256 || row.referenceSha256 !== input.reference.sha256
    || !isPortableLayerPlanningNote(row.summary, 2000)
    || !Array.isArray(row.findings) || !Array.isArray(row.issues)) throw new Error('LAYER_PLANNING_RESPONSE_INVALID');
  if (row.version === '1.1') {
    if (row.reason === 'construction-incomplete' || row.reason === 'required-semantics-missing') {
      const diagnostic = validateLayerPlanningDiagnostic({ summary: row.summary, issues: row.issues,
        reason: row.reason, missingInputs: row.missingInputs });
      if (row.reason === 'construction-incomplete') {
        if (!['Draft', 'Unresolved'].includes(String(row.status))) throw new Error('LAYER_PLANNING_RESPONSE_INVALID');
        throw new LayerPlanningIncompleteError(diagnostic);
      }
      if (row.status !== 'Unresolved' || row.plan !== null) throw new Error('LAYER_PLANNING_RESPONSE_INVALID');
      throw new LayerPlanningUnresolvedError(diagnostic);
    }
    if (row.reason !== 'none' || !Array.isArray(row.missingInputs) || row.missingInputs.length !== 0) throw new Error('LAYER_PLANNING_RESPONSE_INVALID');
  } else if (row.status === 'Unresolved' && row.plan === null) {
    // Historical output has no structured reason. Preserve its terminal meaning.
    throw new LayerPlanningUnresolvedError({ summary: row.summary, issues: row.issues });
  }
  if (row.status !== 'Draft' || !row.plan || typeof row.plan !== 'object' || Array.isArray(row.plan)) throw new Error('LAYER_PLANNING_RESPONSE_INVALID');
  const candidate = row.plan as Record<string, unknown>;
  if (candidate.basis !== 'model-proposed' || Object.hasOwn(candidate, 'planningEvidence') || Object.hasOwn(candidate, 'semanticInputs')
    || !isPortableLayerPlanningNote(candidate.requirements, 500)) throw new Error('LAYER_PLANNING_PLAN_INVALID');
  const document = validateDocument(candidate.document);
  const responseSha256 = await layerSha256(new TextEncoder().encode(canonical(row)));
  const planningEvidence = validateLayerPlanningEvidence({ version: '1.0', referenceSha256: input.reference.sha256,
    responseSha256, findings: row.findings, issues: row.issues }, document);
  return validateLayerComponentPlan({ ...candidate, planningEvidence, ...(input.semanticInputs ? { semanticInputs: input.semanticInputs } : {}) }, input.archiveSha256, await importLayerPackage(bytes));
}
/** One callback per click; an optional planner may own bounded corrections internally. No callback resubmission. */
export async function runLayerAutoDag(bytes: Uint8Array, plan: (input: LayerPlanningInput) => Promise<unknown>, options: { semanticInputs?: unknown } = {}): Promise<LayerAutoDagResult> {
  const nodes: LayerAutoNode[] = []; let stage: LayerAutoStage = 'intake';
  try {
    const archive = new Uint8Array(bytes);
    const input = await layerPlanningInput(archive, options); nodes.push({ stage, status: 'complete' });
    stage = 'session-plan'; const proposal = await plan(structuredClone(input)); nodes.push({ stage, status: 'complete' });
    stage = 'validate'; const validated = await validateLayerProposal(archive, input, proposal); nodes.push({ stage, status: 'complete' });
    stage = 'compile'; const bundle = await compileLayerComponents(archive, validated); nodes.push({ stage, status: 'complete' });
    return { kind: 'ui-layer-auto-dag-result', version: '2.0', status: 'draft_pending_visual_review',
      archiveSha256: input.archiveSha256, referenceSha256: input.reference.sha256,
      responseSha256: validated.planningEvidence!.responseSha256, automaticRetries: 0, humanVisualAcceptance: false,
      nodes, issues: validated.planningEvidence!.issues, plan: validated, bundle };
  } catch (error) { nodes.push({ stage, status: 'blocked' }); throw new LayerAutoDagError(stage, nodes, error); }
}

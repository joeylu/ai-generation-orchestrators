import { importDecompositionZip, type ImportedDecomposition } from './decomposition-import.ts';
import { createBundle, validateBundle, type UiBundle } from './bundle.ts';
import { compileImportedAssets } from './component-handoff.ts';
import { compileSemanticObservation, NEUTRAL_SEMANTIC_PREVIEW_POLICY_V1 } from './vision-semantic-compiler.ts';
import { appearanceDocumentSha256 } from './appearance-binding.ts';
import { encodeArchive } from './reference-persistence.ts';
import { walkNodes } from './tree-contract.ts';

export interface AssetsPlanningInput {
  kind: 'ui-assets-planning-input'; schemaVersion: '1.0'; archiveSha256: string;
  /** Explicit user text, separate from visual observations. Presence is not business acceptance. */
  requirements: string;
  basis: 'programmatic-fixture' | 'agent-reviewed';
  openQuestions: string[];
  observation?: unknown;
  target?: unknown;
  binding?: unknown;
}
interface Diagnostic { code: string; detail: string }
function report(imported: ImportedDecomposition) {
  const evidence = imported.assetsPackage;
  return {
    kind:'ui-assets-intake' as const, schemaVersion:'1.0' as const,
    format:evidence?'assets-package-v2':'legacy-png-zip', archiveSha256:imported.archiveSha256,
    sceneSha256:imported.sceneSha256, deliveryDigest:imported.deliveryDigest, canvas:imported.canvas,
    layers:imported.layers, materialReview:imported.review,
    sourceEvidence:evidence ? {manifestSha256:evidence.manifestSha256,manifest:evidence.manifest,
      original:{path:evidence.original.path,mime:evidence.original.mime,base64:encodeArchive(evidence.original.bytes)}} : null,
    materialIntegrity:'verified', semantics:'not_planned', binding:'not_planned', businessAcceptance:'not_run',
    referenceAcceptance:'blocked', referenceReason:'MISSING_REFERENCE_EVIDENCE', humanVisualAcceptance:false,
    diagnostics:[
      ...(!evidence?[{code:'ORIGINAL_AND_MAPPING_MISSING',detail:'Legacy materials remain usable with explicit semantics and binding; original reference is absent.'}]:[]),
      ...(evidence?.manifest.scope.type === 'supplemental'?[{code:'ASSETS_SUPPLEMENT_REQUIRES_MERGE',detail:'Merge with the exact declared complete base before building.'}]:[]),
      {code:'USER_REQUIREMENTS_REQUIRED',detail:'Supply explicit business requirements independently; image pixels do not define hidden behavior.'},
      {code:'AGENT_SEMANTICS_AND_BINDING_REQUIRED',detail:'Review original, mapping and facts; author semantics and appearance binding. No model is called by this command.'},
      ...(evidence?.manifest.missingParts.map((row: any) => ({code:'DECLARED_MISSING_PART',detail:row.description,evidence:row.evidence}))??[]),
    ],
  };
}
/** A single authenticated material input, with explicit planning and acceptance boundaries. */
export async function intakeAssets(input: Uint8Array) { return report(await importDecompositionZip(input)); }

/** Agent supplies the decisions; deterministic code validates/compiles them without service calls. */
export async function planAssets(input: Uint8Array, raw: unknown) {
  const imported = await importDecompositionZip(input), intake = report(imported);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('ASSETS_PLANNING_INPUT');
  const value = raw as AssetsPlanningInput, keys = Object.keys(value);
  const required = ['kind','schemaVersion','archiveSha256','requirements','basis','openQuestions'];
  if (required.some(k=>!Object.hasOwn(value,k)) || keys.some(k=>![...required,'observation','target','binding'].includes(k))
    || value.kind !== 'ui-assets-planning-input' || value.schemaVersion !== '1.0' || value.archiveSha256 !== imported.archiveSha256
    || typeof value.requirements !== 'string' || !['programmatic-fixture','agent-reviewed'].includes(value.basis)
    || !Array.isArray(value.openQuestions) || value.openQuestions.some(q=>typeof q!=='string'||!q.trim())
    || (Object.hasOwn(value,'observation') && Object.hasOwn(value,'target'))) throw new Error('ASSETS_PLANNING_INPUT');
  const diagnostics: Diagnostic[] = [];
  if (!value.requirements.trim()) diagnostics.push({code:'USER_REQUIREMENTS_REQUIRED',detail:'No business requirements supplied.'});
  diagnostics.push(...value.openQuestions.map(detail=>({code:'OPEN_BUSINESS_QUESTION',detail})));
  if (imported.assetsPackage?.manifest.scope.type === 'supplemental') diagnostics.push({code:'ASSETS_SUPPLEMENT_REQUIRES_MERGE',detail:'Supplemental material cannot build independently.'});
  let target: UiBundle | undefined;
  if (Object.hasOwn(value,'target')) { target = await validateBundle(value.target); if (target.document.schemaVersion !== '0.2') throw new Error('ASSETS_SEMANTIC_TARGET_VERSION'); }
  else if (Object.hasOwn(value,'observation')) {
    const evidence = imported.assetsPackage;
    if (!evidence) diagnostics.push({code:'ORIGINAL_AND_MAPPING_REQUIRED',detail:'Observation compilation requires a source-bound original from v2.'});
    else {
      const file = evidence.manifest.files.find((row:any)=>row.path===evidence.original.path);
      const compiled = compileSemanticObservation(value.observation,{path:file.path,sha256:file.sha256,width:file.width,height:file.height},NEUTRAL_SEMANTIC_PREVIEW_POLICY_V1);
      if (compiled.status === 'Ready') target = await createBundle(compiled.document,
        walkNodes(compiled.document).some(node=>node.type==='Image'&&node.props.source===file.path)?[evidence.original]:[],
        {kind:value.basis==='programmatic-fixture'?'programmatic-fixture':'vision-reviewed',description:`Offline reviewed observation compile; neutral procedural policy. User requirements: ${value.requirements}`});
      else diagnostics.push(...compiled.missing.map(row=>({code:'MISSING_SEMANTIC_FIELD',detail:`${row.componentId}.${row.field}: ${row.reason}`})));
    }
  }
  if (!target) diagnostics.push({code:'SEMANTIC_TARGET_REQUIRED',detail:'Supply reviewed source-bound observation or an explicit target bundle; no automatic business inference is performed.'});
  if (!Object.hasOwn(value,'binding')) diagnostics.push({code:'APPEARANCE_BINDING_REQUIRED',detail:'Agent must explicitly bind required component parts and states to authenticated layers.'});
  let bundle: UiBundle | undefined;
  if (target && Object.hasOwn(value,'binding') && diagnostics.length===0) {
    try { bundle = (await compileImportedAssets(imported,target,value.binding)).bundle; }
    catch (error) { diagnostics.push({code:'BUILD_VALIDATION_FAILED',detail:error instanceof Error?error.message:String(error)}); }
  }
  return {...intake,kind:'ui-assets-plan',requirements:value.requirements,basis:value.basis,modelRecognition:'not_run',
    semantics:target?'validated':'unresolved',binding:bundle?'validated':'unresolved',status:bundle?'build_ready':'needs_input',diagnostics,
    ...(target?.document.schemaVersion==='0.2'?{target,documentSha256:await appearanceDocumentSha256(target.document)}:{}),...(bundle?{bundle}:{}),
    materialObservations:intake.diagnostics.filter(d=>d.code==='DECLARED_MISSING_PART'),
  };
}

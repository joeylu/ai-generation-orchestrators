import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as api from '../../src/generation/index.mjs';
import * as project from '../../src/reference-led-pipeline.mjs';
import { REFERENCE_STANDARDS } from '../../src/reference-measurement.mjs';
import { controlGuideRecipe, renderControlGuides, compileProjectionFocusPrompt } from '../../src/reference-controls.mjs';
import { encodeRgbaPng } from '../../src/png.mjs';
import { seal, unseal, hash, jsonBytes } from '../../src/generation/common.mjs';
import { setup, decision, authorizeAndReserve } from './generation.mjs';

export function syntheticControlImage(seed = 0) {
  const rgba = Buffer.alloc(512 * 288 * 4, 255);
  for (let p = 0; p < rgba.length; p += 4) rgba[p] = (p / 4 + seed) % 192;
  return encodeRgbaPng(512, 288, rgba);
}
export function controlFixture(t, { rejected = true, custom = false, maxImages = 5 } = {}) {
  const f = setup(t), input = join(f.parent, 'style.png'); writeFileSync(input, syntheticControlImage(4));
  const brief = { projectId: 'controlled.fixture', description: 'Synthetic ground and sky, no required foreground.', viewport: { width: 256, height: 144 }, maxAspectErrorPermille: 5,
    inputs: [{ role: 'style-reference', path: input }], style: custom
      ? { mode: 'custom', preset: null, name: 'Synthetic custom', rules: ['Synthetic brushwork.'], anchorPath: input }
      : { mode: 'preset', preset: 'clean-handpaint', name: '', rules: [], anchorPath: null },
    requirements: seal({ format: 'ai_scene_reference_requirements_v1', requirementsId: 'control.requirements',
      layers: [{ layerId: 'sky', kind: 'background', zIndex: 0, parallaxX: 0 }, { layerId: 'ground', kind: 'terrain', zIndex: 10, parallaxX: 1 }],
      subjects: [{ subjectId: 'sky', layerId: 'sky', role: 'sky', content: 'Synthetic sky.', count: { min: 1, max: 1 }, placementHint: 'wide' },
        { subjectId: 'ground', layerId: 'ground', role: 'solid-terrain', content: 'Synthetic ground.', count: { min: 1, max: 1 }, placementHint: 'wide' }],
      compositionNotes: ['Actual layout after review.'], standards: REFERENCE_STANDARDS.map(key => ({ key, requirement: `Synthetic ${key} rule.` })) }) };
  const state = project.initReferenceLedProject(f.root, brief, { purpose: 'synthetic-simulation' }), workflow = join(f.root, 'workflow');
  project.reviewReferenceLedDesign(f.root, { spec: decision('spec', state.design.specSha256), style: decision('style', state.design.styleSha256) });
  const spec = JSON.parse(readFileSync(join(f.root, 'spec-draft.json'))), style = JSON.parse(readFileSync(join(f.root, 'style-draft.json')));
  const cap = api.createDesignDraft(workflow, { ...unseal(JSON.parse(readFileSync(join(f.root, 'capabilities.json')))), capabilityId: 'controls.host', maxInputImages: maxImages });
  const baseline = api.freezeReferenceLedPlan(workflow, { planId: 'baseline', parents: [], capabilitiesSha256: cap.sha256,
    pixelPolicy: { mode: 'native-reference', orientation: 'landscape', minimumShortEdge: 256, maximumWidth: 1024, maximumHeight: 1024 }, intent: 'Synthetic baseline.' });
  const ticket = authorizeAndReserve(workflow, baseline); api.recordSubmission(workflow, ticket);
  const result = api.receiveResult(workflow, ticket, syntheticControlImage());
  const rejection = rejected ? api.reviewResult(workflow, baseline.sha256, decision('baseline.reject', result.rawSha256, 'reject')) : null;
  const artifacts = renderControlGuides(), prompt = compileProjectionFocusPrompt(spec, style);
  const guideChecks = ['projection-guide.png', 'focus-guide.png'].map(path => ({ path, sha256: hash(artifacts.get(path)), byteLength: artifacts.get(path).length,
    width: 512, height: 512, opaque: true, discretePaletteColors: 4, replayIdentical: true, humanSemanticReview: 'pending' }));
  const proposal = seal({ format: 'ai_scene_projection_focus_control_proposal_v1', specSha256: spec.sha256, styleSha256: style.sha256,
    requirementsSha256: spec.requirements.sha256, rejectedPlanSha256: baseline.sha256, rejectedRawSha256: result.rawSha256,
    rejectionSha256: rejection?.sha256 ?? hash(Buffer.from('unreviewed-fixture')), guideRecipeSha256: controlGuideRecipe.sha256,
    promptDraftSha256: hash(Buffer.from(prompt)), pixelLocking: false,
    proposedModelInputs: guideChecks.map((g, i) => ({ ...g, role: i === 0 ? 'internal-projection-example' : 'internal-focus-example' })) });
  artifacts.set('guide-recipe.json', jsonBytes(controlGuideRecipe)); artifacts.set('proposal.json', jsonBytes(proposal));
  artifacts.set('checklist.json', jsonBytes(seal({ format: 'ai_scene_projection_focus_review_checklist_v1', requirementsSha256: spec.requirements.sha256 })));
  artifacts.set('prompt-draft.txt', Buffer.from(prompt)); artifacts.set('README.md', Buffer.from('Synthetic reviewed control evidence; not real art.'));
  const packet = seal({ format: 'ai_scene_projection_focus_control_review_packet_v1', proposalSha256: proposal.sha256,
    specSha256: spec.sha256, styleSha256: style.sha256, requirementsSha256: spec.requirements.sha256,
    artifacts: [...artifacts].map(([path, bytes]) => ({ path, sha256: hash(bytes), byteLength: bytes.length })), technicalGuideChecks: guideChecks,
    humanDesignAcceptance: 'pending', scope: 'control-design-only-no-compute', generationRuntimeSupport: 'not-implemented', generationCalls: 0, frozenGenerationPlansAdded: 0 });
  return { ...f, workflow, spec, style, cap, baseline, result, rejection, artifacts, packet };
}
export function importedControls(f, accept = true) {
  const c = api.importReferenceControls(f.workflow, { controlId: 'controls.r1', sourcePlanSha256: f.baseline.sha256, reviewPacket: f.packet }, f.artifacts);
  if (accept) api.reviewReferenceControls(f.workflow, c.sha256, decision('controls.accept', f.packet.sha256));
  return { c, options: { planId: 'controlled.r1', controlsSha256: c.sha256 } };
}
export function reboundPacket(f) {
  const body = unseal(f.packet), proposal = JSON.parse(f.artifacts.get('proposal.json'));
  return seal({ ...body, proposalSha256: proposal.sha256,
    artifacts: [...f.artifacts].map(([path, bytes]) => ({ path, sha256: hash(bytes), byteLength: bytes.length })) });
}
export function controlMeasurement(plan, rawSha256) {
  const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  return seal({ format: 'ai_scene_measured_reference_layout_v1', planSha256: plan.sha256, rawSha256, coordinates: 'canonical-reference-frame',
    layers: plan.referenceRequirements.layers,
    instances: [{ instanceId: 'sky.actual', subjectId: 'sky', layerId: 'sky', visibleEnvelope: rect(0, 0, 256, 94), anchor: { x: 0, y: 0 },
      visibility: 'frame-clipped', anchorEvidence: 'observed', notes: 'Synthetic sky observation only.' },
    { instanceId: 'ground.actual', subjectId: 'ground', layerId: 'ground', visibleEnvelope: rect(0, 94, 256, 50), anchor: { x: 0, y: 94 },
      visibility: 'frame-clipped', anchorEvidence: 'observed', notes: 'Synthetic ground observation only.' }],
    surfaces: [{ surfaceId: 'top', instanceId: 'ground.actual', points: [{ x: 0, y: 94 }, { x: 256, y: 94 }], evidence: 'observed', notes: 'Synthetic visible surface.' }],
    quality: REFERENCE_STANDARDS.map(key => ({ key, verdict: 'pass', notes: `Synthetic ${key}, test-double evidence only.` })) });
}

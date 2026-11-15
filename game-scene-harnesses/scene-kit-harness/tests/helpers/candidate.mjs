import { join } from 'node:path';
import * as api from '../../src/generation/index.mjs';
import { syntheticTerrainMaterial } from '../../scripts/terrain-fixture.mjs';
import { authorizeAndReserve, decision } from './generation.mjs';
import { prepareFiniteEnvironment } from './finite-environment.mjs';

export function prepareCandidate(t) {
  const c = prepareFiniteEnvironment(t); c.accept();
  const material = api.freezeTerrainMaterialPlan(c.root, { planId: 'candidate.material', parents: [], referencePlanSha256: c.reference.sha256,
    capabilitiesSha256: c.capabilities.sha256, intent: 'Synthetic complete candidate packaging fixture.' });
  const result = api.receiveResult(c.root, authorizeAndReserve(c.root, material), syntheticTerrainMaterial());
  api.reviewResult(c.root, material.sha256, decision('candidate.material.accept', result.rawSha256));
  const terrainRoots = { originalRoot: join(c.parent, 'proof'), revisionRoot: join(c.parent, 'revision'), studyRoot: join(c.parent, 'study') };
  api.buildTerrainProofBundle(c.root, material.sha256, terrainRoots.originalRoot);
  api.reviseTerrainProofBundle(c.root, material.sha256, terrainRoots.originalRoot, terrainRoots.revisionRoot);
  api.buildTerrainContinuityStudy(c.root, material.sha256, terrainRoots.originalRoot, terrainRoots.revisionRoot, terrainRoots.studyRoot);
  const options = { candidateId: 'scene.candidate.fixture', materialPlanSha256: material.sha256, environmentPlanSha256: c.plan.sha256,
    environmentOptions: c.options }, out = join(c.parent, 'candidate');
  return { ...c, material, terrainRoots, candidateOptions: options, out,
    build: () => api.buildSceneCandidate(c.root, c.kit, options, terrainRoots, out) };
}

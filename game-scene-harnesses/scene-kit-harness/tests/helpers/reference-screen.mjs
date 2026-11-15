import { join } from 'node:path';
import { prepareReviewCandidate } from './review-candidate.mjs';
import * as api from '../../src/generation/index.mjs';

export function prepareReferenceScreen(t) {
  const c = prepareReviewCandidate(t), screenOptions = { studyId: 'forest.ruins.reference.composition.fixture', layoutRevision: 'framed-v3', reviewCandidate: c.reviewOptions };
  const screenOut = join(c.parent, 'screen');
  return { ...c, screenOptions, screenOut,
    buildScreen: () => api.buildSceneReferenceStudy(c.root, c.kit, screenOptions, c.terrainRoots, screenOut) };
}

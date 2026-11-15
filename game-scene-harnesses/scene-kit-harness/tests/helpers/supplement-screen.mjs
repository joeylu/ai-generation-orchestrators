import { join } from 'node:path';
import { prepareReferenceScreen } from './reference-screen.mjs';
import { encodeRgbaPng } from '../../src/png.mjs';
import * as api from '../../src/generation/index.mjs';
import { complete } from './generation.mjs';

export function prepareSupplementScreen(t) {
  const c = prepareReferenceScreen(t), sources = {};
  const definitions = { foliage: ['foreground-foliage', 768, 256], 'distant-ruins': ['distant-ruins', 1024, 384],
    platform: ['floating-platform-shell', 384, 192], water: ['valley-water', 768, 256] };
  for (const [key, [role, width, height]] of Object.entries(definitions)) {
    const freeze = key === 'foliage' ? api.freezeEnvironmentSourcePlanV2 : api.freezeEnvironmentSupplementPlan;
    const plan = freeze(c.root, { planId: `supplement.fixture.${key}`, parents: [], referencePlanSha256: c.reference.sha256,
      capabilitiesSha256: c.capabilities.sha256, assetId: `supplement.fixture.${key}`, role,
      sourcePolicy: { mode: 'native-environment', orientation: 'landscape', minimumWidth: 512, minimumHeight: 256, maximumWidth: 4096, maximumHeight: 4096 },
      derivation: { pixelSize: { width, height }, fit: api.ENVIRONMENT_SOURCE_PROFILE.derivation.block, repeatAxis: 'none' }, intent: 'Synthetic source for composition/attachment regression.' });
    const w = 1024, h = 576, rgba = Buffer.alloc(w * h * 4);
    for (let y = 200; y < 440; y++) for (let x = 96; x < 928; x++) {
      if (key === 'platform' && (x < 96 + (y - 200) || x >= 928 - (y - 200))) continue;
      rgba.set([key === 'water' ? 60 : 95 + x % 80, 110 + y % 80, key === 'water' ? 210 : 75, y === 200 ? 190 : 255], (y * w + x) * 4);
    }
    complete(c.root, plan, encodeRgbaPng(w, h, rgba)); sources[key] = { planSha256: plan.sha256 };
  }
  const supplementOptions = { studyId: 'forest.ruins.supplement.composition.fixture', referenceStudy: c.screenOptions, sources };
  const supplementOut = join(c.parent, 'supplement-screen');
  return { ...c, supplementOptions, supplementOut,
    buildSupplement: () => api.buildSceneSupplementStudy(c.root, c.kit, supplementOptions, c.terrainRoots, supplementOut) };
}

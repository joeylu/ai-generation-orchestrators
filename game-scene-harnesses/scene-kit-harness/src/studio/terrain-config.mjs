import { dirname, resolve } from 'node:path';
import { readSelectedFile, parseJson } from '../files.mjs';
import { check, exact, isDigest } from '../generation/common.mjs';
import { loadTerrainStudyPreview } from '../generation/index.mjs';

export function loadTerrainPreviewConfig(configPath) {
  const value = parseJson(readSelectedFile(configPath, 16384), 'terrain-preview-config.json');
  exact(value, ['format', 'workflowRoot', 'materialPlanSha256', 'originalRoot', 'revisionRoot', 'studyRoot']);
  check(value.format === 'ai_scene_terrain_preview_config_v1' && isDigest(value.materialPlanSha256), 'TERRAIN_PREVIEW_CONFIG');
  const directory = dirname(resolve(configPath));
  for (const key of ['workflowRoot', 'originalRoot', 'revisionRoot', 'studyRoot']) check(typeof value[key] === 'string'
    && value[key].length > 0 && value[key].length <= 4096 && !/[\x00-\x1f]/.test(value[key]), 'TERRAIN_PREVIEW_CONFIG');
  return loadTerrainStudyPreview(resolve(directory, value.workflowRoot), value.materialPlanSha256,
    resolve(directory, value.originalRoot), resolve(directory, value.revisionRoot), resolve(directory, value.studyRoot));
}

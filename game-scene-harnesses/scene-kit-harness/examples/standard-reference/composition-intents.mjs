import { seal } from '../../src/generation/common.mjs';

const pairs = values => values.map(([x, y]) => ({ x, y }));
const rect = (x, y, w, h) => pairs([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
const layer = (layerId, kind, zIndex, parallaxX) => ({ layerId, kind, zIndex, parallaxX });
const band = (min, max = min) => ({ min, max });
const hard = (instanceId, layerId, content, polygon, anchor) => ({ instanceId, layerId, role: layerId === 'platform' ? 'solid-platform' : 'solid-terrain',
  content, polygon: pairs(polygon), anchor: { x: anchor[0], y: anchor[1] } });
function art(instanceId, layerId, role, content, side, width, height, top, occupancy = [200, 850], bottom = false) {
  return { instanceId, layerId, role, content,
    placement: { side, vertical: bottom ? 'frame-bottom' : 'free', widthPermille: band(...width), heightPermille: band(...height), topPermille: band(...top) },
    occupancyPermille: band(...occupancy), maxOutsidePermille: 0, anchorBandPermille: band(0, 1000) };
}
// Named authoring examples, not keyword routes or the default for arbitrary
// content. The Agent can author any other compatible structured intent.
export function compositionExample(name, { seed = 17, mass = 'balanced' } = {}) {
  const base = { format: 'ai_scene_composition_intent_v1', designId: `example.${name}`, sceneDescription: '', viewport: { width: 1024, height: 576 }, seed,
    layers: [], hardInstances: [], artSubjects: [], protectedRegions: [],
    tolerances: { maxAnchorErrorPx: 12, minEnvelopeIoUPermille: 850, maxAspectErrorPermille: 5 },
    composition: { mass, minimumSeparationPx: 12, shapeLanguage: 'Create silhouettes appropriate to the chosen art style, with clear depth separation and low texture noise.' } };
  const sky = () => art('sky', 'sky', 'sky', '完整天空，具体色彩和云形随画风决定。', 'wide', [1000], [1000], [0], [1000, 1000]);
  if (name === 'snow-valley') {
    base.sceneDescription = '雪山古堡开谷：两侧覆雪地形、中央悬浮台、冷蓝远山和右侧灰石古堡。左右前景分别入画，保留中央谷地。';
    base.layers = [layer('sky', 'background', 0, 0), layer('mountains', 'background', 10, 0.15), layer('castle', 'environment', 20, 0.4),
      layer('trees', 'environment', 30, 0.65), layer('ground', 'terrain', 40, 1), layer('platform', 'terrain', 50, 1), layer('foreground', 'foreground', 60, 1.15)];
    base.hardInstances = [hard('ground-left', 'ground', '左侧覆雪岩体与两级表沿。', [[0, 416], [192, 416], [192, 400], [352, 400], [352, 576], [0, 576]], [192, 400]),
      hard('ground-right', 'ground', '右侧覆雪岩体。', [[688, 432], [816, 432], [816, 400], [1024, 400], [1024, 576], [688, 576]], [816, 400]),
      hard('platform', 'platform', '三格宽实心悬浮台，表沿严格侧视。', [[432, 320], [624, 320], [624, 372], [432, 372]], [528, 320])];
    base.artSubjects = [sky(), art('mountains', 'mountains', 'mountain-range', '远处雪山，山形随画风自由设计。', 'wide', [1000], [450, 560], [100, 160]),
      art('castle', 'castle', 'castle', '右侧灰石古堡，塔楼和外轮廓自由设计。', 'right', [260, 350], [340, 430], [200, 260]),
      art('pines-left', 'trees', 'snow-pines', '左侧覆雪松树群。', 'left', [180, 260], [260, 340], [340, 400]),
      art('pines-right', 'trees', 'snow-pines', '右侧覆雪松树群。', 'right', [160, 240], [230, 310], [350, 410]),
      art('foreground-left', 'foreground', 'snow-rock-edge', '左前景完整覆雪岩沿，从左下画框入画。', 'frame-left', [220, 300], [190, 260], [0], [250, 850], true),
      art('foreground-right', 'foreground', 'snow-rock-edge', '右前景完整覆雪岩沿，从右下画框入画。', 'frame-right', [190, 270], [160, 240], [0], [250, 850], true)];
    base.protectedRegions = [{ regionId: 'valley', purpose: '前景不得覆盖中央谷地。', polygon: rect(384, 392, 272, 184),
      forbiddenInstanceIds: ['foreground-left', 'foreground-right'], maxOccludedPermille: 0 },
    { regionId: 'platform-top', purpose: '保留悬浮台表沿。', polygon: rect(432, 312, 192, 16), forbiddenInstanceIds: ['foreground-left', 'foreground-right'], maxOccludedPermille: 0 }];
  } else if (name === 'forest-slope') {
    base.sceneDescription = '森林缓坡：连续起伏的苔草地面，远处山丘和两侧树群，左下少量前景。没有城堡、悬浮台或中央峡谷。';
    base.layers = [layer('sky', 'background', 0, 0), layer('hills', 'background', 10, 0.2), layer('trees', 'environment', 20, 0.65),
      layer('ground', 'terrain', 30, 1), layer('foreground', 'foreground', 40, 1.15)];
    base.hardInstances = [hard('ground', 'ground', '连续缓坡地形，遵守上缘折线，保留实心岩土截面。',
      [[0, 444], [128, 444], [256, 416], [384, 416], [512, 384], [640, 384], [768, 416], [896, 432], [1024, 432], [1024, 576], [0, 576]], [512, 384])];
    base.artSubjects = [sky(), art('hills', 'hills', 'hills', '远处柔和山丘，不包含雪山古堡。', 'wide', [1000], [340, 450], [200, 260]),
      art('trees-left', 'trees', 'forest-trees', '左侧自然林木群，树冠与树干轮廓随画风决定。', 'left', [300, 420], [400, 480], [180, 240]),
      art('trees-right', 'trees', 'forest-trees', '右侧自然林木群。', 'right', [260, 380], [340, 450], [210, 270]),
      art('foreground-left', 'foreground', 'fern-edge', '左下方少量蕨叶前景，保留地形走势。', 'frame-left', [160, 230], [110, 170], [0], [200, 650], true)];
    base.protectedRegions = [{ regionId: 'slope-center', purpose: '前景不得遮住中段可玩地形。', polygon: rect(320, 360, 384, 100),
      forbiddenInstanceIds: ['foreground-left'], maxOccludedPermille: 0 }];
  } else if (name === 'desert-canyon') {
    base.sceneDescription = '沙漠峡谷：左右高低不同的砂岩台地，偏左的缺口，远处岩柱与右侧古代石刻。天空开阔，不放森林、悬浮台或近前景。';
    base.layers = [layer('sky', 'background', 0, 0), layer('mesas', 'background', 10, 0.2), layer('ruins', 'environment', 20, 0.45),
      layer('ground', 'terrain', 30, 1)];
    base.hardInstances = [hard('ground-left', 'ground', '左侧较高砂岩台地。', [[0, 352], [288, 352], [288, 576], [0, 576]], [288, 352]),
      hard('ground-right', 'ground', '右侧较低砂岩台地，入口处留缺口。', [[496, 432], [720, 432], [720, 400], [1024, 400], [1024, 576], [496, 576]], [496, 432])];
    base.artSubjects = [sky(), art('mesas-left', 'mesas', 'sandstone-mesas', '左侧远处砂岩岩柱。', 'left', [300, 440], [340, 440], [130, 220]),
      art('mesas-right', 'mesas', 'sandstone-mesas', '右侧远处砂岩山体。', 'right', [340, 460], [290, 390], [180, 250]),
      art('carved-ruins', 'ruins', 'carved-stone', '右侧古代石刻遗迹，不是欧洲城堡。', 'right', [180, 280], [250, 340], [300, 360])];
  } else throw new Error('Unknown explicit composition example');
  return seal(base);
}
export const composedExampleBrief = (name, options) => ({ projectId: `composed.${name}`, intent: compositionExample(name, options), inputs: [],
  style: { mode: 'preset', preset: 'clean-handpaint', name: '', rules: [], anchorPath: null } });

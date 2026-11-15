import { seal } from '../../src/generation/common.mjs';

// Explicit scene recipe, independent of any uploaded image's composition.
export function snowCastleStandardBrief(stylePath = null) {
  const rect = (x, y, width, height) => [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
  const points = pairs => pairs.map(([x, y]) => ({ x, y }));
  const layer = (layerId, kind, zIndex, parallaxX) => ({ layerId, kind, zIndex, parallaxX });
  const item = (instanceId, layerId, role, content, polygon, anchor) => ({ instanceId, layerId, role, content,
    polygon: points(polygon), anchor: { x: anchor[0], y: anchor[1] } });
  const blueprint = seal({ format: 'ai_scene_reference_blueprint_v1', blueprintId: 'snow.standard.layout.r1',
    sceneDescription: '雪山古堡：冰雪地形、冷蓝远山、灰石城堡。纯横版侧视，清爽手绘。两侧覆雪岩壁围出中央谷地，三格实心悬浮台居中上方；左右前景岩沿分别入画，保留谷地开口。',
    projection: 'pure-sideview', viewport: { width: 1024, height: 576 },
    layers: [layer('sky', 'background', 0, 0), layer('mountains', 'background', 10, 0.15), layer('forest', 'environment', 20, 0.3),
      layer('castle', 'environment', 30, 0.4), layer('middle', 'environment', 40, 0.65), layer('arch', 'environment', 50, 1),
      layer('wall', 'environment', 60, 1), layer('valley', 'environment', 70, 0.85), layer('ground', 'terrain', 80, 1),
      layer('platform', 'terrain', 90, 1), layer('foreground', 'foreground', 100, 1.15)],
    instances: [
      item('sky', 'sky', 'sky', '冷蓝至近白的完整冬日天空，无文字和底部空带。', rect(0, 0, 1024, 576), [512, 0]),
      item('mountains', 'mountains', 'mountain-range', '冷蓝远雪山，低对比，清晰分开的山脊。',
        [[0, 246], [90, 188], [170, 216], [280, 116], [370, 194], [458, 160], [550, 220], [680, 126], [774, 180], [868, 146], [1024, 232], [1024, 420], [0, 420]], [512, 420]),
      item('forest', 'forest', 'distant-forest', '低对比远处松林，仅作林带，不混入城堡和近景岩石。',
        [[0, 312], [128, 278], [260, 314], [388, 290], [530, 328], [674, 294], [810, 318], [922, 276], [1024, 310], [1024, 444], [0, 444]], [512, 444]),
      item('castle', 'castle', 'castle-bridge', '灰石古堡与远拱桥，城堡主体在右侧；不含松林、主地形和前景。',
        [[560, 312], [560, 272], [682, 272], [682, 188], [714, 188], [714, 158], [744, 158], [744, 216], [808, 216], [808, 134], [840, 108], [872, 134], [872, 216], [938, 216], [938, 176], [970, 176], [970, 366], [560, 366]], [800, 366]),
      item('middle-left', 'middle', 'snow-pine-rock', '左侧中景覆雪松树与低岩组。', [[0, 400], [24, 324], [62, 238], [106, 330], [148, 390], [200, 416], [0, 416]], [88, 416]),
      item('middle-right', 'middle', 'snow-pine-rock', '右侧中景覆雪松树与低岩组。', [[866, 400], [910, 330], [946, 260], [982, 350], [1024, 400], [1024, 432], [866, 432]], [954, 432]),
      item('arch', 'arch', 'stone-arch', '左侧独立灰石拱门，拱洞可见，与矮墙是两个实例。',
        [[152, 400], [152, 252], [288, 252], [288, 400], [260, 400], [260, 310], [248, 294], [192, 294], [180, 310], [180, 400]], [220, 400]),
      item('wall', 'wall', 'low-wall', '右侧低矮覆雪断墙。', rect(800, 336, 128, 64), [864, 400]),
      item('valley', 'valley', 'valley-water', '中央谷底冷蓝静态水景；延伸至底边，属于地形后方。', rect(352, 490, 320, 86), [512, 576]),
      item('ground-left', 'ground', 'solid-terrain', '左实心覆雪岩壁，上缘平直、短台阶；仅逻辑表面正侧视。',
        [[0, 416], [160, 416], [160, 400], [288, 400], [288, 432], [368, 432], [368, 576], [0, 576]], [160, 400]),
      item('ground-right', 'ground', 'solid-terrain', '右实心覆雪岩壁，中央谷地保持开口。',
        [[672, 432], [784, 432], [784, 400], [928, 400], [928, 416], [1024, 416], [1024, 576], [672, 576]], [784, 400]),
      item('platform', 'platform', 'solid-platform', '居中三格宽实心覆雪悬浮台，表沿平直，无顶面透视。',
        [[432, 328], [624, 328], [624, 362], [592, 392], [460, 392], [432, 362]], [528, 328]),
      item('foreground-left', 'foreground', 'foreground-snow-rock', '完整左前景岩沿入画，体量较大、清晰；与右前景独立，不合成双堆。',
        [[0, 462], [56, 466], [96, 496], [152, 514], [212, 576], [0, 576]], [0, 576]),
      item('foreground-right', 'foreground', 'foreground-snow-rock', '完整右前景岩沿入画，体量较大、清晰；不覆盖中央谷地。',
        [[812, 576], [856, 530], [918, 504], [972, 468], [1024, 458], [1024, 576]], [1024, 576]),
    ],
    protectedRegions: [{ regionId: 'central-valley', purpose: '前景不得盖住中央谷地和谷底水景。', polygon: points(rect(392, 408, 240, 168)),
      forbiddenInstanceIds: ['foreground-left', 'foreground-right'], maxOccludedPermille: 0 },
    { regionId: 'platform-top', purpose: '保留悬浮台可玩表沿。', polygon: points(rect(432, 320, 192, 16)),
      forbiddenInstanceIds: ['foreground-left', 'foreground-right'], maxOccludedPermille: 0 },
    { regionId: 'arch-opening', purpose: '拱门必须保留通透开口，不能变成实心矩形墙。', polygon: points(rect(190, 312, 60, 88)),
      forbiddenInstanceIds: ['arch'], maxOccludedPermille: 0 }],
    tolerances: { maxAnchorErrorPx: 16, minEnvelopeIoUPermille: 800, maxAspectErrorPermille: 5 } });
  return { projectId: 'snow.standard.r1', blueprint, inputs: stylePath ? [{ role: 'style-reference', path: stylePath }] : [],
    style: { mode: 'preset', preset: 'clean-handpaint', name: '', rules: ['Low texture noise, flat side-view playable surfaces, consistent soft winter daylight.'], anchorPath: null } };
}

import { seal } from '../../src/generation/common.mjs';
const layer = (layerId, kind, zIndex, parallaxX) => ({ layerId, kind, zIndex, parallaxX });
const subject = (subjectId, layerId, role, content, placementHint, min = 1, max = min) => ({ subjectId, layerId, role, content, placementHint, count: { min, max } });
export function referenceLedExample(name, styleImagePath = null) {
  const standards = [
    { key: 'projection', requirement: '可玩地形严格正侧视，不出现宽大的后退顶面、等距地面或俯视玩法平面。' },
    { key: 'layer-separation', requirement: '所需主体和深度层次有可辨轮廓，自然重叠；能为每个主体分配图层。' },
    { key: 'frame-completeness', requirement: '画框上下左右都有完整设计，谷底及需要的前景覆盖到底部，不留无设计的纯色空带。' },
    { key: 'terrain-readability', requirement: '实际可玩表沿清晰、平台为实心；在确认图片后测量位置和轮廓，碰撞与可视外观分开。' },
    { key: 'foreground-readability', requirement: '按本场景前景要求核验；需要前景时形态清晰且不遮挡关键可玩边缘，不需要时不强加前景。' },
    { key: 'style-consistency', requirement: '笔触、纹理尺度、配色和照明一致，清爽手绘以大色块和低噪声表达。' },
    { key: 'decomposability', requirement: '可见主体可分层归属，边缘清楚；遮挡、软过渡和框外部分明确标记，不宣称已恢复未知内容。' },
  ];
  let description, layers, subjects, compositionNotes;
  if (name === 'snow-castle') {
    description = '雪山古堡：冷蓝远山、灰石古堡、覆雪松树、左右覆雪岩体与中部实心悬浮台。中央谷地以雪岩和冷蓝雾延伸到画框底部；左右近前景分别入画，保留玩法通道。具体位置与尺寸由完整参考图确定。';
    layers = [layer('sky', 'background', 0, 0), layer('mountains', 'background', 10, 0.15), layer('castle', 'environment', 20, 0.4), layer('trees', 'environment', 30, 0.65),
      layer('valley', 'environment', 35, 0.8), layer('ground', 'terrain', 40, 1), layer('platform', 'terrain', 50, 1), layer('foreground', 'foreground', 60, 1.15)];
    subjects = [subject('sky', 'sky', 'sky', '完整冬日天空。', 'wide'), subject('mountains', 'mountains', 'mountain-range', '低对比远雪山，造型随画风设计。', 'wide'),
      subject('castle', 'castle', 'castle', '远处灰石古堡，与山脊连接。', 'right'), subject('pines-left', 'trees', 'snow-pines', '左侧中景覆雪松树群，根部与地形衔接。', 'left'),
      subject('pines-right', 'trees', 'snow-pines', '右侧中景覆雪松树群。', 'right'), subject('valley-depth', 'valley', 'snow-valley-depth', '谷底雪岩和低对比冷蓝雾，完整延伸至底部。', 'center'),
      subject('ground-left', 'ground', 'solid-terrain', '左侧实心覆雪岩体，可有低台阶。', 'left'), subject('ground-right', 'ground', 'solid-terrain', '右侧实心覆雪岩体。', 'right'),
      subject('platform', 'platform', 'solid-platform', '一块中部实心悬浮台，清晰侧视表沿。', 'center'), subject('foreground-left', 'foreground', 'snow-rock-edge', '左侧完整近景岩沿，从画框入画且不盖住关键表沿。', 'left'),
      subject('foreground-right', 'foreground', 'snow-rock-edge', '右侧完整近景岩沿。', 'right')];
    compositionNotes = ['安排自然纵深、古堡与山脊的承托关系，避免树群或建筑无支撑悬空。', '保持主要表沿和中央谷地可读，前景清晰，不用模糊或纯色带掩盖边界。'];
  } else if (name === 'forest-slope') {
    description = '森林缓坡：连续起伏苔草地形、远处山丘和自然树群。无需建筑或悬浮台，可有少量蕨叶前景。实际构图和坡线由确认图确定。';
    layers = [layer('sky', 'background', 0, 0), layer('hills', 'background', 10, 0.2), layer('trees', 'environment', 20, 0.65), layer('ground', 'terrain', 30, 1), layer('foreground', 'foreground', 40, 1.15)];
    subjects = [subject('sky', 'sky', 'sky', '完整天空。', 'wide'), subject('hills', 'hills', 'hills', '柔和远丘。', 'wide'),
      subject('trees', 'trees', 'forest-trees', '自然树木组，主体边缘可辨。', 'anywhere', 1, 3), subject('ground', 'ground', 'solid-terrain', '连续缓坡与实心岩土截面。', 'wide'),
      subject('ferns', 'foreground', 'fern-edge', '可选少量蕨叶，不遮挡主要表沿。', 'frame-edges', 0, 1)];
    compositionNotes = ['采用连贯缓坡构图，前景可缺省，不引入雪山古堡的主体或关卡结构。'];
  } else throw new Error('Unknown explicit reference-led example');
  const requirements = seal({ format: 'ai_scene_reference_requirements_v1', requirementsId: `reference.${name}.requirements`, layers, subjects, compositionNotes, standards });
  return { projectId: `reference.${name}`, description, viewport: { width: 1024, height: 576 }, maxAspectErrorPermille: 5, requirements,
    inputs: styleImagePath ? [{ role: 'style-reference', path: styleImagePath }] : [],
    style: { mode: 'preset', preset: 'clean-handpaint', name: '', rules: [], anchorPath: null } };
}

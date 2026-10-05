"""Explicit, byte-bound visual evidence policy for new UI-layer runs."""
import hashlib
import json
from pathlib import Path


KIND = 'ui_visual_policy_v1'
KIND_V2 = 'ui_visual_policy_v2'
KIND_V3 = 'ui_visual_policy_v3'
FIELDS = {
    'kind': (KIND,),
    'appearanceEvidence': ('text-complete', 'bound-reference'),
    'minorColor': ('strict', 'record'),
    'shadow': ('preserve', 'optional'),
}
FIELDS_V2 = dict(FIELDS, kind=(KIND_V2,), minorStyle=('strict', 'record'))
FIELDS_V3 = dict(FIELDS_V2, kind=(KIND_V3,), minorGeometry=('strict', 'record'))
INPUT_NAME = 'visual-policy.json'
MODEL_STAGES = ('m2', 'repair', 'rereview', 'repair2', 'rereview2')


def validate(policy):
    """Require the exact public policy shape, without implicit defaults."""
    if not isinstance(policy, dict):
        raise ValueError('INVALID_VISUAL_POLICY_FIELDS')
    fields = {KIND_V2: FIELDS_V2, KIND_V3: FIELDS_V3}.get(policy.get('kind'), FIELDS)
    if set(policy) != set(fields):
        raise ValueError('INVALID_VISUAL_POLICY_FIELDS')
    for field, allowed in fields.items():
        if type(policy[field]) is not str or policy[field] not in allowed:
            raise ValueError('INVALID_VISUAL_POLICY_VALUE:' + field)
    return policy


def _decode(data):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('DUPLICATE_VISUAL_POLICY_FIELD')
            result[key] = value
        return result
    try:
        return validate(json.loads(data.decode('utf-8-sig'), object_pairs_hook=unique))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError('INVALID_VISUAL_POLICY_JSON') from exc


def load_input(path):
    """Validate before run creation; return original bytes for exact binding."""
    if path is None:
        return None
    data = Path(path).read_bytes()
    if not data or len(data) > 4096:
        raise ValueError('VISUAL_POLICY_SIZE_OR_EMPTY')
    _decode(data)
    return data


def input_policy(inputs, config):
    """Read an initialized run's pinned input, without normalizing its bytes."""
    inputs = Path(inputs)
    entries = config['inputs']
    has_pin = INPUT_NAME in entries
    file = inputs / INPUT_NAME
    if not has_pin and not file.exists():
        return None
    if not has_pin or not file.is_file():
        raise ValueError('VISUAL_POLICY_INPUT_UNBOUND')
    data = file.read_bytes()
    if hashlib.sha256(data).hexdigest() != entries[INPUT_NAME]:
        raise ValueError('VISUAL_POLICY_INPUT_CHANGED')
    return _decode(data)


def planning_policy(run):
    """Verify config, policy input and every existing model request in a run."""
    run = Path(run)
    from .evaluate import read, digest
    config_path = run / '.dag/config.json'
    requests = [run / 'request.json', *(run / name / 'request.json' for name in MODEL_STAGES)]
    if not config_path.is_file():
        if (run / '.dag/inputs' / INPUT_NAME).exists() or any(
                request_path.is_file() and
                'visualPolicySha256' in read(request_path)
                for request_path in requests):
            raise ValueError('VISUAL_POLICY_INPUT_UNBOUND')
        return None
    if digest(config_path) != read(run / '.dag/config-digest.json')['sha256']:
        raise ValueError('CONFIG_CHANGED')
    config = read(config_path)
    policy = input_policy(run / '.dag/inputs', config)
    expected = config['inputs'].get(INPUT_NAME)
    for request_path in requests:
        if not request_path.is_file():
            continue
        request = read(request_path)
        if ((expected is None and 'visualPolicySha256' in request) or
                (expected is not None and request.get('visualPolicySha256') != expected)):
            raise ValueError('VISUAL_POLICY_REQUEST_MISMATCH:' + request_path.parent.name)
    return policy


def snapshot_policy(snapshot_path, manifest=None):
    """Read a frozen policy only when file, files index and metadata all agree."""
    from .evaluate import read
    folder = Path(snapshot_path)
    if folder.name == 'snapshot.json':
        folder = folder.parent
    if manifest is None:
        manifest = read(folder / 'snapshot.json')
    file = folder / INPUT_NAME
    indexed = manifest.get('files', {}).get(INPUT_NAME)
    metadata = manifest.get('visualPolicySha256')
    if not file.exists() and indexed is None and metadata is None:
        return None
    if not file.is_file() or not isinstance(indexed, str) or not isinstance(metadata, str):
        raise ValueError('VISUAL_POLICY_SNAPSHOT_UNBOUND')
    data = file.read_bytes()
    actual = hashlib.sha256(data).hexdigest()
    if actual != indexed or actual != metadata:
        raise ValueError('VISUAL_POLICY_SNAPSHOT_CHANGED')
    return _decode(data)


def planning_guidance(policy):
    if policy is None:
        return ''
    validate(policy)
    appearance = (
        '图形的结构、身份、数量、状态、连接及显著材质仍完整写入所属 label；'
        '显著高光、渐变、描边与轮廓也须写明；'
        '仅无法用短句穷尽的细微表面明暗、细点与轻微色调可交给本次绑定的原图。'
        '不得把缺失/矛盾/不确定的图形或裁切问题称作 reference-bound。'
        if policy['appearanceEvidence'] == 'bound-reference' else
        '所属 label 须完整描述可辨的结构、身份、状态、连接及显著外观；原图不能替代缺少的文字说明。'
    )
    color = ('轻微色调偏差仍须修正。' if policy['minorColor'] == 'strict' else
             '身份、状态、纹理不变的轻微色调偏差可记录；明显错色仍须修正。')
    shadow = ('保留有据阴影。' if policy['shadow'] == 'preserve' else
              '孤立可选柔影可不重建；实体轮廓、描边、边界、高光和显著渐变仍须保留。')
    style = ('清晰归属且身份、状态、数量、结构和纹理类型保留的轻微表面渲染差异可记录；'
             '主要或不确定变化仍须修正。' if policy.get('minorStyle') == 'record' else '')
    geometry = ('目标为整体基本还原；完整主体的轻微宽高比例、圆角或外轮廓差异可记录，'
                '不要求逐像素复刻。缺件、重复、实心裁切、错误归属/状态、内部图形位移、'
                '明显或不确定变形仍须修正。' if policy.get('minorGeometry') == 'record' else '')
    return '\n本次显式视觉策略：' + appearance + color + shadow + style + geometry + '\n'


def generation_guidance(policy):
    if policy is None:
        return ''
    validate(policy)
    appearance = ('以本次绑定参考图承接 label 未列尽的细微表面细节；'
                  if policy['appearanceEvidence'] == 'bound-reference' else
                  '以 label 完整描述为准，逐项对照本次绑定参考图；')
    color = ('轻微色调也须尽量准确；' if policy['minorColor'] == 'strict' else
             '只容许不改变身份、状态、纹理的轻微色调差异；')
    shadow = ('保留有据阴影。' if policy['shadow'] == 'preserve' else
              '孤立柔影可选，实体轮廓、描边、边界、高光与显著渐变仍须保留。')
    style = ('轻微表面渲染差异可记录；身份、状态、数量、结构和纹理类型仍须保留，'
             '不改变主体轮廓、归属或位置。' if policy.get('minorStyle') == 'record' else '')
    if policy.get('minorStyle') == 'record' and policy.get('minorGeometry') == 'record':
        style = '轻微表面渲染差异可记录；保留整体轮廓、归属、位置、身份、状态、数量、结构和纹理类型。'
    geometry = ('整体基本还原即可；完整主体可有轻微比例或圆角差异，仍尽量贴近参考。'
                '保留全部独立内容、状态、连接、内部图形相对位置和真透明 alpha；'
                '不复制、遗漏、裁切或明显改变主体形状。' if policy.get('minorGeometry') == 'record' else '')
    return '\n显式视觉策略：' + appearance + color + shadow + style + geometry


def output_review_guidance(policy):
    if policy is None:
        return ''
    validate(policy)
    color = ('轻微色调差异也按失败记录。' if policy['minorColor'] == 'strict' else
             '仅实体身份、状态与纹理不变的轻微色调差异可记录为非阻断。')
    shadow = ('有据阴影缺失仍须审查。' if policy['shadow'] == 'preserve' else
              '仅孤立可选柔影可不阻断；实体轮廓、描边、边界、高光、显著渐变及材质缺失仍阻断。')
    style = ('清晰归属、身份/状态/数量/结构/纹理类型完整的轻微表面渲染、细微高光强弱'
             '或边缘处理差异，填style/other、magnitude=minor并记录为非阻断；'
             '主要、无法判断或归属不清的外观变化仍阻断。缺件、重复、实心裁断、轮廓破坏、'
             '错误归属/状态、位移及高光/渐变/材质缺失不得归入轻微样式。'
             if policy.get('minorStyle') == 'record' else '')
    geometry = ('整体基本还原是本次验收目标。完整、清晰归属且身份/数量/状态/连接保留的'
                '轻微宽高比例、圆角或完整外轮廓差异，仍填geometry/other、magnitude=minor，'
                '记录为非阻断；不以肉眼估计像素或2%/5%阈值一票否决。'
                '明显变形填major；无法判断填uncertain。缺件、重复、实心裁切、错归属/状态、'
                '内部图形位移或多锚点失配不得降为轻微几何或样式。'
                if policy.get('minorGeometry') == 'record' else '')
    return ('\n显式输出审查策略：逐项 finding 填 styleAspect=color-tone/shadow/other，非样式问题填 other。'
            + color + shadow + style + geometry + '绑定参考图只承接细微表面，不豁免缺件、错状态、错归属或裁切。')

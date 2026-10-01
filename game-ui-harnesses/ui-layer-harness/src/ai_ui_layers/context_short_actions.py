"""Short instructions for one unambiguous whole owner; no geometry inference."""
import json


def build(visual, material, entries, group):
    """Return None when existing v6 layout instructions must remain explicit."""
    if group is not None or len(entries) != 1:
        return None
    owned = [o for o in visual['objects'] if o['materialId'] == material['id']]
    if len(owned) != 1:
        return None
    obj = owned[0]
    if obj['kind'] == 'logo':
        return None  # Lettering identity needs the existing explicit layout/text path.
    if obj.get('bboxNorm') is not None and obj['bboxNorm'] != material['bboxNorm']:
        return None
    foreign = entries[0]['exclude']
    if any(item['relation'] == 'same-depth' or len(item['members']) != 1 for item in foreign):
        return None
    other_materials = {m['id']: m for m in visual['materials']}
    for item in foreign:
        objects = [o for o in visual['objects'] if o['materialId'] == item['materialId']]
        if any(o.get('bboxNorm') is not None and o['bboxNorm'] != other_materials[item['materialId']]['bboxNorm'] for o in objects):
            return None
    seen = {obj['label'], material['label']}
    for item in foreign:
        labels = {other_materials[item['materialId']]['label'], item['members'][0]['appearance']}
        if labels & seen:return None
        seen.update(labels)
    # Keep reviewed identity and state; never shorten labels or infer a synonym.
    text = '根据参考图，只生成这一份完整独立素材：' + material['label'] + '。'
    if obj['label'] != material['label']:
        text += '保留所属图形：' + obj['label'] + '。'
    for relation, instruction in (('overlay', '移除覆盖在它上面的独立素材：'),
                                  ('underlay', '去掉周围和下方的独立底层素材：')):
        rows = []
        for item in foreign:
            if item['relation'] != relation:continue
            identity = other_materials[item['materialId']]['label']
            appearance = item['members'][0]['appearance']
            rows.append(identity if identity == appearance else identity + '（' + appearance + '）')
        if rows:
            text += instruction + '；'.join(rows) + '。'
    if any(item['relation'] == 'overlay' for item in foreign):
        text += '仅补齐该素材原有且被遮挡的表面，不留人造洞、凹槽或残影；真实开孔和半透明区域保留。'
    if material['preserveText']:
        text += '逐字保留这些明确指定的文字：' + json.dumps(material['preserveText'], ensure_ascii=False) + '；移除其余普通文字和数字。'
    else:
        text += '移除所有普通文字和数字。'
    text += '去字处用所属表面补齐，保留原文字空间，不移动或放大邻近图形。所属单字符图标是图形，仍须保留。'
    return (text + '保持参考中的身份、状态、数量、完整轮廓、宽高比例、相对位置、材质、渐变和高光，'
            '内部间距不变，不居中重排，不新增图形、底座、描边或光晕。输出透明背景PNG，'
            '轮廓外及真孔透明，软边保留连续alpha，四侧各保留至少10%的全透明留白；'
            '只等比缩放，不拉伸，不包含场景背景。')

"""Shared visual layout defaults and deterministic geometry checks, never visual approval."""
import base64
import copy
import io
from PIL import Image
from .common import require

DEFAULT_FONT = 'Arial'


def walk(root):
    yield root
    for child in root.get('children', []):
        yield from walk(child)


def system_typography(document):
    """Explicit normal system typography, preserving authored size, color and layout."""
    result = copy.deepcopy(document)
    for node in walk(result['root']):
        node['props']['style']['fontFamily'] = DEFAULT_FONT
        node['props']['style']['fontWeight'] = 'normal'
        node['props'].pop('fontSource', None)
    return result


def contains(outer, inner):
    return inner['x'] >= outer['x'] and inner['y'] >= outer['y'] and inner['width'] > 0 and inner['height'] > 0 and inner['x']+inner['width'] <= outer['x']+outer['width']+1e-6 and inner['y']+inner['height'] <= outer['y']+outer['height']+1e-6


def check_visual_layout(bundle, policy):
    require(policy.get('kind') == 'ui_visual_layout_policy_v1', 'VISUAL_POLICY_KIND')
    nodes = {n['id']: n for n in walk(bundle['document']['root'])}
    resources = {r['path']: r for r in bundle.get('resources', [])}
    for section, kind in [('lists','List'),('tabs','Tabs'),('progressBars','ProgressBar'),('scrollViews','ScrollView')]:
        specs = policy.get(section)
        require(isinstance(specs, list), 'VISUAL_POLICY_SECTION')
        ids = [s.get('componentId') for s in specs]
        require(len(ids) == len(set(ids)), 'VISUAL_POLICY_DUPLICATE')
        require(set(ids) == {n['id'] for n in nodes.values() if n['type'] == kind}, 'VISUAL_POLICY_COMPONENT_COVERAGE')
    issues = []
    def check(ok, code, component):
        if not ok: issues.append({'code':code, 'componentId':component})
    for node in nodes.values():
        style = node['props']['style']
        check(style['fontFamily'] == DEFAULT_FONT, 'SYSTEM_FONT_REQUIRED', node['id'])
        check(style['fontWeight'] == 'normal', 'DEFAULT_WEIGHT_REQUIRED', node['id'])
        check('fontSource' not in node['props'], 'SYSTEM_FONT_CUSTOM_SOURCE', node['id'])
    for spec in policy.get('lists', []):
        node = nodes[spec['componentId']]; p = node['props']; a = p['appearance']
        height = p['itemHeight'] - p.get('rowGap', 0)
        left, top, right, bottom = spec['contentInsets']
        content = {'x':left,'y':top,'width':node['layout']['width']-left-right,'height':height-top-bottom}
        check(p.get('drawBackground') is False, 'LIST_DUPLICATE_BACKGROUND', node['id'])
        check(height == spec['paintHeight'] and a['rowCanvas'] == a['selectedRowCanvas'], 'LIST_ROW_PAINT_HEIGHT', node['id'])
        for child in node.get('children', []):
            if child['type'] != 'Image': continue
            r = dict(child['layout']); r['y'] %= p['itemHeight']
            check(contains(content,r), 'LIST_SLOT_OUTSIDE_CONTENT', child['id'])
    for spec in policy.get('progressBars', []):
        node = nodes[spec['componentId']]; a = node['props']['appearance']; t = a['track']['layout']
        left, top, right, bottom = spec['innerInsets']
        inner = {'x':t['x']+left,'y':t['y']+top,'width':t['width']-left-right,'height':t['height']-top-bottom}
        check(contains(inner,a['fillClip']), 'PROGRESS_FILL_COVERS_FRAME', node['id'])
    for spec in policy.get('tabs', []):
        node = nodes[spec['componentId']]; a = node['props']['appearance']
        check({r['tabId'] for r in a.get('icons', [])} == {r['id'] for r in node['props']['tabs']}, 'TAB_ICON_COVERAGE', node['id'])
        for item in a.get('icons', []):
            cell = next(row for row in a['items'] if row['tabId'] == item['tabId'])
            check(item.get('icon', {}).get('layout') == item.get('activeIcon', {}).get('layout'), 'TAB_ICON_STATE_GEOMETRY', node['id'])
            for key in ('icon', 'activeIcon'):
                part = item.get(key)
                if not part:
                    check(False, 'TAB_ICON_COVERAGE', node['id']); continue
                rect = part['layout']
                check(contains({'x':0,'y':0,'width':cell['layout']['width'],'height':cell['layout']['height']},rect), 'TAB_ICON_OUTSIDE_CELL', node['id'])
                label = cell['labelLayout']
                check(rect['x']+rect['width'] <= label['x'] or label['x']+label['width'] <= rect['x'] or rect['y']+rect['height'] <= label['y'] or label['y']+label['height'] <= rect['y'], 'TAB_ICON_LABEL_OVERLAP', node['id'])
                with Image.open(io.BytesIO(base64.b64decode(resources[part['image']]['base64']))) as image:
                    box = image.convert('RGBA').getchannel('A').getbbox()
                    require(box is not None, 'EMPTY_TAB_ICON')
                    ratio = (box[3]-box[1])*part['layout']['height']/image.height/cell['layout']['height']
                check(spec['minVisibleHeightRatio'] <= ratio <= spec['maxVisibleHeightRatio'], 'TAB_ICON_VISIBLE_PROPORTION', node['id'])
    for spec in policy.get('scrollViews', []):
        node = nodes[spec['componentId']]; p = node['props']
        check(p.get('drawBackground') is False, 'VIEWPORT_DUPLICATE_BACKGROUND', node['id'])
        expected_visibility = spec.get('scrollbarVisibility', 'auto')
        check(expected_visibility in ('auto', 'always') and p.get('scrollbarVisibility') == expected_visibility, 'SCROLL_VISIBILITY_POLICY_MISMATCH', node['id'])
        check(p['contentHeight'] == spec['contentHeight'], 'SCROLL_CONTENT_EXTENT', node['id'])
    return {'kind':'ui_visual_layout_check_v1','status':'passed' if not issues else 'failed',
            'fontPolicy':{'family':DEFAULT_FONT,'weight':'normal','sourceFontMatching':False},
            'issues':issues,'human_visual_acceptance':False}


def main():
    import argparse
    from pathlib import Path
    from .common import read_json, write_json
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', required=True, type=Path)
    parser.add_argument('--policy', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    report = check_visual_layout(read_json(args.bundle, max_bytes=256*1024*1024), read_json(args.policy))
    write_json(args.output, report)
    if report['status'] != 'passed': raise SystemExit(1)


if __name__ == '__main__': main()

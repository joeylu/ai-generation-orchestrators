"""Explicit offline planning input; emits only the existing contentHeight contract."""
import argparse
import json
import math
from pathlib import Path
from .common import require, read_json


def apply_bottom_space(node, scope, plan):
    fields = {'kind', 'version', 'sourceSha256', 'componentId',
                         'previousContentHeight', 'viewportHeight', 'bottomWhitespace',
                         'authorization'}
    if plan.get('version') == '1.1': fields.add('previousBottomWhitespace')
    require(set(plan) == fields, 'SCROLL_LAYOUT_PLAN_FIELDS')
    require(plan['kind'] == 'ui-scroll-bottom-space-plan' and plan['version'] in ('1.0','1.1'), 'SCROLL_LAYOUT_PLAN_VERSION')
    require(isinstance(plan['authorization'], str) and bool(plan['authorization'].strip()), 'SCROLL_LAYOUT_AUTHORIZATION_REQUIRED')
    require(all(type(plan[k]) in (int, float) and math.isfinite(plan[k]) and plan[k] >= 0
                for k in ('previousContentHeight', 'viewportHeight', 'bottomWhitespace') +
                (('previousBottomWhitespace',) if plan['version']=='1.1' else ())), 'SCROLL_LAYOUT_NUMBER')
    require(node['id'] == plan['componentId'] and node['type'] == 'ScrollView', 'SCROLL_LAYOUT_COMPONENT')
    require(node['layout']['height'] == plan['viewportHeight'] and
            node['props']['contentHeight'] == plan['previousContentHeight'], 'SCROLL_LAYOUT_STALE_GEOMETRY')
    # Bounded profile: existing List children have a deterministic painted extent.
    # Other content models need their own extent proof; never infer from a thumb.
    children = node.get('children', [])
    require(len(children) == 1 and children[0]['type'] == 'List', 'SCROLL_LAYOUT_EXTENT_UNSUPPORTED')
    child = children[0]; props = child['props']
    extent = child['layout']['y'] + max(0, len(props['items']) * props['itemHeight'] - props.get('rowGap', 0))
    require(extent + plan.get('previousBottomWhitespace',0) == plan['previousContentHeight'], 'SCROLL_LAYOUT_CONTENT_EXTENT')
    require(scope.get('human_visual_acceptance') is False and isinstance(scope.get('derivedTestStates'), list), 'SCROLL_LAYOUT_SCOPE_REQUIRED')
    height = extent + plan['bottomWhitespace']
    result = {'contentExtentHeight': extent, 'bottomWhitespace': plan['bottomWhitespace'],
              'contentHeight': height, 'viewportHeight': plan['viewportHeight'],
              'scrollRange': max(0, height - plan['viewportHeight'])}
    node['props']['contentHeight'] = height
    # Replace the superseded runtime policy only, preserving all reference evidence
    # and all compared components. This is not a consumer padding extension.
    scope['derivedTestStates'] = [s for s in scope['derivedTestStates'] if s.get('componentId') != node['id']]
    scope['derivedTestStates'].append({'componentId': node['id'], 'basis': 'contract-derived',
        'description': f"Explicitly user-authorized bottom whitespace {plan['bottomWhitespace']}px after existing content extent {extent}px; contentHeight={height}, viewportHeight={plan['viewportHeight']}, scrollY range 0..{result['scrollRange']}. Existing items, their local positions, viewport, always-visible scrollbar and measured end insets are unchanged. This supersedes the prior zero-range runtime layout, not original observed state. Original scrollX/scrollY remain unknown; no hidden tasks or original short-thumb restoration. Authorization: {plan['authorization']}"})
    return result


def main():
    from .scroll_visibility_handoff import rebind
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ('source', 'component-root', 'output', 'plan'):
        parser.add_argument('--'+key, type=Path, required=True)
    args = parser.parse_args(); plan = read_json(args.plan)
    print(json.dumps(rebind(args.source.resolve(), args.component_root.resolve(), args.output.resolve(),
                            plan['componentId'], 'always', bottom_space_plan=plan), indent=2))


if __name__ == '__main__':
    main()

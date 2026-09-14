"""Exact producer counterpart of consumer tabs-layout-v1; no inferred direction."""
import math
from .common import require


def validate_tabs_layout(state, tab_ids, width, height):
    policy = state.get('layoutPolicy')
    if 'layoutPolicy' not in state:
        return None
    require(isinstance(policy, dict) and set(policy) == {'version', 'orientation'} and
            policy['version'] == '1.0' and policy['orientation'] in ('horizontal', 'vertical'), 'TAB_LAYOUT_POLICY_INVALID')
    items = state.get('items')
    require(isinstance(items, list) and len(items) == len(tab_ids) and len(items) > 0, 'TAB_LAYOUT_ITEMS_REQUIRED')
    require(all(isinstance(i, dict) for i in items), 'TAB_LAYOUT_ITEMS_REQUIRED')
    ids = [i.get('tabId') for i in items]
    require(all(isinstance(i, str) for i in ids) and len(set(ids)) == len(ids) and set(ids) == set(tab_ids), 'TAB_LAYOUT_ITEM_IDS')
    require(policy['orientation'] != 'vertical' or ids == tab_ids, 'TAB_LAYOUT_ITEM_ORDER')
    previous = []
    for item in items:
        r = item.get('layout', {})
        require(isinstance(r, dict), 'TAB_LAYOUT_GEOMETRY')
        require(all(type(r.get(k)) in (int, float) and math.isfinite(r[k]) for k in ('x', 'y', 'width', 'height')), 'TAB_LAYOUT_GEOMETRY')
        require(r['x'] >= 0 and r['y'] >= 0 and r['width'] > 0 and r['height'] > 0 and
                r['x'] + r['width'] <= width and r['y'] + r['height'] <= height and r['height'] == state.get('headerHeight'), 'TAB_LAYOUT_GEOMETRY')
        vertical = policy['orientation'] == 'vertical'
        require((r['x'] if vertical else r['y']) == 0, 'TAB_LAYOUT_GEOMETRY')
        require(not any(r['x'] < p['x'] + p['width'] and r['x'] + r['width'] > p['x'] and
                        r['y'] < p['y'] + p['height'] and r['y'] + r['height'] > p['y'] for p in previous), 'TAB_LAYOUT_OVERLAP')
        require(not vertical or not previous or r['y'] >= previous[-1]['y'] + previous[-1]['height'], 'TAB_LAYOUT_ITEM_ORDER')
        previous.append(r)
    return policy

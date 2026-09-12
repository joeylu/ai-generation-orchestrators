"""Explicit visible-only planning policy; never infer hidden inventory or menus.

This read-only planner proposes runtime semantics, not reference observations,
generation authorization, or acceptance. Rectangles are viewport-local xywh.
"""
from __future__ import annotations

import argparse
import math
from pathlib import Path

from .common import digest, read_json, require, write_json


def visible_only(facts: dict) -> dict:
    require(isinstance(facts, dict) and set(facts) == {'kind', 'scrollViews', 'selects'}
            and facts['kind'] == 'ui_visible_content_facts_v1', 'VISIBLE_FACTS_FIELDS')
    require(isinstance(facts['scrollViews'], list) and isinstance(facts['selects'], list),
            'VISIBLE_FACTS_COLLECTIONS')
    result = {'kind': 'ui_visible_content_policy_v1', 'policy': 'visible_content_only',
              'scrollViews': [], 'selects': [],
              'human_visual_acceptance': False, 'generation_calls': 0}
    ids = set()
    for entry in facts['scrollViews']:
        require(isinstance(entry, dict) and set(entry) == {'id', 'viewport', 'knownItemBounds'}, 'VISIBLE_SCROLL_FIELDS')
        ident = entry['id']
        require(isinstance(ident, str) and ident and ident not in ids, 'VISIBLE_ID')
        ids.add(ident)
        viewport = entry['viewport']
        require(isinstance(viewport, list) and len(viewport) == 2
                and all(type(n) in (int, float) and math.isfinite(n) and n > 0 for n in viewport),
                'VISIBLE_VIEWPORT')
        bounds = entry['knownItemBounds']
        require(isinstance(bounds, list) and bounds, 'VISIBLE_ITEMS_REQUIRED')
        for box in bounds:
            require(isinstance(box, list) and len(box) == 4
                    and all(type(n) in (int, float) and math.isfinite(n) for n in box)
                    and min(box[:2]) >= 0 and min(box[2:]) > 0, 'VISIBLE_ITEM_BOUNDS')
        content = [max(viewport[axis], max(b[axis] + b[axis+2] for b in bounds))
                   for axis in (0, 1)]
        require(content[0] == viewport[0], 'STATE_CAPABILITY_MISSING:HORIZONTAL_SCROLL')
        result['scrollViews'].append({
            'id': ident, 'contentWidth': content[0], 'contentHeight': content[1],
            'viewportWidth': viewport[0], 'viewportHeight': viewport[1],
            'scrollRangeY': content[1] - viewport[1],
            'thumbRatioY': viewport[1] / content[1],
            'basis': 'contract-derived', 'hiddenItemsInvented': False,
            'limitation': 'Only known item bounds determine extent. A shorter reference thumb '
                          'does not establish unseen content; screenshot proportions may differ.'})
    for entry in facts['selects']:
        require(isinstance(entry, dict) and set(entry) == {'id', 'selectedId', 'observedOptions'}, 'VISIBLE_SELECT_FIELDS')
        ident, selected, options = entry['id'], entry['selectedId'], entry['observedOptions']
        require(isinstance(ident, str) and ident and ident not in ids, 'VISIBLE_ID')
        ids.add(ident)
        require(isinstance(options, list) and options, 'VISIBLE_OPTIONS_REQUIRED')
        seen = set()
        for option in options:
            require(isinstance(option, dict) and set(option) == {'id', 'label'}
                    and all(isinstance(option[k], str) and option[k].strip() for k in option),
                    'VISIBLE_OPTION')
            require(option['id'] not in seen, 'VISIBLE_OPTION_DUPLICATE')
            seen.add(option['id'])
        require(isinstance(selected, str) and selected in seen, 'VISIBLE_SELECTION_REQUIRED')
        result['selects'].append({'id': ident, 'selectedId': selected,
                                  'options': [dict(o) for o in options],
                                  'hiddenOptionsInvented': False,
                                  'popupAppearanceBasis': 'contract-derived',
                                  'limitation': 'Unobserved popup appearance is a draft proposal, '
                                                'not source-matched or human-accepted artwork.'})
    result['factsDigest'] = digest(facts)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--facts', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    require(not args.output.exists(), 'OUTPUT_EXISTS')
    write_json(args.output, visible_only(read_json(args.facts)))


if __name__ == '__main__':
    main()

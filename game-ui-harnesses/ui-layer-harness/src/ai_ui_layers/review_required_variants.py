"""Replay received UI material variants into a review-required technical package."""
import argparse
import json

from .accepted_materials import build_selection


def build(selection, output, viewer):
    return build_selection(selection, output, viewer)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('selection', 'output', 'viewer'):
        parser.add_argument('--'+name, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.selection, args.output, args.viewer), ensure_ascii=False, indent=2))

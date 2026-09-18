"""Offline extraction revision; preserves original generation strategy and raw bytes."""
import argparse
import copy
from pathlib import Path

import numpy as np
from PIL import Image

from .common import read_json,write_json,require,sha256,digest,load_verified_image
from .component_boards import verify_strategy,crop_board
from .relative_board import add_windows
from .media import KEY_RGB,matte_key,normalize,require_long_control_geometry


def _validate_source_regions(source_regions, board, raw, *, source_alpha=None):
    """Validate explicit source pixel boxes for every frozen board slot."""
    require(isinstance(source_regions, dict), 'BOARD_SOURCE_REGIONS_FIELDS')
    slots = {slot['asset_id']: slot for slot in board['slots']}
    require(set(source_regions) == set(slots), 'BOARD_SOURCE_REGIONS_COVERAGE')
    width, height = raw.size
    checked = {}
    for asset_id, region in source_regions.items():
        require(isinstance(asset_id, str) and asset_id in slots,
                'BOARD_SOURCE_REGIONS_ASSET')
        require(isinstance(region, list) and len(region) == 4 and
                all(type(value) is int for value in region),
                'BOARD_SOURCE_REGIONS_RECT')
        x, y, w, h = region
        require(x >= 0 and y >= 0 and w > 0 and h > 0 and
                x + w <= width and y + h <= height,
                'BOARD_SOURCE_REGIONS_BOUNDS')
        checked[asset_id] = list(region)

    # Boxes may touch at an edge but may not overlap in a positive area.
    values = list(checked.items())
    for index, (left_id, left) in enumerate(values):
        lx, ly, lw, lh = left
        for right_id, right in values[index + 1:]:
            rx, ry, rw, rh = right
            overlap_width = min(lx + lw, rx + rw) - max(lx, rx)
            overlap_height = min(ly + lh, ry + rh) - max(ly, ry)
            require(overlap_width <= 0 or overlap_height <= 0,
                    'BOARD_SOURCE_REGIONS_OVERLAP')

    pixels = np.asarray(raw.convert('RGBA'))
    alpha = pixels[:, :, 3]
    distance = np.linalg.norm(pixels[:, :, :3].astype(float) - KEY_RGB, axis=2)
    if source_alpha == 'preserve':
        foreground = alpha > 0
    else:
        foreground = (distance >= 145) & (alpha > 0)
    assigned = np.zeros(foreground.shape, dtype=bool)
    for region in checked.values():
        x, y, w, h = region
        assigned[y:y + h, x:x + w] = True
        edge = np.concatenate((distance[y, x:x + w],
                               distance[y + h - 1, x:x + w],
                               distance[y:y + h, x],
                               distance[y:y + h, x + w - 1]))
        region_alpha = np.concatenate((alpha[y, x:x + w],
                                       alpha[y + h - 1, x:x + w],
                                       alpha[y:y + h, x],
                                       alpha[y:y + h, x + w - 1]))
        if source_alpha == 'preserve':
            require(bool(np.all(region_alpha == 0)),
                    'BOARD_SOURCE_REGIONS_ALPHA_EDGE')
        else:
            # Match the existing key contract: transparent edge pixels are
            # also clear, while opaque edge pixels must carry the declared key
            # color.
            clear = (edge < 45) | (region_alpha == 0)
            require(bool(np.all(clear)), 'BOARD_SOURCE_REGIONS_KEY_EDGE')
        local = foreground[y:y + h, x:x + w]
        require(local.any(), 'BOARD_SOURCE_REGIONS_EMPTY')
        require(not (local[0, :].any() or local[-1, :].any() or
                     local[:, 0].any() or local[:, -1].any()),
                'BOARD_SOURCE_REGIONS_FOREGROUND_EDGE')
    require(not foreground[~assigned].any(), 'BOARD_SOURCE_REGIONS_FOREGROUND_DROPPED')
    return checked


def _crop_source_regions(raw, board, source_regions, measured_frames=None,
                         source_alpha=None):
    """Crop explicit regions, retaining the established matte and fit gates."""
    policy = board.get('extraction_policy')
    if policy is not None:
        from .relative_board import validate_policy
        validate_policy(policy)
        padding = policy['target_padding']
    else:
        require(not measured_frames, 'FRAME_FIT_CONTENT_POLICY_REQUIRED')
        padding = 0
    regions = _validate_source_regions(source_regions, board, raw,
                                       source_alpha=source_alpha)
    if measured_frames:
        from .frame_fit import validate_frames
        validate_frames(measured_frames, board)

    parts, rows = {}, []
    for slot in board['slots']:
        asset_id = slot['asset_id']
        x, y, width, height = regions[asset_id]
        target = list(slot['target_size'])
        cropped = raw.crop((x, y, x + width, y + height))
        if source_alpha == 'preserve':
            cropped = normalize(cropped)
        else:
            cropped = matte_key(cropped, [width, height])
        bbox = cropped.getchannel('A').getbbox()
        require(bbox is not None, 'BOARD_SOURCE_REGIONS_EMPTY')
        support = cropped.crop(bbox)
        if measured_frames and asset_id in measured_frames:
            from .frame_fit import fit_frame
            part, record = fit_frame(support, target, padding, measured_frames[asset_id])
            record.update(asset_id=asset_id, source_window=list(regions[asset_id]),
                          matte_bbox_in_window=list(bbox), target_size=target,
                          semantic_identity='requires_review',
                          state_registration='requires_runtime_acceptance')
        elif policy is not None:
            tw, th = target
            scale = min((tw - 2 * padding) / support.width,
                        (th - 2 * padding) / support.height)
            fitted = [max(1, round(support.width * scale)),
                      max(1, round(support.height * scale))]
            support = support.resize(fitted, Image.Resampling.LANCZOS)
            offset = [(tw - fitted[0]) // 2, (th - fitted[1]) // 2]
            part = Image.new('RGBA', (tw, th))
            part.paste(support, tuple(offset))
            part = normalize(part)
            require(part.getchannel('A').getextrema() == (0, 255),
                    'BOARD_PART_ALPHA')
            require_long_control_geometry(part, target, {'insets': [padding] * 4})
            record = {'asset_id': asset_id, 'source_window': list(regions[asset_id]),
                      'matte_bbox_in_window': list(bbox), 'target_size': target,
                      'uniform_scale': scale, 'resampled_size': fitted,
                      'target_offset': offset, 'target_padding': padding,
                      'alpha_bbox': list(part.getchannel('A').getbbox()),
                      'transform': (('explicit source region alpha preservation; '
                                    if source_alpha == 'preserve' else
                                    'explicit source region key removal; ') +
                                   policy['mode'] + '; uniform per-part fit'),
                      'semantic_identity': 'requires_review',
                      'state_registration': 'requires_runtime_acceptance',
                      'grouping_policy': dict(policy)}
        else:
            require([width, height] == target, 'BOARD_SOURCE_REGIONS_TARGET_SIZE')
            part = normalize(cropped)
            require(part.getchannel('A').getextrema() == (0, 255),
                    'BOARD_PART_ALPHA')
            require_long_control_geometry(part, target)
            record = {'asset_id': asset_id, 'source_window': list(regions[asset_id]),
                      'target_size': target,
                      'alpha_bbox': list(part.getchannel('A').getbbox()),
                      'transform': ('pixel crop; explicit source region; alpha preserved'
                                    if source_alpha == 'preserve'
                                    else 'pixel crop; explicit source region'),
                      'semantic_identity': 'requires_review',
                      'state_registration': 'requires_runtime_acceptance'}
        if source_alpha == 'preserve':
            # Diagnostic only: never discard continuous Alpha or fit against an
            # inferred visible core. Faint distant pixels can shrink the artwork.
            alpha = cropped.getchannel('A')
            core = alpha.point(lambda value: 255 if value >= 8 else 0).getbbox()
            record['alphaSupportDiagnostic'] = {
                'threshold': 8, 'fitUsesAllNonzeroAlpha': True,
                'coreBBoxInWindow': list(core) if core else None,
                'coreToSupportWidth': (core[2]-core[0])/(bbox[2]-bbox[0]) if core else 0,
                'coreToSupportHeight': (core[3]-core[1])/(bbox[3]-bbox[1]) if core else 0,
                'purpose': 'visual review only; no alpha threshold applied',
            }
        parts[asset_id] = part
        rows.append(record)
    return parts, rows


def revise(raw_path, strategy_path, board_id, expected_sha256, policy, reason,
           output, measured_frames=None, source_regions=None, source_alpha=None):
    require(not output.exists(),'OUTPUT_EXISTS')
    require(isinstance(reason,str) and reason.strip(),'BOARD_REVISION_REASON')
    strategy=read_json(strategy_path);verify_strategy(strategy)
    boards=[b for b in strategy['boards'] if b['id']==board_id]
    require(len(boards)==1,'BOARD_NOT_FOUND')
    raw,evidence=load_verified_image(raw_path)
    require(source_alpha in (None, 'preserve'), 'BOARD_SOURCE_ALPHA_MODE')
    if source_alpha is not None:
        require(source_regions is not None, 'BOARD_SOURCE_ALPHA_REGIONS_REQUIRED')
        require(evidence['alpha_extrema'] == [0, 255],
                'BOARD_SOURCE_ALPHA_REQUIRED')
    require(evidence['sha256']==expected_sha256,'BOARD_RAW_CHANGED')
    board=copy.deepcopy(boards[0]);add_windows(board,policy)
    if source_regions is None:
        parts, rows = crop_board(raw, board, 'keyed_component',
                                 measured_frames=measured_frames)
    else:
        parts, rows = _crop_source_regions(raw, board, source_regions,
                                           measured_frames=measured_frames,
                                           source_alpha=source_alpha)
    output.mkdir(parents=True)
    for row in rows:
        file=output/(row['asset_id']+'.png');parts[row['asset_id']].save(file)
        row.update(path=file.name,sha256=sha256(file))
    report={'kind':'ai_ui_board_extraction_revision_v1',
            'version':'1.1' if source_alpha is not None else '1.0',
            'original_strategy_digest':strategy['digest'],'board':board_id,
            'raw_sha256':expected_sha256,'source_size':list(raw.size),
            'extraction_policy':policy,'reason':reason,'parts':rows,
            'generation_calls':0,'human_visual_acceptance':False,
            'runtime_acceptance':'not_performed','generation_receipt_validation':'not_performed',
            'scope':'material extraction only; does not replace a generation receipt or delivery acceptance'}
    if measured_frames:report['measuredFrames']=measured_frames
    if source_regions is not None:
        report['sourceRegions'] = copy.deepcopy(source_regions)
        report['sourceStrategy'] = copy.deepcopy(strategy)
    if source_alpha is not None:
        report['sourceAlpha'] = source_alpha
    report['digest']=digest(report);write_json(output/'extraction-revision.json',report)
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('raw','strategy','policy','output'):parser.add_argument('--'+name,type=Path,required=True)
    for name in ('board','expected-sha256','reason'):parser.add_argument('--'+name,required=True)
    parser.add_argument('--measured-frames',type=Path)
    parser.add_argument('--source-regions',type=Path)
    parser.add_argument('--source-alpha', choices=['preserve'])
    args=parser.parse_args()
    report=revise(args.raw,args.strategy,args.board,args.expected_sha256,
                  read_json(args.policy),args.reason,args.output,
                  read_json(args.measured_frames) if args.measured_frames else None,
                  read_json(args.source_regions) if args.source_regions else None,
                  args.source_alpha)
    print(report['digest'])


if __name__=='__main__':main()

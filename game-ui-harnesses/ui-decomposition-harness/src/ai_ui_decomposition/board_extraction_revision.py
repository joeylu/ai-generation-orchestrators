"""Offline extraction revision; preserves original generation strategy and raw bytes."""
import argparse
import copy
from pathlib import Path
from .common import read_json,write_json,require,sha256,digest,load_verified_image
from .component_boards import verify_strategy,crop_board
from .relative_board import add_windows


def revise(raw_path,strategy_path,board_id,expected_sha256,policy,reason,output,measured_frames=None):
    require(not output.exists(),'OUTPUT_EXISTS')
    require(isinstance(reason,str) and reason.strip(),'BOARD_REVISION_REASON')
    strategy=read_json(strategy_path);verify_strategy(strategy)
    boards=[b for b in strategy['boards'] if b['id']==board_id]
    require(len(boards)==1,'BOARD_NOT_FOUND')
    raw,evidence=load_verified_image(raw_path)
    require(evidence['sha256']==expected_sha256,'BOARD_RAW_CHANGED')
    board=copy.deepcopy(boards[0]);add_windows(board,policy)
    parts,rows=crop_board(raw,board,'keyed_component',measured_frames=measured_frames)
    output.mkdir(parents=True)
    for row in rows:
        file=output/(row['asset_id']+'.png');parts[row['asset_id']].save(file)
        row.update(path=file.name,sha256=sha256(file))
    report={'kind':'ai_ui_board_extraction_revision_v1','version':'1.0',
            'original_strategy_digest':strategy['digest'],'board':board_id,
            'raw_sha256':expected_sha256,'source_size':list(raw.size),
            'extraction_policy':policy,'reason':reason,'parts':rows,
            'generation_calls':0,'human_visual_acceptance':False,
            'runtime_acceptance':'not_performed','generation_receipt_validation':'not_performed',
            'scope':'material extraction only; does not replace a generation receipt or delivery acceptance'}
    if measured_frames:report['measuredFrames']=measured_frames
    report['digest']=digest(report);write_json(output/'extraction-revision.json',report)
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('raw','strategy','policy','output'):parser.add_argument('--'+name,type=Path,required=True)
    for name in ('board','expected-sha256','reason'):parser.add_argument('--'+name,required=True)
    parser.add_argument('--measured-frames',type=Path)
    args=parser.parse_args()
    report=revise(args.raw,args.strategy,args.board,args.expected_sha256,read_json(args.policy),args.reason,args.output,read_json(args.measured_frames) if args.measured_frames else None)
    print(report['digest'])


if __name__=='__main__':main()

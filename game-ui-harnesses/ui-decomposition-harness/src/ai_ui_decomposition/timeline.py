"""Append-only local wall-clock phase accounting. Never executes or retries work."""
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
import argparse
import json
import time

from .common import digest, identifier, read_json, require, sha256

CATEGORIES = {'input', 'planning', 'authorization_wait', 'generation', 'processing',
              'visual_review', 'code_repair', 'environment_repair', 'tests',
              'packaging', 'acceptance', 'reporting', 'unclassified'}


def _stamp():
    return dict(utc=datetime.now(timezone.utc).isoformat(), monotonic=time.monotonic())


def _read(directory):
    paths = sorted(Path(directory).glob('[0-9]*.json'))
    require(bool(paths), 'TIMELINE_MISSING')
    rows = []
    for index, path in enumerate(paths):
        require(path.name == f'{index:06d}.json', 'TIMELINE_SEQUENCE')
        row = read_json(path)
        require(row['digest'] == digest({k:v for k,v in row.items() if k != 'digest'}), 'TIMELINE_CHANGED')
        require(row['previous'] == (rows[-1]['digest'] if rows else None), 'TIMELINE_CHAIN')
        require(not rows or rows[-1]['event'] != 'finish', 'TIMELINE_CLOSED')
        rows.append(row)
    return rows


def _append(directory, rows, body):
    body = dict(body, previous=rows[-1]['digest'] if rows else None)
    body['digest'] = digest(body)
    # Exclusive creation also rejects competing writers. Never silently merge
    # concurrent phase transitions into a fabricated sequential history.
    with (Path(directory)/f'{len(rows):06d}.json').open('x', encoding='utf-8') as stream:
        json.dump(body, stream, ensure_ascii=False, indent=2)
    return body


def begin(directory, reference):
    stamp = _stamp()  # Clock starts before reference reading/fingerprinting.
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=False)
    return _append(directory, [], dict(event='begin', stamp=stamp,
        phase='reference-input', category='input', referenceSha256=sha256(Path(reference))))


def transition(directory, phase, category, previous_status='completed'):
    identifier(phase)
    require(category in CATEGORIES, 'TIMELINE_CATEGORY')
    require(previous_status in {'completed','failed','interrupted','blocked','unknown'}, 'TIMELINE_STATUS')
    rows = _read(directory)
    require(rows[-1]['event'] != 'finish', 'TIMELINE_CLOSED')
    return _append(directory, rows, dict(event='phase', stamp=_stamp(), phase=phase,
        category=category, previousStatus=previous_status))


def finish(directory, package, outcome):
    require(outcome in {'draft','blocked','failed'}, 'TIMELINE_OUTCOME')
    rows = _read(directory)
    require(rows[-1]['event'] != 'finish', 'TIMELINE_CLOSED')
    package_sha = sha256(Path(package)) if package is not None else None
    require(package_sha is not None or outcome == 'failed', 'TIMELINE_PACKAGE_REQUIRED')
    _append(directory, rows, dict(event='finish', stamp=_stamp(), packageSha256=package_sha,
        outcome=outcome, previousStatus='completed'))
    return report(directory)


def report(directory):
    rows = _read(directory)
    closed = rows[-1]['event'] == 'finish'
    end = rows[-1] if closed else dict(stamp=_stamp(), previousStatus='running')
    boundaries = rows if closed else rows + [end]
    spans = []; totals = {}; consistent = True
    for start, stop in zip(boundaries, boundaries[1:]):
        wall = (datetime.fromisoformat(stop['stamp']['utc']) - datetime.fromisoformat(start['stamp']['utc'])).total_seconds()
        mono = stop['stamp']['monotonic'] - start['stamp']['monotonic']
        valid = wall >= 0 and mono >= 0 and abs(wall-mono) < 2
        consistent = consistent and valid
        elapsed = round(mono, 6) if valid else None
        spans.append(dict(phase=start['phase'], category=start['category'],
            startedAt=start['stamp']['utc'], endedAt=stop['stamp']['utc'],
            elapsedSeconds=elapsed, wallSeconds=round(wall,6),
            status=stop.get('previousStatus','unknown'), clockConsistent=valid))
        if valid: totals[start['category']] = round(totals.get(start['category'],0)+elapsed,6)
    total = round(sum(s['elapsedSeconds'] for s in spans),6) if consistent else None
    return dict(kind='ui_phase_timeline_v1', closed=closed, clockConsistent=consistent,
        referenceSha256=rows[0]['referenceSha256'], packageSha256=end.get('packageSha256'),
        outcome=end.get('outcome'), startedAt=rows[0]['stamp']['utc'], endedAt=end['stamp']['utc'],
        totalElapsedSeconds=total, categorySeconds=totals, phases=spans,
        accounting='Sequential wall-clock phases; parallel child durations must not be added.',
        attributionComplete=closed and consistent and not any(s['category']=='unclassified' for s in spans),
        human_visual_acceptance=False)


@contextmanager
def measured(directory, phase, category):
    """Bracket one synchronous operation; idle gaps remain explicitly unclassified."""
    transition(directory, phase, category)
    try:
        yield
    except BaseException:
        transition(directory, 'between-operations', 'unclassified', 'failed')
        raise
    else:
        transition(directory, 'between-operations', 'unclassified')


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    commands=parser.add_subparsers(dest='command',required=True)
    for name in ('begin','phase','finish','report'):
        command=commands.add_parser(name);command.add_argument('--timeline',type=Path,required=True)
        if name=='report':command.add_argument('--format',choices=['json','markdown'],default='json')
        if name=='begin':command.add_argument('--reference',type=Path,required=True)
        if name=='phase':
            command.add_argument('--name',required=True)
            command.add_argument('--category',choices=sorted(CATEGORIES),required=True)
            command.add_argument('--previous-status',default='completed',choices=['completed','failed','interrupted','blocked','unknown'])
        if name=='finish':
            command.add_argument('--package',type=Path)
            command.add_argument('--outcome',required=True,choices=['draft','blocked','failed'])
    args=parser.parse_args(argv)
    if args.command=='begin':result=begin(args.timeline,args.reference)
    elif args.command=='phase':result=transition(args.timeline,args.name,args.category,args.previous_status)
    elif args.command=='finish':result=finish(args.timeline,args.package,args.outcome)
    else:result=report(args.timeline)
    if getattr(args,'format',None)=='markdown':
        print(markdown(result))
    else:
        print(json.dumps(result,ensure_ascii=False,indent=2))


def markdown(result):
    total=result['totalElapsedSeconds']
    lines=['# UI 拆分全过程计时', '',
        f"开始：{result['startedAt']}；结束／当前：{result['endedAt']}",
        f"总耗时：{total if total is not None else 'unknown'} 秒；已结束：{result['closed']}；归因完整：{result['attributionComplete']}",
        '', '| 阶段 | 分类 | 开始 UTC | 结束 UTC | 秒 | 状态 |', '|---|---|---|---|---:|---|']
    for span in result['phases']:
        lines.append('| '+' | '.join(str(span[k]) if span[k] is not None else 'unknown'
            for k in ('phase','category','startedAt','endedAt','elapsedSeconds','status'))+' |')
    lines+=['', '| 分类汇总 | 秒 |', '|---|---:|']
    for category in sorted(CATEGORIES):
        value=result['categorySeconds'].get(category,0) if result['clockConsistent'] else 'unknown'
        lines.append(f'| {category} | {value} |')
    lines+=['', '总计只计算串行墙钟区间；并行子任务和验收内部细分不重复相加。',
        '未出现的分类为 0（未记录该分类）；未分类间隙保留，不代表已完整归因。',
        f"拆分包 SHA-256：{result['packageSha256']}；结果：{result['outcome']}。",
        'human_visual_acceptance=false。']
    return '\n'.join(lines)


if __name__=='__main__':main()

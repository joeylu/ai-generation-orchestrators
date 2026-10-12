"""Local monotonic phase measurements; never provider execution telemetry.

New host runs bind this journal separately from delivery evidence. Read-only
commands and historical runs do not create or repair timing records.
"""
from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps
from pathlib import Path
import time

POLICY = 'local-exclusive-phases-v1'
NAME = 'timing.json'
STAGES = ('planning', 'planning_preflight', 'planning_repair', 'planning_review', 'image_wait', 'receipt_processing',
          'registration', 'composite_review', 'packaging', 'orchestration')
_ACTIVE = ContextVar('ui_layer_timing', default=None)


def _switch(context, stage):
    now = time.perf_counter()
    old = context['phase']
    context['seconds'][old] = context['seconds'].get(old, 0.0) + now - context['last']
    context['last'], context['phase'] = now, stage


@contextmanager
def phase(stage):
    context = _ACTIVE.get()
    if context is None:
        yield
        return
    previous = context['phase']
    _switch(context, stage)
    try:
        yield
    finally:
        _switch(context, previous)


def measured(stage):
    def decorate(function):
        @wraps(function)
        def wrapped(*args, **kwargs):
            with phase(stage):
                return function(*args, **kwargs)
        return wrapped
    return decorate


@contextmanager
def capture():
    """Measure an offline replay without writing into its source run."""
    if _ACTIVE.get() is not None:
        raise ValueError('TIMING_CAPTURE_MUST_BE_INDEPENDENT')
    context = dict(phase='orchestration', seconds={}, last=time.perf_counter())
    token = _ACTIVE.set(context)
    try:
        yield context['seconds']
    finally:
        _switch(context, 'orchestration')
        _ACTIVE.reset(token)


def bound(root, config, stage):
    context = _ACTIVE.get()
    if context is not None and Path(root).resolve() == context.get('root'):
        context.update(validated=True, enabled=config.get('timingPolicy') == POLICY)
        context.setdefault('stage', stage)


def consumed(submission):
    context = _ACTIVE.get()
    if context is not None:
        context['consumed'] = submission
        context['receiveStartedUnixSeconds'] = context['startedUnixSeconds']


def track(action):
    """Outer host-operation timer. Nested resume/refill stay in one operation."""
    def decorate(function):
        @wraps(function)
        def wrapped(*args, **kwargs):
            if _ACTIVE.get() is not None:
                return function(*args, **kwargs)
            root_value = ((args[1] if len(args)>1 else kwargs['output']) if action == 'prepare'
                          else (args[0] if args else kwargs['run']))
            root = Path(root_value).resolve()
            context = dict(root=root, phase='receipt_processing' if action == 'receive' else
                           'planning' if action == 'prepare' else 'orchestration',
                           seconds={}, last=time.perf_counter(), startedUnixSeconds=time.time())
            token = _ACTIVE.set(context)
            result = None
            outcome = 'error'
            try:
                result = function(*args, **kwargs)
                outcome = 'returned'
                return result
            finally:
                _switch(context, 'orchestration')
                _ACTIVE.reset(token)
                terminal_noop = context.get('stage') in ('complete','diagnostic_complete','failed')
                if context.get('validated') and context.get('enabled') and not terminal_noop:
                    # The host contract serializes all mutations for one run.
                    # Take the same lock for the separate atomic timing pointer.
                    from .experimental_executor import lock
                    from .host_delivery import _control, _verify_control
                    with lock(root):
                        _verify_control(root, NAME)
                        reservations = []
                        if isinstance(result, dict):
                            rows = result.get('reservations', [result]) if action == 'next' else []
                            if result.get('nextImageRequest'):
                                rows = [result['nextImageRequest']]
                            for row in rows:
                                if 'submissionDigest' in row:
                                    reservations.append(dict(submissionDigest=row['submissionDigest'],
                                        stage='images' if action == 'receive' else context.get('stage')))
                        _control(root, NAME, dict(kind='ui_host_timing_event_v1', action=action,
                            stage=context.get('stage'), outcome=outcome,
                            startedUnixSeconds=context['startedUnixSeconds'], endedUnixSeconds=time.time(),
                            localSeconds=context['seconds'], reservations=reservations,
                            **({k:context[k] for k in ('consumed','receiveStartedUnixSeconds')} if 'consumed' in context else {})))
        return wrapped
    return decorate


def _union(intervals):
    total = 0.0
    end = None
    for left, right in sorted(intervals):
        total += max(0.0, right - max(left, end if end is not None else left))
        end = max(right, end if end is not None else right)
    return total


def report(run):
    """Verify the timing chain without requiring the current runtime fingerprint."""
    from .evaluate import read
    from .experimental_executor import verified
    from .host_delivery import _verify_control
    root = Path(run).resolve()
    config = verified(root/'config.json')
    if config.get('timingPolicy') != POLICY:
        return dict(kind='ui_host_timing_report_v1', status='unavailable-historical-run',
                    historicalTimingsInferred=False, generationCalls=0, modelCalls=0)
    _verify_control(root, NAME)
    events = [read(path)['value'] for path in sorted((root/'.journal'/NAME).glob('*.json'))]
    stages = {stage:dict(localSeconds=0.0, reservationWaitUnionSeconds=0.0,
                        reservationWaitSumSeconds=0.0, completedWaits=0) for stage in STAGES}
    pending = {}
    intervals = {stage:[] for stage in STAGES}
    invalid = 0
    mapping = dict(planning_generate='planning', planning_review='planning_review',
                   planning_repair='planning_repair',planning_rereview='planning_review',
                   images='image_wait', composite_review='composite_review')
    for event in events:
        for stage, seconds in event.get('localSeconds', {}).items():
            stages[stage]['localSeconds'] += seconds
        submission = event.get('consumed')
        if submission in pending:
            stage, start = pending.pop(submission)
            stop = event['receiveStartedUnixSeconds']
            if stop >= start:
                intervals[stage].append((start, stop))
                stages[stage]['completedWaits'] += 1
                stages[stage]['reservationWaitSumSeconds'] += stop-start
            else:
                invalid += 1  # Clock changes must not become negative durations.
        for row in event.get('reservations', []):
            stage = mapping.get(row['stage'], 'orchestration')
            pending[row['submissionDigest']] = (stage, event['endedUnixSeconds'])
    for stage, rows in intervals.items():
        stages[stage]['reservationWaitUnionSeconds'] = _union(rows)
    return dict(kind='ui_host_timing_report_v1', status='measured', policy=POLICY,
        operationCount=len(events)-1, stages=stages,
        localSeconds=sum(row['localSeconds'] for row in stages.values()),
        outstandingReservations=len(pending), invalidClockIntervals=invalid,
        waitBasis='local reservation end to receive/fail entry; includes host scheduling and transport; not pure provider latency',
        localClock='perf_counter; exclusive nested phases', waitClock='UTC Unix wall clock',
        concurrentWaitsSummedAsWallTime=False, historicalTimingsInferred=False,
        generationCalls=0, modelCalls=0)

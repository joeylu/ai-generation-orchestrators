"""Rolling host image calls through an explicit caller-supplied async adapter.

The adapter invokes the exact reservation once and returns the original PNG path.
This module has no provider, network, authorization, retry or image editing logic.
"""
import asyncio
import time

from . import host_delivery as host
from .host_timing import _union


async def run_images(run, invoke, *, maximum_concurrent_calls=3, capture_timings=False):
    """Drain a newly authorized image scope, refilling after each committed receipt.

    One coordinator owns this scope. Previously outstanding reservations require
    an explicit host decision and are never invoked by this convenience runner.
    On an adapter failure, stop refilling, retain other in-flight results, then
    terminalize the run. The adapter owns original tool evidence and source files.
    """
    if type(maximum_concurrent_calls) is not int or not 1 <= maximum_concurrent_calls <= 3:
        raise ValueError('FINITE_ROLLING_IMAGE_CONCURRENCY_REQUIRED')
    if type(capture_timings) is not bool:
        raise ValueError('EXPLICIT_DISPATCH_TIMING_BOOLEAN_REQUIRED')
    started = time.perf_counter() if capture_timings else None
    timings = {}
    active_adapter_calls = adapter_peak = 0

    def clock():
        return time.perf_counter()-started

    current = await asyncio.to_thread(host.status, run)
    if current['stage'] != 'images' or current['status'] != 'ready':
        raise ValueError('HOST_IMAGES_NOT_READY_NO_RESUBMIT')
    if current['outstandingRequestIds']:
        raise ValueError('HOST_OUTSTANDING_IMAGES_REQUIRE_HOST_DECISION')
    count = min(maximum_concurrent_calls, current['availableImageSlots'])
    batch = await asyncio.to_thread(host.next_request, run, count=count)
    reservations = ([dict(entry['currentRequest'], submissionDigest=entry['submissionDigest'], stage='images')
                     for entry in batch['reservations']] if 'reservations' in batch else [batch])
    pending = {}
    failures = []
    uncommitted = []
    uninvoked = []
    received = []
    peak = 0

    async def call(row, timing):
        nonlocal active_adapter_calls, adapter_peak
        if timing is None:
            return await invoke(row)
        timing['adapterStartedAtSeconds'] = clock()
        active_adapter_calls += 1
        adapter_peak = max(adapter_peak, active_adapter_calls)
        try:
            source = await invoke(row)
            timing['adapterOutcome'] = 'returned'
            return source
        except BaseException:
            timing['adapterOutcome'] = 'failed_or_cancelled'
            raise
        finally:
            timing['adapterFinishedAtSeconds'] = clock()
            active_adapter_calls -= 1

    def start(row, previous=None):
        nonlocal peak
        timing = None
        if capture_timings:
            timing = dict(submissionDigest=row['submissionDigest'], queuedAtSeconds=clock())
            if previous is not None:timing['refillAfterSubmissionDigest'] = previous
            timings[row['submissionDigest']] = timing
        pending[asyncio.create_task(call(row, timing))] = row
        peak = max(peak, len(pending))

    for row in reservations:
        start(row)
    try:
        while pending:
            done, _ = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
            # Notice every failure already returned in this completion group
            # before reserving another invocation after a successful result.
            failed = [task for task in done if task.cancelled() or task.exception() is not None]
            for task in failed:
                row = pending.pop(task)
                failures.append(row['submissionDigest'])
            for task in done - set(failed):
                row = pending.pop(task)
                source = task.result()
                if current.get('stage') == 'failed':
                    if capture_timings:timings[row['submissionDigest']]['receiptOutcome'] = 'uncommitted_after_failure'
                    uncommitted.append(dict(submissionDigest=row['submissionDigest'], response=source))
                    continue
                timing = timings.get(row['submissionDigest'])
                if timing is not None:timing['receiptStartedAtSeconds'] = clock()
                try:
                    current = await asyncio.to_thread(host.receive, run, row['submissionDigest'], source,
                                                      refill_images=not failures)
                    if timing is not None:timing['receiptOutcome'] = 'committed'
                except Exception:
                    # The deterministic receiver preserves/terminalizes bad input.
                    # Keep subsequent original paths for explicit host recovery.
                    failures.append(row['submissionDigest'])
                    if timing is not None:timing['receiptOutcome'] = 'failed'
                    current = await asyncio.to_thread(host.status, run)
                    uncommitted.append(dict(submissionDigest=row['submissionDigest'], response=source))
                    continue
                finally:
                    if timing is not None:timing['receiptFinishedAtSeconds'] = clock()
                received.append(row['submissionDigest'])
                if 'nextImageRequest' in current:
                    following=current.pop('nextImageRequest')
                    # A native call can fail while the serialized receiver is
                    # verifying bytes. Do not invoke a refill reserved before
                    # that failure became visible to this coordinator.
                    if any(task.done() and (task.cancelled() or task.exception() is not None)
                           for task in pending):
                        uninvoked.append(following['submissionDigest'])
                    else:
                        start(following, row['submissionDigest'])
        if failures and current.get('stage') != 'failed':
            current = await asyncio.to_thread(host.fail, run, failures[0], 'HOST_IMAGE_CALL_FAILED_NO_RESUBMIT')
    except BaseException:
        # Never replay a reservation when the coordinator is interrupted. Do not
        # cancel native invocations: their adapter retains original returned files.
        if pending:
            try:
                await asyncio.to_thread(host.fail, run, next(iter(pending.values()))['submissionDigest'],
                                        'HOST_IMAGE_DISPATCH_INTERRUPTED_NO_RESUBMIT')
            except ValueError:
                pass  # A failed receiver may already have terminalized the run.
        raise
    result = dict(state=current, receivedSubmissionDigests=received,
                failedSubmissionDigests=failures, uncommittedResults=uncommitted,
                uninvokedReservationDigests=uninvoked,
                maximumObservedConcurrentCalls=peak, automaticRetries=0,
                countBasis='coordinator in-flight adapter tasks; not provider execution telemetry')
    if capture_timings:
        intervals=[];receipt_sum=queue_sum=0
        for row in timings.values():
            intervals.append((row['adapterStartedAtSeconds'],row['adapterFinishedAtSeconds']))
            row['adapterWaitSeconds']=row['adapterFinishedAtSeconds']-row['adapterStartedAtSeconds']
            row['coordinatorStartQueueSeconds']=row['adapterStartedAtSeconds']-row['queuedAtSeconds']
            if 'receiptStartedAtSeconds' in row:
                row['receiptQueueSeconds']=row['receiptStartedAtSeconds']-row['adapterFinishedAtSeconds']
                row['receiptProcessingSeconds']=row['receiptFinishedAtSeconds']-row['receiptStartedAtSeconds']
                queue_sum += row['receiptQueueSeconds'];receipt_sum += row['receiptProcessingSeconds']
            if 'refillAfterSubmissionDigest' in row:
                previous=timings[row['refillAfterSubmissionDigest']]
                row['refillStartDelaySeconds']=row['adapterStartedAtSeconds']-previous['receiptFinishedAtSeconds']
        result['dispatchTimings']=dict(kind='ui_host_image_dispatch_timings_v1',
            elapsedSeconds=clock(), records=list(timings.values()),
            adapterWaitUnionSeconds=_union(intervals), adapterWaitSumSeconds=sum(e-s for s,e in intervals),
            receiptQueueSecondsSum=queue_sum, receiptProcessingSecondsSum=receipt_sum,
            maximumAdapterCallsAwaitingReturn=adapter_peak,
            timingBasis='coordinator perf_counter; adapter wait includes host/tool scheduling and transport; not provider latency',
            overlappingCategoriesAddToWallTime=False, persistedInHostRun=False,
            additionalGenerationCalls=0, additionalModelCalls=0, automaticRetries=0)
    return result

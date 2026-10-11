"""Rolling host image calls through an explicit caller-supplied async adapter.

The adapter invokes the exact reservation once and returns the original PNG path.
This module has no provider, network, authorization, retry or image editing logic.
"""
import asyncio

from . import host_delivery as host


async def run_images(run, invoke, *, maximum_concurrent_calls=3):
    """Drain a newly authorized image scope, refilling after each committed receipt.

    One coordinator owns this scope. Previously outstanding reservations require
    an explicit host decision and are never invoked by this convenience runner.
    On an adapter failure, stop refilling, retain other in-flight results, then
    terminalize the run. The adapter owns original tool evidence and source files.
    """
    if type(maximum_concurrent_calls) is not int or not 1 <= maximum_concurrent_calls <= 3:
        raise ValueError('FINITE_ROLLING_IMAGE_CONCURRENCY_REQUIRED')
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

    async def call(row):
        return await invoke(row)

    def start(row):
        nonlocal peak
        pending[asyncio.create_task(call(row))] = row
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
                    uncommitted.append(dict(submissionDigest=row['submissionDigest'], response=source))
                    continue
                try:
                    current = await asyncio.to_thread(host.receive, run, row['submissionDigest'], source,
                                                      refill_images=not failures)
                except Exception:
                    # The deterministic receiver preserves/terminalizes bad input.
                    # Keep subsequent original paths for explicit host recovery.
                    failures.append(row['submissionDigest'])
                    current = await asyncio.to_thread(host.status, run)
                    uncommitted.append(dict(submissionDigest=row['submissionDigest'], response=source))
                    continue
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
                        start(following)
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
    return dict(state=current, receivedSubmissionDigests=received,
                failedSubmissionDigests=failures, uncommittedResults=uncommitted,
                uninvokedReservationDigests=uninvoked,
                maximumObservedConcurrentCalls=peak, automaticRetries=0,
                countBasis='coordinator in-flight adapter tasks; not provider execution telemetry')

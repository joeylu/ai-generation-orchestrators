"""One local exchange per image; no provider calls or automatic retries."""
from pathlib import Path
import time
from . import workflow as w
from .workflow_bridge import receive_generation, export_generation, record_submission
from .adapter import builtin_image_arguments
from .common import require, write_json


def exchange(job, *, request_digest=None, source=None):
    """Receive the previous image and return exact arguments for the next call.

    A failed/interrupted exchange is never replayed automatically: official
    one-use reservations and submission records remain authoritative.
    """
    require((request_digest is None) == (source is None), 'EXCHANGE_RESULT_PAIR_REQUIRED')
    started = time.perf_counter()
    received_seconds = 0.0
    if request_digest is not None:
        status = receive_generation(job, request_digest, Path(source))
        received_seconds = time.perf_counter()-started
        if status['status'] not in ('ready','awaiting_external') or status.get('nextNode') == 'process':
            return dict(status=status, nextRequest=None, timings=dict(
                receiveSeconds=received_seconds,prepareSeconds=0.0,totalSeconds=time.perf_counter()-started))
    # export verifies fresh job authorization, immutable inputs and budget.
    assigned = export_generation(job)
    bundle = Path(assigned['bundle'])
    arguments = builtin_image_arguments(bundle)
    arguments_path = bundle/'invocation-arguments.json'
    write_json(arguments_path, arguments)
    submission = record_submission(job, assigned['requestDigest'], arguments_path)
    elapsed = time.perf_counter()-started
    return dict(status=assigned, nextRequest=dict(asset=assigned['request'],
        requestDigest=assigned['requestDigest'],arguments=arguments,
        submissionDigest=submission['submissionDigest']), timings=dict(
        receiveSeconds=received_seconds,prepareSeconds=elapsed-received_seconds,totalSeconds=elapsed))

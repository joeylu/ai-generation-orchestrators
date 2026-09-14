"""Local acceptance timing and a cooperative deadline; never retries work."""
from time import monotonic

from .common import ContractError, require


class AcceptanceExecution:
    def __init__(self, timeout_seconds):
        require(type(timeout_seconds) is int and 1 <= timeout_seconds <= 86400,
                'STATE_TIMEOUT_INVALID')
        self.limit = timeout_seconds
        self.started = monotonic()
        self.stages = []

    def finish(self, status='passed'):
        if self.stages and self.stages[-1]['status'] == 'running':
            stage = self.stages[-1]
            stage['elapsedSeconds'] = round(monotonic() - stage.pop('_started'), 6)
            stage['status'] = status

    def start(self, name):
        self.finish()
        self.stages.append({'name': name, 'status': 'running', '_started': monotonic()})
        self.remaining()

    def remaining(self):
        remaining = self.limit - (monotonic() - self.started)
        if remaining <= 0:
            raise ContractError('STATE_ACCEPTANCE_TIMEOUT')
        return remaining

    def report(self, failed=False):
        self.finish('failed' if failed else 'passed')
        return {'kind': 'ui_acceptance_execution_v1', 'timeoutSeconds': self.limit,
                'elapsedSeconds': round(monotonic() - self.started, 6),
                'automaticRetries': 0, 'stages': self.stages}

from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping, Protocol


class ProviderError(RuntimeError):
    """Base provider failure."""


class GenerationNotSubmitted(ProviderError):
    """Failure is known to have occurred before provider submission."""


class GenerationIndeterminate(ProviderError):
    """Submission may have occurred but result cannot be established."""


class GenerationFailed(ProviderError):
    """Provider returned a trustworthy terminal generation failure."""


class Provider(Protocol):
    def doctor(self) -> Mapping[str, Any]: ...

    def submit_once(self, plan: Mapping[str, Any], submission_token: str) -> str: ...

    def await_result(self, request_id: str, destination: Path) -> Path: ...

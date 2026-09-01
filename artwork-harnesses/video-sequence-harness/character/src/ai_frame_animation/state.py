from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .canonical import SHA256_RE, stamp_document, verify_document


TERMINAL_STATES = {
    "RAW_READY",
    "GENERATION_NOT_SUBMITTED",
    "GENERATION_INDETERMINATE",
    "FAILED",
}

ALLOWED_TRANSITIONS = {
    "AUTHORIZED": {"GENERATING", "GENERATION_NOT_SUBMITTED"},
    "GENERATING": {"SUBMITTED", "GENERATION_NOT_SUBMITTED", "GENERATION_INDETERMINATE", "FAILED"},
    "SUBMITTED": {"RAW_READY", "GENERATION_INDETERMINATE", "FAILED"},
}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _safe_attempt_id(value: str) -> str:
    if not value or len(value) > 96 or any(character not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_." for character in value):
        raise ValueError("attempt_id_invalid")
    if value in {".", ".."}:
        raise ValueError("attempt_id_invalid")
    return value


@dataclass
class AttemptStore:
    state_root: Path
    attempt_id: str

    @property
    def directory(self) -> Path:
        return self.state_root / _safe_attempt_id(self.attempt_id)

    @property
    def events_path(self) -> Path:
        return self.directory / "events.jsonl"

    def create_authorized(self, *, plan_sha256: str, confirmed_sha256: str) -> None:
        if not SHA256_RE.fullmatch(plan_sha256) or confirmed_sha256 != plan_sha256:
            raise ValueError("compute_confirmation_does_not_match_plan")
        self.state_root.mkdir(parents=True, exist_ok=True)
        try:
            self.directory.mkdir()
        except FileExistsError as exc:
            raise ValueError("attempt_already_exists_or_consumed") from exc
        self._append(
            "AUTHORIZED",
            {
                "plan_sha256": plan_sha256,
                "authorization": "single_use_confirmed",
            },
            exclusive=True,
        )

    def append(self, state: str, detail: dict[str, Any] | None = None) -> None:
        events = self.read()
        if not events:
            raise ValueError("attempt_not_initialized")
        if events[-1]["state"] in TERMINAL_STATES:
            raise ValueError("attempt_is_terminal")
        if state not in ALLOWED_TRANSITIONS.get(str(events[-1]["state"]), set()):
            raise ValueError("attempt_transition_invalid")
        self._append(state, detail or {})

    def read(self) -> list[dict[str, Any]]:
        if not self.events_path.is_file():
            return []
        events: list[dict[str, Any]] = []
        previous: str | None = None
        previous_state: str | None = None
        for expected_sequence, line in enumerate(self.events_path.read_text(encoding="utf-8").splitlines(), start=1):
            value = json.loads(line)
            if not isinstance(value, dict):
                raise ValueError("attempt_event_invalid")
            if value.get("sequence") != expected_sequence or value.get("previous_event_sha256") != previous:
                raise ValueError("attempt_event_chain_invalid")
            state = value.get("state")
            if (
                value.get("schema_version") != "ai_frame_animation_attempt_event_v1"
                or value.get("attempt_id") != self.attempt_id
                or not isinstance(value.get("at"), str)
                or not isinstance(value.get("detail"), dict)
                or not isinstance(state, str)
            ):
                raise ValueError("attempt_event_invalid")
            if expected_sequence == 1 and state != "AUTHORIZED":
                raise ValueError("attempt_initial_state_invalid")
            if expected_sequence > 1 and state not in ALLOWED_TRANSITIONS.get(str(previous_state), set()):
                raise ValueError("attempt_transition_invalid")
            previous = verify_document(value, "event_sha256")
            previous_state = state
            events.append(value)
        return events

    def _append(self, state: str, detail: dict[str, Any], *, exclusive: bool = False) -> None:
        existing = [] if exclusive else self.read()
        event = {
            "schema_version": "ai_frame_animation_attempt_event_v1",
            "sequence": 1 if exclusive else len(existing) + 1,
            "at": _utc_now(),
            "attempt_id": self.attempt_id,
            "state": state,
            "detail": detail,
            "previous_event_sha256": None if exclusive else existing[-1]["event_sha256"],
        }
        event = stamp_document(event, "event_sha256")
        flags = os.O_WRONLY | os.O_CREAT | (os.O_EXCL if exclusive else os.O_APPEND)
        descriptor = os.open(self.events_path, flags, 0o600)
        try:
            os.write(descriptor, json.dumps(event, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n")
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

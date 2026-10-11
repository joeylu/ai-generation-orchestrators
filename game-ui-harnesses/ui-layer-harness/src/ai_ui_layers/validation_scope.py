"""Reuse pure validation only within one operation, after hashing current bytes.

No attempt state, receipts, authorizations or trust are cached between operations.
Directory inventory is included so optional inputs cannot appear unnoticed.
"""
from contextlib import contextmanager
from contextvars import ContextVar
from copy import deepcopy
from functools import wraps
import hashlib
import json
from pathlib import Path


_ACTIVE = ContextVar('ui_layer_validation_scope', default=None)


@contextmanager
def scope(*, reuse=True):
    current = _ACTIVE.get()
    if current is not None:
        yield
        return
    token = _ACTIVE.set({} if reuse else False)
    try:
        yield
    finally:
        _ACTIVE.reset(token)


def operation(function):
    @wraps(function)
    def wrapped(*args, **kwargs):
        with scope():
            return function(*args, **kwargs)
    return wrapped


def _fingerprint(folder):
    folder = Path(folder).resolve()
    if not folder.is_dir():
        return None
    rows = []
    for path in sorted(folder.rglob('*')):
        # Do not memoize trees whose dependency closure needs link traversal.
        if path.is_symlink() or getattr(path, 'is_junction', lambda: False)():
            return None
        name = path.relative_to(folder).as_posix()
        if path.is_file():
            rows.append((name, hashlib.sha256(path.read_bytes()).hexdigest()))
        elif path.is_dir():
            rows.append((name, 'directory'))
        else:
            return None
    return str(folder), tuple(rows)


def tree_result(function):
    """Memoize a pure validator/builder whose file inputs are below argument 1."""
    @wraps(function)
    def wrapped(folder, *args, **kwargs):
        cache = _ACTIVE.get()
        if cache is None or cache is False:
            return function(folder, *args, **kwargs)
        fingerprint = _fingerprint(folder)
        if fingerprint is None:
            return function(folder, *args, **kwargs)
        arguments = json.dumps([args, kwargs], sort_keys=True, allow_nan=False,
                               separators=(',', ':'))
        key = (function, fingerprint, arguments)
        if key in cache:
            return deepcopy(cache[key])
        result = function(folder, *args, **kwargs)
        if _fingerprint(folder) != fingerprint:
            raise ValueError('VALIDATION_INPUT_CHANGED_DURING_OPERATION')
        # Bound memory even when a long deterministic operation visits many trees.
        if len(cache) >= 128:
            cache.pop(next(iter(cache)))
        cache[key] = deepcopy(result)
        return result
    return wrapped

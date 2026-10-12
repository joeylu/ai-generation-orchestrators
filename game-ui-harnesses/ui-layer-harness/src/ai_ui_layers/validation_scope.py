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
import os
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
    pending = [(str(folder), '')]
    while pending:
        directory, prefix = pending.pop()
        with os.scandir(directory) as entries:
            for entry in entries:
                # DirEntry shares directory metadata across these queries. Never
                # follow links or reuse a result from a linked dependency tree.
                if entry.is_symlink():
                    return None
                junction = getattr(entry, 'is_junction', None)
                if junction is not None:
                    if junction():
                        return None
                elif os.name == 'nt' and getattr(
                        entry.stat(follow_symlinks=False), 'st_file_attributes', 0) & 0x400:
                    # Python 3.10 has no is_junction; reject reparse points there.
                    return None
                name = prefix + entry.name
                if entry.is_file(follow_symlinks=False):
                    with open(entry.path, 'rb') as source:
                        rows.append((name, hashlib.sha256(source.read()).hexdigest()))
                elif entry.is_dir(follow_symlinks=False):
                    rows.append((name, 'directory'))
                    pending.append((entry.path, name + '/'))
                else:
                    return None
    return str(folder), tuple(sorted(rows))


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

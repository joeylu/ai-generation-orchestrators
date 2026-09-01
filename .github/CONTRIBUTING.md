# Contributing

Read [AGENTS.md](../AGENTS.md) before changing code or documentation.

## Development checks

```powershell
python -m pip install -e ".[dev]"
python -m unittest discover -s artwork-harnesses/image-background-removal-harness/tests -p "test_*.py"
python -m unittest discover -s artwork-harnesses/video-sequence-harness/character/tests -p "test_*.py"
python -m unittest discover -s .github/repository-tests -p "test_*.py"
```

Tests must be offline and deterministic. Use fixtures and test doubles; never
start or connect to ComfyUI, submit `/prompt`, consume GPU, or call a private
service from the test suite.

FFmpeg tool-lock changes must use a dated retained asset rather than a rolling
alias, update the pinned asset metadata and license, keep archive/path checks
intact, and use a synthetic local ZIP test double. CI must not download the real
FFmpeg archive.

## Golden regression policy

A change to matte, spill cleanup, alpha, GIF, sampling, timeline, alignment, or
packaging needs a fixture that reproduces the corresponding observed failure.
Record fixture provenance as one of:

- `synthetic_reproduction` — a minimal public reconstruction of the failure;
- `sanitized_real_crop` — a reviewed, redistributable crop from a real sample;
- `accepted_real_sample` — a redistributable real input with explicit approval.

Generated production candidates are not accepted goldens until their expected
foreground/background and continuity behavior has been manually labelled. Never
commit private source artwork, raw production video, host paths, or credentials.
Historical code or a deleted synthetic test proves that a regression existed but
does not by itself establish the correct pixel classification for a new matte
policy.

## Change shape

Keep provider-neutral contracts, deterministic media changes, provider plugins,
goldens, and release/governance changes reviewable as separate commits. Do not
copy a production directory wholesale.

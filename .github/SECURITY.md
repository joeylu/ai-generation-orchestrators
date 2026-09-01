# Security policy

## Reporting

Report suspected credential exposure, unsafe path handling, authorization replay,
or unintended provider submission privately to the project maintainers. Do not
open a public issue containing credentials, private endpoints, workflow/model
paths, source artwork, or production media.

## Supported versions

Until a stable `1.x` release exists, only the latest tagged release receives
security fixes.

## Security invariants

- Plans and authorizations are digest-bound; authorizations are single-use.
- Provider submission occurs at most once per attempt.
- Paths are resolved under caller-selected roots before file mutation.
- Diagnostic output redacts secrets, URLs with query strings, and private paths.
- Release consumers verify immutable artifact SHA-256 values.
- Video planning accepts an optional background-removal producer only through a
  workspace-relative, digest-bound `ai_reference_preparation_handoff_v1`; it
  never trusts a bare remote URL or imports the producer implementation.
- Project-local FFmpeg installation uses a packaged platform lock, verifies the
  asset byte count and SHA-256, rejects unsafe archive paths, and records local
  provenance without modifying system `PATH`.
- Tests do not access private services or real provider compute.

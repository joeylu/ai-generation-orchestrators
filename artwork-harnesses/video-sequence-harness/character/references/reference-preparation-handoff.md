# Reference preparation handoff v1

`ai_reference_preparation_handoff_v1` is the only coupling between the character
video Harness and an optional still-image background-removal producer. The
producer may be a local CLI, an MCP tool, or another deterministic service. The
video package does not import the producer package or require a producer name.

The producer or its trusted adapter must materialize this bundle inside the
video workspace before `plan` runs:

```text
reference.png
prepared/
  foreground.png
  preparation.json
  handoff.json
```

`handoff.json` has exactly these fields:

```json
{
  "schema_version": "ai_reference_preparation_handoff_v1",
  "producer": {"name": "non-empty producer id", "version": "non-empty version"},
  "source": {"path": "reference.png", "bytes": 1, "sha256": "...", "media_type": "image"},
  "foreground": {"path": "prepared/foreground.png", "bytes": 1, "sha256": "...", "media_type": "image"},
  "preparation_report": {"path": "prepared/preparation.json", "bytes": 1, "sha256": "...", "media_type": "application/json"},
  "producer_result_sha256": "...",
  "visual_review_required": true,
  "handoff_sha256": "..."
}
```

Every digest is lowercase SHA-256. `handoff_sha256` is computed from canonical
UTF-8 JSON with sorted keys and compact separators after omitting only the
`handoff_sha256` field. Paths use `/`, are relative to the workspace, and may not
be absolute, contain `..`, name a symlink, or escape the workspace. The consumer
recomputes byte counts and digests before planning and again before generation.

The foreground must be a single-frame RGBA PNG with a visible subject and
meaningful exterior transparency. It is still subject to human visual review;
contract validity is not proof of a correct matte. The source fingerprint must
match the original reference named by the job.

An MCP response may use any private transport contract, but its adapter must
finish downloading and verifying the three artifacts and write the canonical
local handoff before returning success. URLs, credentials, endpoints, model
paths, host paths, retry state, and service authorization never enter the public
handoff. The Agent must not construct, repair, or re-sign it.

Legacy `ai_frame_animation_reference_preparation_v1` through `v7` reports are
temporarily accepted by the video CLI for migration. New producers must emit v1
handoff bundles; consumers should not depend on the legacy report internals.

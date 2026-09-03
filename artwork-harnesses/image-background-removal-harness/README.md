# Image background removal harness

**Status: implemented by the independent `ai-image-background-removal` CLI.**

Opaque still images use fal BiRefNet V2's refined transparent foreground output.
Local work is deliberately lightweight: alpha/output validation, transparent-RGB
cleanup, proportional fitting, review rendering, fingerprinting, and atomic
publication. Meaningful existing alpha bypasses remote compute.

The public artifacts remain `cutout.png`, `foreground.png`, `preparation.json`,
and the provider-neutral `handoff.json`. The current remote preparation report is
`ai_frame_animation_reference_preparation_v8`; downstream consumers continue to
use `ai_reference_preparation_handoff_v1` and do not depend on fal or this package.

Every opaque-image request requires a fresh plan digest confirmation. Once an
attempt starts it is terminal: an uncertain response is never automatically
resubmitted. The result always requires visual review.

`General Light 1024` remains the single-model default. An explicit experimental
offline `qa consensus` command can compare previously generated Light 1024,
Light 2K, and Matting handoffs. It only accepts the Light 1024 foreground when
both alpha-IoU gates pass; otherwise it returns a nonzero rejection. It never
contacts fal, invokes another model, or selects a fallback candidate.

Read [SKILL.md](SKILL.md) for the Agent workflow and
[`docs/reference-preparation.md`](docs/reference-preparation.md) for the CLI and
artifact contracts. External schedulers and services should also follow the
[runtime integration contract](docs/runtime-integration.md) and the published
[fal V2 benchmark limits](docs/fal-v2-benchmark.md).

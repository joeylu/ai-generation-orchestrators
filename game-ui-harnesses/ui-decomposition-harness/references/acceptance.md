# Acceptance evidence

The isolated predecessor was frozen after three distinct generated-reference
families passed its deterministic assembly and PSD roundtrip checks:

| Family | Image calls | PSD pixel layers | Automatic retries | Result |
| --- | ---: | ---: | ---: | --- |
| Portrait inventory grid | 34 | 56 | 0 | Passed |
| Landscape shop dialog | 23 | 26 | 0 | Passed after one bounded material correction decision |
| Ultrawide HUD and settings | 19 | 25 | 0 | Passed |
| **Total** | **76** | **107** | **0** | Layer and composite maximum error 0 |

Those runs established the coarse control-list flow, global key removal,
important-component grouping, repeated-family reuse, and layered PSD output. They
did not establish general visual understanding.

The 0.2.1 runtime is covered by fifty-nine offline tests. They exercise strict
provider-neutral plans, single-use request state, terminal indeterminate results,
global key removal including enclosed holes, uniform reuse scaling, digest-bound
visual review, background role independence from asset names, rejection of
provider-specific extension fields, actual image dimensions and resource limits,
transparent provider results, portable file-adapter handoff without premature
single-use consumption, offline doctor and self-test, assembly, and real PSD
layer/composite roundtrip. Explicit nine-slice coverage includes unchanged legacy
processing, generated/reused component integration, strict inset validation,
horizontal and vertical resizing, unchanged corner pixels and partial alpha,
identity resizing, and rejection of missing or insufficient foreground.
Result-reuse regressions verify zero-call accounting, unchanged originals, fresh
review requirements, no provider reservation or duplicate import for cached
assets, strict source/prompt/reference binding, raw-image tamper rejection before
processing, failed-source rejection, and provider-neutral cache fields.
The five related
predecessor suites also pass 170 tests unchanged.

The development headless suite adds model-output validation, bounded planning and
generation, authorization/dependency preflight, stopped crash/failure recovery,
completed-job artifact reuse, credential-safe errors, preserved reviewed gates and
real draft PSD roundtrip. MCP protocol doubles verify persistence before submission,
task polling, JSON/SSE envelopes, no automatic resubmission, media host allowlists,
redirect rejection and omission of API credentials from downloads. Response-error
regressions cover distinct remote/JSON-RPC/decoding failures, persistence of raw
replies before parsing, rejection without a second business submission, and local
rejection of leading/trailing vision-instruction whitespace before any network I/O.
They also verify that a frozen material-only run can use image generation without
requiring a configured vision endpoint, while a planning request rejects that
configuration before any network call. No offline test submits a real provider
task or contacts a network service.

The 0.2.1 headless path adds a mandatory second vision call after all materials are
processed. It submits only the original reference, private assembled candidate
preview and contact sheet, then validates a strict score-only receipt. A passing
assessment requires an explicit accept decision, 80 overall, 70 in every criterion
and no blocker issue. Tests cover the exact three-image MCP shape, no imagegen call
during that assessment, absent vision configuration rejected before network access,
safe receipt materialization, failed policy claims, terminal rejection with no
`delivery/`, and no repeat-run retry. The quality gate is not a human review and
does not create or alter `review.json`.

One separately authorized live vision-only check on a 1536 x 1024 shop reference
returned a valid JSON proposal without manual response editing: 12 unique assets,
20 nodes, one group and eight additional reused instances. Background and main
panel were separate; card base, quantity badge, price strip and purchase button
each had three instances. This followed correction of a trailing newline rejected
by the service before queue admission. No image-generation request was submitted
for that plan. One successful response does not establish general JSON reliability,
useful grouping across layouts or visual accuracy.

A separate, explicitly authorized live completion then froze a new plan, reused
eight prior ordinary received raw results and made four bounded image-generation
calls for the remaining materials. All twelve materials passed deterministic
processing; the resulting 20-layer draft PSD passed grouped layer, pixel-placement,
RGBA and composite roundtrip checks with maximum error 0. The run used no automatic
retry and no automatic human visual acceptance. This is technical end-to-end evidence for
the configured adapter shape only; it does not establish provider availability,
general planning quality, component fidelity or Photoshop application validation.

Photoshop application opening was not run during the public migration. The 0.2.1
automatic quality gate has offline contract evidence only; no live provider run has
yet exercised it, so its scoring reliability is not established. Model-based
component proposals and visual quality still need production monitoring. Automatic
human visual acceptance, recovery of hidden pixels and PSB writing remain outside
this release's accepted evidence.

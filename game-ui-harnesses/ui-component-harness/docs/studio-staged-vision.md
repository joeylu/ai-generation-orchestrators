# Two-stage observation and contract generation

Status: experimental, off by default. The first live trial passed complete
expected-type coverage on only 2/20 regression samples and 0/4 independent
samples, versus 12/20 for the refined single-stage adapter. Offline protocol
tests passing does not establish recognition quality. See [findings](../reports/intent-staged-live.md).
The local entry now uses the separate [observation-only deterministic
preview](studio-semantic-compiler.md); the two-model staged path remains opt-in.

Select `scripts/studio-staged-vision.mjs` with the existing server-only
`UI_VISION_ADAPTER` setting. The original single-stage adapter remains available.
Both require the package's Node 22.18+ runtime. No provider setup is part of the
engine-neutral compiler or exported component bundle.

One user upload authorizes a bounded pipeline: first observe the image, then,
only for a validated observation, generate its component contract. These are
two distinct model tasks, not retries. The staged adapter's poll may advance
the second stage; the original adapter's poll only reads its existing task.
Pending responses retain the same browser-safe pipeline ID. Persistent stage
identity and a one-use submission guard prevent repeated queries from creating
duplicate model tasks. Failed or indeterminate submissions are not retried.

The first task returns only a source-bound observation:

```ts
{ version: '0.2', sourceSha256, status: 'Observed', summary,
  components: [{ id, parentId, componentType,
    bounds: { x, y, width, height }, evidence, visibleProps }] }
// Uncertainty or unsupported semantics stops before contract generation:
{ version: '0.2', sourceSha256,
  status: 'Unresolved' | 'Custom-required', summary }
```

At most 32 observed components are allowed. Bounds use absolute source-image
coordinates and must lie inside the decoded image. Evidence is nonempty text;
it is an explanation supplied by the model, not independent visual proof.
Visible properties are optional, type-specific facts. Business flags such as
enabled/readOnly, styles and missing text are not filled into the observation.
Multiple observation roots are allowed; no synthetic root is required here.

Observation v0.2 removes Image fit/region, Text wrap/overflow/lineHeight,
Slider step and ScrollView metrics from the observation vocabulary. Every
visible property is optional; unknown optional facts do not force Unresolved.
Empty visibleProps is valid. Source identity, component identity, bounds and
evidence remain mandatory. The v0.1 decoder remains unchanged for old results;
new staged submissions require v0.2 and cannot downgrade to v0.1.

In v0.2, a noncomposite control can semantically own a Text label. The contract
places them under the same composite ancestry, with optional helper Containers,
instead of creating illegal render children. Moving either to an unrelated
observed composite remains a binding failure.

The second task receives the observation identities and visible facts, the image,
and schemas for the relevant component types. It returns the existing flat v0.2
contract. Required unknown semantic fields must cause `Unresolved`, not invented data.
Oversized prompts fail closed rather than dropping observations.

Observation v0.2 selects explicit preview-configuration policy v1: interactive
controls use enabled=true; Input uses readOnly=false and maxLength=1024;
Dialog uses modal=false; Text uses wrap=none and overflow=clip. These configure
the local preview and do not assert the source application's business behavior.
The model must emit those values explicitly and the compiler checks them; it
never fills or repairs omitted values. No policy supplies text, selection,
numeric ranges, Slider step, hidden content or business actions. Render styles,
fit and line height are reconstruction choices outside semantic observations.
The policy is immutable and included in the adapter's template fingerprint.
The v0.2 retest passed 13/20 original samples and 4/4 added samples, with 24/24
valid observations. The original-set gain over single-stage is only one sample
and includes regressions; keep staged opt-in. Previous scores remain frozen.
See [live retest](../reports/intent-semantic-v2-live.md).

The final source-bound HTTP envelope is:

```ts
{ version: '0.3', sourceSha256, status, summary, observation, contract }
```

Ready requires successful strict flat compilation and cross-stage binding.
Every observed ID must remain present with the same component type, observed
parent relationship and visible property values. Only additional Image, Text
and Container nodes are permitted; unobserved controls cannot be added. Generic
unobserved Container wrappers may occur between an observed parent and child.
For Tabs, visible id/label records do not invent hidden content IDs.

Non-Ready comes from a non-Observed first stage with `contract: null`, or a
validated observation and a non-Ready second-stage response. It cannot contain
a renderable fallback contract. The browser clears stale output, disables export,
and preserves allowlisted rejection diagnostics. It waits up to four minutes
for the pipeline; a browser timeout does not cancel an accepted remote task.

Observation bounds are source-range checked but this version does not compare
them to final layout boxes or perform visual occlusion analysis. It protects
identity and visible-property consistency, not pixel fidelity. Incorrect first
stage observations can still lead to incorrect contracts. Perception accuracy,
contract compilation, cross-stage preservation and end-to-end expected-type
coverage must therefore be scored separately. Offline mocked tests are separate
from live evaluation and do not contact model services.

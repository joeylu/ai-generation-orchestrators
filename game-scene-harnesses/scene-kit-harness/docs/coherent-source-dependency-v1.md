# Same-workflow source dependency

Use this optional revised-source contract when an independently generated
occluder must be planned with an existing, separately owned transparent
landmark or scenery source as a spatial reference. It does not extract pixels,
edit a mask or transfer source or final art acceptance.

The producer must be a direct v27 source or checked coherent rebind in the same current coherent batch,
already received with passing rechecked technical QA and an explicit accepted
source-review record bound to its exact plan, native image and QA. An Agent may
record an intermediate review only within the user's existing authorization;
that is not a final human art decision. Pending, failed, rejected, unknown or
stale sources cannot be dependencies. Source and dependent plan must share the
same exact reference plan, reconstruction target, spec and style. Their asset
IDs must differ. A rebind's target plan, source evidence, proposal and target
QA are independently replayed; the target workflow also requires its own exact
source review. Prepared producers are not supported by this version. The
dependency-bearing source itself cannot be cross-workflow rebound.
Rebind commits replay the selected source workflow at adoption; the retained
path-free source evidence is a local integrity record, not a signed provider
attestation or a substitute for preserving the original workflow.

After reception and source review, revise the affected source in the same batch
with an explicit new dependency (for example through `coherent revise --options`):

```json
{"batchId":"occluder.revised","allowUnsubmittedDependency":true,
 "expectedBatchSha256":"CURRENT_BATCH_SHA256","replacements":[{
  "assetId":"occluder.actual","planId":"occluder.plan.new",
  "intent":"isolated-layer-v4",
  "sourceDependency":{"format":"ai_scene_source_dependency_v1",
    "sourcePlanSha256":"BRIDGE_PLAN_SHA256",
    "placement":{"x":100,"y":120,"scale":{"numerator":1,"denominator":2}},
    "observations":[{"observationId":"bridge.end","native":{"x":200,"y":100}}]}
}]}
```

`placement` maps native source pixels to world coordinates; observations are
finite native-pixel positions, not code or filesystem paths. The compiler binds
the full PNG, reviewed source plan, raw SHA, technical QA and exact review SHA;
input 1 stays the complete original reference and input 2 is the original
bridge PNG. The prompt asks for the independent occluder and explicitly excludes
copying the bridge. Two-image capability is required; a request already using
an image guide is rejected instead of replacing it or adding a third image.
This explicit option is limited to one dependent replacement whose target is
still planned, without authorization or attempt. The referenced source must be
accepted, both sources must belong to the exact current batch, and no source in
that batch may be failed, unknown, rejected or in flight. The transaction checks
these facts again under the workflow lock. It does not authorize the new plan;
ordinary planned-source replacement does not gain this exception.

For an independently reviewed source used only as an appearance reference,
select the additive `ai_scene_source_appearance_dependency_v1` format with
exactly `format` and `sourcePlanSha256`. This binds the same accepted source,
QA, review, rebind evidence, reference and batch, but has no placement or
observed contact points. Input 2 is restricted to material color, contrast,
light, brushwork and transparent openings; it cannot supply subject, structure
or spatial layout. The source brief and image 1 retain ownership of the new
subject. It does not certify output transparency, source semantics or art
quality. The original spatial v1 request and plan bytes are unchanged.

For new requests prefer `ai_scene_source_appearance_dependency_v2`, with the
same exact fields, source/QA checks, batch binding and two-input limit. It
leaves atmosphere and glow requirements to the explicit source brief instead of
imposing v1's blanket prohibition. The v1 compiler branch remains unchanged:
its frozen plans, prompt bytes and replays retain the original prohibition.
Selecting v2 is a fresh revision requiring its own plan and authorization; it
cannot amend a previously frozen or attempted plan.

Freeze a fresh plan and authorize its new batch separately, reserve once and
never reuse an old intent or retry an unknown result. A dependent revision of
an indeterminate parent is refused. The producer must remain
in the dependent batch; changing it requires a new dependent plan. Input reads,
authorization and reservation recheck the producer and review identity and
require the latest coherent batch to contain both exact plans.
The plan records a proposed placement and points; it does not enforce that a
later author map uses that transform. Native Alpha, correct occlusion, actual
Studio placement, editable brush behavior and final art still need independent
review. Tests use only synthetic sources and providers.

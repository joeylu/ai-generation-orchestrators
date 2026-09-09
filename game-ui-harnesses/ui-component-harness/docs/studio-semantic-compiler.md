# Observation-only recognition and deterministic preview

`scripts/studio-semantic-vision.mjs` is the observation-only adapter. It uses
one model task per input, then returns a source-bound v0.4 envelope:

```ts
{ version: '0.4', sourceSha256, status: 'Observed' | 'Unresolved' | 'Custom-required',
  summary, observation } // observation is the existing v0.2 semantic format
```

Configure its absolute filesystem path in the server-only `UI_VISION_ADAPTER`
setting. Starting the local preview server does not submit a model task.

The browser validates this exact envelope and calls
`compileSemanticObservation(observation, source, NEUTRAL_SEMANTIC_PREVIEW_POLICY_V1)`.
The model does not author the render contract. Pending responses keep v0.1
receipt shape; polling only reads the accepted observation task. Source,
instruction and protocol identities are persisted, and ambiguous submission
outcomes never authorize a new model job.

## Compilation boundary

The required policy argument is explicit and deeply immutable. It defines
neutral procedural styles, editable local controls, Input length limit,
nonmodal Dialog previews, text wrapping and clipping, Image fit, Slider step
from observed decimal precision, and List row height from the visible extent.
ScrollView starts at zero with an extent covering visible children. These are
preview settings, not inferred business state or claims about hidden content.

Semantic values must be present in the observation. Empty text, false and zero
are preserved when explicit; absence is not converted into any of them. Every
missing required value is returned with its component ID, field and reason.
Tabs cannot compile until a supported source for their content mapping exists;
hidden pages are never replaced with invented placeholders. All sixteen types
are recognized by this boundary, but Tabs presently reports Unresolved.

The program preserves observed IDs and generates collision-free document and
wrapper IDs. It converts absolute observed bounds to parent-relative layouts,
and flattens semantic children of leaf controls to the nearest legal composite
parent. Image regions are deterministic floor/ceil source crops, bounded by the
source dimensions. The existing strict tree compiler validates the final result.
Canvases over 4096 pixels per axis are rejected, not silently resized.

## Studio behavior

The page labels this mode as a neutral structural preview, not artwork
reconstruction. It renders valid documents, enables motion comparison and export,
and lists missing semantic information for incomplete results.

An expandable local editor permits type correction and scalar fact confirmation.
Changing a type clears that node's previous property set rather than carrying
incompatible facts forward. An explicit confirmation checkbox distinguishes an
empty text value from an unknown value. Editing clears the old preview and
disables export until the new candidate passes compilation. Applying corrections
does not call the provider. The original model observation remains unchanged;
edits affect a clone. Array contents, hidden pages and layout editing are not
provided by this editor.

Exported bundles record the neutral policy and local correction revision count
in provenance. Restoring a neutral bundle retains the neutral-preview notice;
the bundle does not contain the original observation or an editable correction
history. Original uploaded/reference resources remain source-bound.

Legacy single-stage and two-stage adapters remain available. Neither old raw
observations nor live evaluation logs are rewritten. Offline replay is scored
separately from recognition and cannot establish model stability.

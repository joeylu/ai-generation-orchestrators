---
name: ui-component-harness
description: Compile explicit UI component intent or documents with local resources, validate interaction motion in a local PixiJS workbench, and export a verified portable bundle.
---

# UI Component Harness

Use this Skill when a user wants a local UI component contract, a resource-backed
PixiJS component preview, or a portable UI bundle. The runtime is local and
provider-neutral. Deterministic compilation does not call a model or publish a
result. The local Studio has an optional Codex CLI session planning adapter for
layer ZIPs, invoked only by the explicit **Codex 生成组件方案并预览** action.

## Author the input with the user

Treat a delivered layer ZIP as immutable. The user-approved consumer policy
allows Image.region crops, reference-corrected child order and explicit real
procedural controls when raster parts are missing. Current native plans must
include adaptations; every crop, reordered parent and procedural control needs its declared
operation and explicit policy evidence. Keep exact source bytes and bindings;
never add unauthenticated images or invent unreadable required semantics.

For `ui_layers_package_v1`, use `layer-intake` first and follow
[the direct layer-package workflow](docs/layer-component.md). Author a complete
v0.2 document and bind every image pointer to an authenticated ZIP layer; account
for every unused layer. Require explicit semantic text, text bounds/font size
and initial states. Game action IDs are wired later using component events; they
are not an input to `layer-build`. Do not derive UI facts from layer IDs or claim
visual acceptance from a successful build. `layer-build` preserves source ZIP and
plan in bundle 0.4; retain this attachment during save/export/reopen. For automatic
drafts, use the local Codex planning DAG after CLI login. It reads source images
and all 16 contracts directly, with no MCP vision stage. It persists portable
decision evidence and requires human visual review. The user-approved automatic
route permits at most three corrections after an initial completed response, in the
same verified Codex session, driven by deterministic contract/render checks.
Native response 1.1 uses reason/missingInputs to distinguish unfinished
construction from required semantic gaps. Construction errors share the same
three-correction budget even when status is Unresolved. Specific semantic gaps
and unclassified legacy Unresolved responses remain terminal.
Preserve every draft and check. Unreadable required text, source mismatch,
incomplete transport, login, timeout and cancellation remain terminal; do not
resubmit them. Stop after three unsuccessful corrections. Never promote visual
approval or weaken a check. CLI `layer-intake`/`layer-build` remain
deterministic and never dispatch a model.

For a single material ZIP, first use `assets-intake` and follow
[single-package intake and planning](docs/assets-intake-v2.md). Review the
authenticated original, mapping and material facts; keep user business text
separate from visible observations. Author a source-bound observation or target
and explicit appearance binding for `assets-plan`; it compiles deterministically
and does not call a model. Report required semantic/state/part inputs separately
from unverified business outcomes. Never read a prior sample's target or binding
as a substitute for a requested isolated cold start. Supplemental packages need
the declared base merge. A material composite is not a runtime default state.

When the user supplies a UI image that is available in the conversation, first
review it conversationally. Record only visible, supported facts and explicit
uncertainties. Do not infer business actions, enabled state, layout, dimensions,
layers, or a clean separable background. A whole-image source and baked text are
valid; unresolved details remain unresolved. For the v0.1 Button shape, read
[the Button-intent prompt](prompts/button-intent.md).

Compile either caller-supplied intent plus policy and image facts, or a complete
v0.2 document. Facts record decoded dimensions only; they are not visual review
or evidence of a provider call. Do not invent missing controls, layout, labels,
or business behavior to make a document compile. The v0.2 node and layout rules
are in [the tree contract](docs/tree-contract.md).

For a static or no-motion request, keep the existing path: `compile`, then
`validate` or `inspect`, and `pack` or `unpack` where a portable bundle is
needed. That path supports the v0.1 Button contract and does not require a
motion style or formal browser run.

When the request includes a motion style or timeline and needs a repeatable
browser-checked delivery, turn the approved inputs into a `run.json` manifest
and use the formal workflow in
[docs/workflow.md](docs/workflow.md). Its `run` command compiles, validates,
loads a matching local loopback workbench, runs the manifest's limited real
browser checks, and publishes a bundle only after every gate passes. It is not
a vision, generative, or subjective visual-approval workflow.

## Motion is a separate formal input

After the component input has been validated, use the bundled
[UI Motion Skill](skills/ui-motion/SKILL.md) when the user explicitly chooses a
motion style or supplies an existing timeline. It does not infer a style from a
static image. For a formal run, retain the chosen `{id, style, targets}` as the
`workflow.motion` request; do not put a compiled `MotionSystemDocument` there.
Retain an authored `MotionDocument` as `workflow.timeline`. The runner compiles
and validates the style system again against the exact v0.2 component.

Keep user-specified required checks. From the authorized intended behavior and
the current validated contract, derive concrete motion, timeline, or pointer
checks where useful; do not invent business outcomes, values, or activations.

The workflow requires a v0.2 component and at least one style request or
timeline attachment. A legacy v0.1 Button needs an explicit v0.2 conversion
through the compiler with the original resources and an explicit layout policy;
never relabel its schema version or rely on implicit conversion.

## Run and retain evidence

Start or reuse a matching local loopback workbench, then invoke:

```sh
ai-ui-component run run.json --preview-url http://127.0.0.1:4173/ --output delivery
```

`delivery` must be a new directory. The runner opens an isolated browser
context and fresh-imports the original candidate for each requested check, so it
does not reuse mutated component state. It writes a redacted `run-report.json`
whenever it created the output directory, retains screenshot/evidence files,
and writes `component.bundle.json` only on PASS.
Local source file paths and the preview URL do not appear in exported reports.
`humanVisualReview` is always `NOT_RUN`: inspect the retained screenshots with
the user when natural animation feel or artwork quality matters.

When run from this source checkout, the workflow loads the `src/` graph; an
installed package without `src/` loads its `lib/` graph. It never combines the
two. The workbench handshake establishes only the workflow protocol revision
and PixiJS engine marker, so build and start the matching local source, or
reuse a matching already-running workbench, before the run rather than treating
it as a content-digest check.

The exact manifest schema, browser adapter handshake, checks, output rules, and
local Playwright setup are in [the workflow reference](docs/workflow.md). The
complete command catalog remains in [docs/automation.md](docs/automation.md).

## Boundaries

- Use only implemented commands: `run`, `validate`, `inspect`, `compile`,
  `assets-intake`, `assets-plan`, `assets-build`, `layer-intake`, `layer-build`,
  `pack`, `unpack`, `component-handoff`, `reference-export`, `reference-accept`,
  `self-test`, and `doctor`. For self-contained v2 reference acceptance, follow
  [docs/reference-consumer-v2.md](docs/reference-consumer-v2.md). Preserve bundle
  0.3's authenticated handoff attachment; never strip it to bypass stale evidence.
- In a `run.json` manifest, both `resources[].file` and `resources[].path` are
  portable, forward-slash relative paths. They cannot be absolute, drive, UNC,
  empty, dot, parent, or trailing-dot/space paths. `file` stays below the
  manifest directory and every component on its path must be a local directory
  or regular file, never a symlink or junction; resource bytes are capped while
  read. These are run-manifest rules, distinct from the existing `pack
  --resource` argument syntax. Bundles never fetch external network resources.
- Do not overwrite a workflow output, bundle output, or extracted resource.
  A failed gate is a failed delivery and must not leave a success bundle behind.
- The optional local Playwright adapter uses a separately installed development
  dependency and a matching loopback workbench that is either already running
  or started separately. The npm package does not contain a hosted or bundled
  workbench distribution. The separate `reference-accept` command includes a
  static acceptance renderer and owns its loopback server/browser teardown. It
  requires local Playwright and an installed browser, never downloads either.
- Do not start provider jobs, make model requests, or present a procedural
  fixture as user artwork or completed visual review.

- `bind-value-text` supports explicit numeric bindings (1.0/1.1) and List selectedId-to-Text mappings (1.1);
  use [the versioned contract](docs/value-text-bindings-v1.md), validate the new single
  package and preserve original reference evidence. It never infers business links.

- For Select popup option icons, use only [the official v1.0 contract](docs/select-option-icons-v1.md). Keep per-option layer bindings distinct from collapsed-field artwork and preserve unknown reference observations.
- For explicit Select selected/hover menu backgrounds, use only [select-menu-highlights-v1.md](docs/select-menu-highlights-v1.md). Preserve legacy behavior when absent; never infer a theme or overwrite original reference observations.

ScrollView optional vertical thumb slicing uses only [the source-pixel contract](docs/scrollbar-thumb-slices-v1.md). Do not infer cuts or replace missing artwork.

For explicit cross-component quantity, pricing and List filtering/sorting, use only [component-linkages-v1.md](docs/component-linkages-v1.md). Keep dataset/configuration separate from linkageState runtime snapshots and original reference observations.

For List parent-background rendering use only [list-background-v1.md](docs/list-background-v1.md); absence never implies parent mode.

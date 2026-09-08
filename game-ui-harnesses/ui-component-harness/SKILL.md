---
name: ui-component-harness
description: Compile explicit UI component intent or documents with local resources, validate interaction motion in a local PixiJS workbench, and export a verified portable bundle.
---

# UI Component Harness

Use this Skill when a user wants a local UI component contract, a resource-backed
PixiJS component preview, or a portable UI bundle. The runtime is local and
provider-neutral: it does not perform vision, call a model, or publish a result.

## Author the input with the user

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
  `pack`, `unpack`, `self-test`, and `doctor`.
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
  workbench distribution.
- Do not start provider jobs, make model requests, or present a procedural
  fixture as user artwork or completed visual review.

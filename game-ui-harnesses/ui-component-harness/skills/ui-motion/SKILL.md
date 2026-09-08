---
name: ui-motion
description: Create validated explicit UI motion-system or timeline documents for existing v0.2 UI Component Harness components and verify them through the formal local browser workflow.
---

# UI Motion

Use this Skill after a UI Component Harness v0.2 component document has passed
component validation and the user has explicitly requested motion. It authors
the separate motion attachment; the containing UI Harness owns compilation,
browser execution, evidence, and bundle publication. Copying this folder alone
does not install a runtime.

## Choose an explicit motion contract

Read the validated UI document, named targets, motion purpose, and the user's
style choice. A legacy v0.1 Button must first be explicitly compiled to a v0.2
Button plus Image document with retained resources and an explicit layout policy.
Never change only `schemaVersion`.

- For consistent interaction feedback, create a `MotionSystemDocument`. The
  user must choose `playful`, `premium`, or `corporate`. The direct `system`
  CLI requires a `targets` array of existing IDs; whole-canvas requests include
  every node, including repeated types. Only `run.json`'s `workflow.motion`
  accepts `targets: "all"`, which the workflow compiler expands. Run `catalog`, then
  `system` and `validate-system` as described in
  [the style system](references/motion-system.md). Each profile maps the
  supported actions for all 16 types; see the
  [coverage matrix](references/component-coverage.md).
- For custom timing, emphasis, or a coordinated sequence with explicit offsets,
  create a `MotionDocument` timeline. Run `capabilities`, `compile` or
  `compose`, `validate`, and selected `sample` times. Read
  [timeline recipes](references/recipes.md). Timelines retain their explicit
  `manual`/`activate`/`change` trigger contract.

Named styles are design choices, not facts inferred from a still image. Three
Button press/release recipes refer to LottieFiles; the other mappings and style
tokens are Harness extensions. Do not claim that all 16-type mappings are
original Lottie recipes.

## Hand the attachment to the workflow

Validate the completed motion document against the exact v0.2 component
document. Retain the `{ id, style, targets }` request in `workflow.motion`;
do not put the compiled `MotionSystemDocument` there. The workflow re-compiles
that request against its own compiled tree. Put an authored `MotionDocument`
in `workflow.timeline` when needed. The workflow requires at least one of them.

Use the main
[UI Component Harness workflow](../../docs/workflow.md) to select the limited
real-browser checks needed for that attachment:

- A motion check names the target and a supported system action.
  `verifyPixels: true` is appropriate when the settled endpoint should differ visibly from its
  initial rendering, such as a press or exit. With `false`, the runner still
  proves that the actual browser scheduler ran, the target or subtree changed
  presentation on native frames, and it settled; use this for an enter or
  transient emphasis that returns to base.
- A timeline check seeks an existing timeline at an explicit time from zero
  through its duration. It verifies the requested seek position and stopped
  state; its `verifyPixels` setting optionally requires a canvas-pixel
  difference from the initial view.
- A click check uses a real pointer on a component and requires at least one
  explicit expected value or activation count. It can be paired with motion
  checks while each check still begins from a fresh import of the original
  candidate.

This verifies specified runtime behavior only. It does not determine whether
motion feels natural; the workflow report records `humanVisualReview: "NOT_RUN"`
and retains screenshots for a user review.

## Runtime and delivery boundaries

The workbench uses real PixiJS rendering and browser scheduling. State remains
authoritative: animation must not encode a purchase, success outcome, enabled
flag, committed value, focus, visibility, or modality. Generated adapter parts
(thumbs, ticks, rows, and tabs) are not standalone contract targets. Baked
artwork cannot be split into invented layers by a motion document.

The `ai-ui-motion` CLI remains offline:

```text
ai-ui-motion catalog
ai-ui-motion system request.json document.json --output system.json
ai-ui-motion validate-system system.json document.json
ai-ui-motion capabilities document.json
ai-ui-motion compile recipe.json document.json --output timeline.json
ai-ui-motion compose composition.json document.json --output canvas-motion.json
ai-ui-motion validate timeline.json document.json
ai-ui-motion sample timeline.json document.json 120
```

Only PixiJS has an implemented rendering and interaction adapter. Follow
[adapter semantics](references/engine-adapters.md) for portability, hit areas,
overlays, clocks, and lifecycle. Engine-neutral JSON and math do not establish
Unity, Cocos, Phaser, DOM, or native support. All authoring and verification are
local: they perform no vision, media generation, provider call, or aesthetic
approval.

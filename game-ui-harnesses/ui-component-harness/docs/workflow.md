# Formal browser workflow

`ai-ui-component run` is the local acceptance path for one explicit v0.2 UI
workflow. It compiles the component and requested motion, verifies portable
resources and a candidate bundle, imports that bundle into a separately started
or already-running matching local PixiJS workbench, runs only declared browser
checks, verifies exact restoration, tears down, and then publishes a bundle. It performs no vision,
provider call, media generation, external network fetch, or subjective
aesthetic review.

## Start a matching local workbench

The npm package supplies the CLI and neutral library only. It does not bundle or
host a web workbench. Start a matching local source workbench, or reuse an
already-running matching loopback workbench. To start one locally, for example:

```sh
npm ci --ignore-scripts
npm run build
npm run preview
```

Then run the CLI against its literal loopback URL:

```sh
ai-ui-component run run.json --preview-url http://127.0.0.1:4173/ --output delivery
```

From a source checkout without a globally installed CLI, run the same command as
`node scripts/cli.mjs run run.json --preview-url http://127.0.0.1:4173/ --output delivery`
from the Harness directory.

The root URL opens the consumer preview studio. The deterministic browser
adapter resolves a root or `index.html` URL to the separate `workbench.html`
page, keeping this command compatible while excluding debug controls from the
consumer UI. You can also supply the workbench URL directly. Source builds
contain both pages.

`--browser` may be `chromium`, `msedge`, or `chrome`; on Windows it defaults to
`msedge`, and elsewhere it defaults to `chromium`. Browser acceptance loads
`@playwright/test` only as an optional local adapter. It must already be
installed with a usable local browser; the command never downloads either.

The workbench must expose `window.uiHarness.workflowAdapter` with
`version: "0.1"`, `engine: "pixi.js"`, and a string `engineVersion`. The
protocol handshake rejects a missing or incompatible revision/engine marker; it
does not compare content digests or detect every stale build with the same
revision. Build and start the matching local source workbench before a run.
When `src/` is present, the runner loads that source graph; it falls back to
`lib/` only in an installed package without `src/`, so it never mixes source and
stale library modules. Browser traffic is limited to the supplied local origin
plus in-memory `data:` and `blob:` resources; external requests are blocked.

## `run.json` manifest

The manifest is strict: unknown fields fail. `runVersion` and
`workflow.workflowVersion` are both `"0.1"`. Both resource `file` and `path`
must be portable forward-slash relative paths: no backslashes, absolute or drive
paths, UNC paths, empty components, dot/parent components, or components ending
in a dot or space. `file` resolves below the manifest directory; every directory
component and the final file are checked with local metadata so symlinks and
junctions fail. The runner reads each regular nonempty file with an enforced
byte cap, and also enforces the total bundle byte cap. Only `path` is retained
in the exported bundle.

```json
{
  "runVersion": "0.1",
  "workflow": {
    "workflowVersion": "0.1",
    "id": "save-control",
    "input": {
      "kind": "document",
      "document": {
        "schemaVersion": "0.2",
        "id": "save-control-document",
        "canvas": { "width": 320, "height": 180 },
        "root": {
          "id": "root",
          "type": "Container",
          "layout": { "x": 0, "y": 0, "width": 320, "height": 180 },
          "props": {
            "style": {
              "backgroundColor": "#FFFFFF",
              "borderColor": "#113355",
              "borderWidth": 1,
              "cornerRadius": 4,
              "textColor": "#001122",
              "fontFamily": "sans-serif",
              "fontSize": 16,
              "fontWeight": "normal",
              "opacity": 1
            }
          },
          "children": [
            {
              "id": "save",
              "type": "Button",
              "layout": { "x": 100, "y": 68, "width": 120, "height": 44 },
              "props": {
                "label": "Save",
                "enabled": true,
                "style": {
                  "backgroundColor": "#FFFFFF",
                  "borderColor": "#113355",
                  "borderWidth": 1,
                  "cornerRadius": 4,
                  "textColor": "#001122",
                  "fontFamily": "sans-serif",
                  "fontSize": 16,
                  "fontWeight": "normal",
                  "opacity": 1
                }
              },
              "children": []
            }
          ]
        }
      }
    },
    "motion": {
      "id": "save-premium-motion",
      "style": "premium",
      "targets": ["save"]
    }
  },
  "resources": [],
  "provenance": {
    "kind": "programmatic-fixture",
    "description": "Local documented workflow example; it uses no provider or user artwork."
  },
  "checks": [
    {
      "kind": "motion",
      "targetId": "save",
      "action": "press",
      "verifyPixels": true
    },
    {
      "kind": "click",
      "targetId": "save",
      "expectActivations": 1
    }
  ]
}
```

The example is self-contained because it contains no Image or explicit font
resource. A real image-backed request declares each resource in the top-level
array, for example:

```json
{
  "path": "assets/confirm.png",
  "file": "art/confirm.png",
  "mime": "image/png"
}
```

The manifest directory is the base for `art/confirm.png`; only
`assets/confirm.png` is retained in the bundle. The `file` reference cannot
escape that directory or traverse a link/junction. `provenance.kind` is one of
`programmatic-fixture`, `user-provided`, or `vision-reviewed`, and its
description is required.

### Component input and motion attachment

`workflow.input` is exactly one of:

```ts
{ kind: 'intent', intent: TreeIntent, policy: TreePolicy, facts: ImageFactsMap }
{ kind: 'document', document: UiDocument }
```

Both forms produce a strict v0.2 UI document. The runner does not convert a
legacy v0.1 Button or a legacy intent. Convert it explicitly through the
component compiler first, retaining its resources and explicit layout policy.

`workflow.motion` is either `null` or the exact style-system request:

```ts
{ id: string, style: 'playful' | 'premium' | 'corporate', targets: 'all' | string[] }
```

`targets: "all"` is a workflow convenience: `run` expands it to every compiled
node ID. The separate `ai-ui-motion system` command and `compileMotionSystem`
library API require an explicit ID array, including repeated component types.

The optional `workflow.timeline` is a complete validated `MotionDocument`.
The workflow needs a non-null style-system request, a timeline, or both. It
never invents a style, target set, timeline, or implicit motion conversion.
For a run, retain the authored style request in `workflow.motion`, rather than
placing a compiled `MotionSystemDocument` in the manifest; the runner compiles
and validates that system against the component. Retain an authored timeline in
`workflow.timeline`. Author these inputs after component validation with the
[UI Motion Skill](../skills/ui-motion/SKILL.md).

### Browser checks

`checks` is a required nonempty list of up to 128 explicit checks. Each check
fresh-imports the original candidate bundle, so one interaction's state cannot
affect another check or the delivered bundle.

| Check | Required fields | Meaning |
| --- | --- | --- |
| `motion` | `kind`, `targetId`, `action`, `verifyPixels` | Runs a style-system action bound to the named target using the real browser scheduler. The target and its descendants must change presentation during native frames and settle. With `verifyPixels: true`, the before and settled screenshots must also differ; use it for a visibly changed settled endpoint such as `press` or `exit`. Use `false` for an enter or transient emphasis that returns to its base pixels. |
| `timeline` | `kind`, `time`, `verifyPixels` | Seeks the existing `MotionDocument` at a finite time from `0` through its declared duration. The runtime must report the requested stopped seek position. `verifyPixels: true` additionally requires a canvas-pixel difference from the initial view. |
| `click` | `kind`, `targetId`, and at least one expectation | Clicks the target with a real pointer. Optional `xRatio` and `yRatio` select a point from `0` through `1`; the defaults are centered. Set `expectValue` and/or nonnegative integer `expectActivations` to require the authoritative outcome. When supplied, `expectActivations` must equal both the global activation delta and the named target's activation delta, preventing overlapping controls from satisfying the check. |

Motion actions must be among the actions actually bound to that target. Timeline
checks require a timeline attachment and cannot seek outside its duration. The
workflow does not treat screenshots or limited checks as a global 16-component
regression, a design review, or approval of natural animation feel.

Preserve any user-specified required checks. An agent may derive further
concrete checks from the authorized behavior and current validated contract, but
must not invent a business outcome, committed value, or activation count.

## Execution and output

`--output` must name a directory that does not already exist. The runner creates
it; if creation succeeds, it always writes `run-report.json`, including on a
failure. It never overwrites an earlier result. Reports redact local paths and
the preview URL. They identify the request by SHA-256, retain check results and
browser evidence, state the limited acceptance scope, and always set
`humanVisualReview` to `NOT_RUN`.

On PASS the output contains:

- `run-report.json`
- `component.bundle.json`
- `initial.png` and `restored.png`
- `check-NNN-before.png` and `check-NNN-after.png` for each declared check

On a failed compile, resource validation, browser check, restoration, or
teardown, `run-report.json` records the failure and there is no successful
`component.bundle.json`. The runner validates the candidate bundle before the
browser starts, imports it in an isolated browser context, decodes resources,
runs the declared checks, confirms exact export/import restoration in a fresh
page, and verifies runtime teardown, including release of the imported-resource
cache, before it writes the final bundle.

Review the retained screenshots with the user when visual quality or animation
feel matters. That review is outside this deterministic workflow and must not
be inferred from a PASS report.

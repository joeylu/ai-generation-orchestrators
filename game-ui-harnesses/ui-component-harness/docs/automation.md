# Offline automation

`ai-ui-component` is a local wrapper around public component, motion, resource,
and browser-acceptance contracts. It has no provider command and does not make
model or vision requests. The formal `run` workflow only connects to the
explicit loopback workbench URL and blocks external browser network traffic.

```text
ai-ui-component run <run.json> --preview-url <loopback-workbench-url> --output <new-directory> [--browser chromium|msedge|chrome]
ai-ui-component validate <document-or-bundle.json>
ai-ui-component inspect <document-or-bundle.json>
ai-ui-component compile <intent.json> <policy.json> (--facts <facts.json> | --asset <file> | --asset <source>=<file>) [--output <document.json>]
ai-ui-component pack <document.json> --resource <portable-path>=<file> [--resource ...] --provenance-kind <kind> --provenance-description <text> [--motion <motion.json>] [--motion-system <system.json>] [--output <bundle.json>]
ai-ui-component unpack <bundle.json> <empty-output-directory>
ai-ui-component self-test
ai-ui-component doctor
```

## `run`

Use `run` for the complete, explicitly declared workflow. Start a matching local
workbench or reuse an already-running matching loopback workbench, then pass its
literal HTTP loopback URL and a new output directory. `@playwright/test` and its browser are optional local development
dependencies; `run` never installs them, starts a workbench, or downloads a
browser. The installed npm package has no hosted or bundled web distribution.
When the source checkout contains `src/`, the runner uses that graph; only an
installed package without `src/` uses `lib/`, so a run never combines source and
stale library modules. The protocol handshake checks the declared workflow
revision and PixiJS engine marker, not a content digest; build and start the
matching local source workbench before running acceptance.

The manifest supplies a v0.2 component source, an explicit motion-system
style request and/or timeline, local resources, provenance, and nonempty browser
checks. The command compiles and validates the components and motion, validates
a candidate bundle, performs isolated real-browser checks with fresh candidate
imports, verifies exact restoration and teardown, then writes a final bundle
only on PASS. It always writes a redacted report if it created the output
directory; no success bundle survives a failure.

Each manifest resource `file` and portable bundle `path` uses a forward-slash
relative path. Resource files stay under the manifest directory; absolute,
drive, UNC, dot/parent, and link/junction paths fail. Bytes are capped while
each regular local file is read and across the candidate bundle.

Read [the formal workflow reference](workflow.md) before authoring a manifest.
It defines the strict manifest schema, loopback adapter handshake, browser
checks, evidence files, report redaction, and the exact runnable example.
For formal runs, retain the chosen `{id, style, targets}` request in
`workflow.motion`; the runner compiles the system. Retain an authored timeline
in `workflow.timeline`.

## Compile and inspect

`compile` accepts either caller-declared `--facts` JSON or dimensions read from
supplied local image bytes. `--facts` is only facts: it is not a visual review,
image-understanding result, or provider-call evidence. A legacy v0.1 Button
accepts one unqualified `--asset file`; every v0.2 Image uses
`--asset source=file`. Supported local dimension formats are PNG, GIF, JPEG,
WebP, and BMP. An unsupported image needs explicit facts.

`validate` validates one document or bundle, and `inspect` reports its public
summary. Both are read-only and never start a provider, browser, or workbench.

## Package and extract

`pack` requires every local source declared by the document as a `--resource`
entry. It rejects network references, unsafe or duplicate paths, MIME errors,
missing resources, noncanonical Base64, and checksum failures. The bundle embeds
source bytes and SHA-256; browser object URLs are never stored.

`pack` accepts optional `--motion <timeline.json>` and
`--motion-system <system.json>` together. Each is validated against the supplied
v0.2 tree. A system produces bundle version 0.2; bundles without one remain
0.1. Import restores both attachments.

`unpack` validates every checksum before writing. It creates only below the new
output directory, refuses existing targets and symlinks, and writes resources,
`ui-document.json`, and any `ui-motion.json` or `ui-motion-system.json`.
Metadata paths are reserved case-insensitively. Nothing is overwritten.

## Motion authoring commands

The separate `ai-ui-motion` executable remains the offline authoring CLI:

```text
ai-ui-motion catalog
ai-ui-motion system <request.json> <document.json> --output <system.json>
ai-ui-motion validate-system <system.json> <document.json>
ai-ui-motion capabilities <document.json>
ai-ui-motion compile <recipe.json> <document.json> --output <timeline.json>
ai-ui-motion compose <composition.json> <document.json> --output <canvas-motion.json>
ai-ui-motion validate <timeline.json> <document.json>
ai-ui-motion sample <timeline.json> <document.json> <time>
```

`catalog` describes all three named styles and the supported component actions.
`system` takes exactly `{id, style, targets}` and resolves actual v0.2 node
types. `capabilities` documents the separate timeline's six transform
properties and triggers. See the [UI Motion Skill](../skills/ui-motion/SKILL.md)
for the design boundary and the workflow reference for browser verification.

`self-test` and `doctor` remain offline. `doctor` exposes only public local
capability: it does not print credentials, query strings, home directories,
model paths, workflow files, or provider state.

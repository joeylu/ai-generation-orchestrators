# SDK candidate 0.2.0-rc.3

Based on `f44a5d8061b5f8d6a33d55a4d37ba17364fe0bee` (candidate rc.2).
This is a new local candidate for consumer adoption, not an assertion of a
published release, a deployed consumer, or human visual acceptance.

Container, Panel and Dialog now accept optional boolean `props.drawBackground`.
Omitted or true retains the existing fallback fill/border. False skips only that
procedural box, so a separate raster Image child can own the surface without
leaking fallback color through transparent corners. Native raster appearance,
titles, children, opacity, layout, input and Dialog behavior remain active.
Strict validation rejects other types. Explicit values require an
`explicit-policy` finding at `/props/drawBackground` in model-proposed layer plans.
The public planning prompt documents the option and evidence requirement.

Node JavaScript, declaration files, browser modules and standalone browser
artifacts are rebuilt together. The background contract is additive; tree and
bundle schema versions remain unchanged. Existing deliveries are not migrated.
See [the full policy](panel-background-v1.md).

Executed local verification on Windows, Node 25.9.0, Edge with software WebGL:

- Full build and typecheck; 664 unit tests passed, zero skips.
- Seven related actual browser tests passed, zero retries/skips. The new
  standalone regression covers all three types, default/true/false fill and
  border, retained native art, transparent Image-child corners, titles, bounds,
  opacity, mouse/keyboard, Dialog backdrop/close and exact export/reopen pixels.
- Packed TGZ extraction without checkout source: Node import without browser
  globals, explicit background policy evidence/compile, installed CLI, self-test,
  doctor, actual Pixi render, standalone input/state/export/reopen and teardown.
- Allowlisted source ZIP checksums and an extracted source build passed using
  the existing locked local toolchain.

The distribution test extracts directly into its isolated installation folder
to avoid a Windows directory-rename refusal. No acceptance gate is removed.
No models, image generation, consumer deployment or original task edits occurred.
Target container validation and consumer adoption are separate steps.
`nativeFullChainPassed=false`; `humanVisualAcceptance=false`.

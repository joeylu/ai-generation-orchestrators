# Three-style interaction system

Each named style is a versioned, explicit set of values. `getMotionStyle()` and
`motionSystemCatalog()` return fresh copies; changing a copy cannot alter future
compilation. `compileMotionSystem()` never changes the supplied UI document.

| Token (milliseconds unless stated) | Playful | Premium | Corporate |
| --- | ---: | ---: | ---: |
| Press scale / duration | 0.95 / 60 | 0.98 / 80 | 0.97 / 60 |
| Release peak scale / duration | 1.05 / 80 | 1 / 150 | 1 / 100 |
| Release settle duration | 120 | 0 | 0 |
| Hover scale / duration | 1.03 / 120 | 1.01 / 180 | 1.01 / 100 |
| Enter / exit duration | 260 / 160 | 280 / 200 | 180 / 140 |
| Enter Y offset (logical pixels) | 16 | 12 | 8 |
| Enter scale | 0.92 | 0.98 | 0.99 |
| Change / focus duration | 180 / 140 | 200 / 140 | 140 / 100 |
| Stagger delay / scroll duration | 55 / 180 | 70 / 220 | 45 / 160 |
| General easing | spring | ease-in-out | ease-out |

Playful Button press and first release segment use ease-out, followed by a
spring settle. Premium/Corporate have no settle segment and no release peak
above 1. Other style tokens are Harness design extensions. A zero settle token
means omit that segment; scheduler steps always have positive duration.

## Offline compilation

From the Harness root (or use installed `ai-ui-motion`):

```sh
node scripts/motion-cli.mjs catalog
node scripts/motion-cli.mjs system examples/motion-system-playful.request.json examples/programmatic-gallery.document.json --output .tmp/playful-system.json
node scripts/motion-cli.mjs validate-system .tmp/playful-system.json examples/programmatic-gallery.document.json
```

Use fresh output paths: commands refuse overwrite and create missing parents.
A request contains exactly `{id, style, targets}`:

```json
{"id":"shop-playful","style":"playful","targets":["confirm"]}
```

The result contains `motionSystemVersion: "0.1"`, `id`, `style`, and `bindings`.
Every binding has `targetId`, the actual `componentType`, and its permitted
`actions`. Validation rejects unknown fields/styles/actions, missing targets,
type mismatches and duplicate targets/actions. A validated hand-authored binding
may select a subset of that type's actions. IDs are bounded portable strings;
there are 1–1000 bindings, never more than the number of actual nodes.

All three complete gallery requests/documents and the catalog are under the
package's `examples/`. Source-checkout users can regenerate them with
`npm run motion:fixtures`. Installed packages consume the included JSON. They are
deterministic programmatic fixtures, not analyzed artwork.

## Host attachment and delivery

The Pixi tree preview exposes `setMotionSystem(document | null)`,
`getMotionSystem()`, `playMotionAction(id, action)`, and `inspectMotionSystem()`.
The workbench exposes the same methods on `window.uiHarness`. Attach a validated
system to the mounted UI; `null` cancels work and restores presentation. Inspect
reports scheduler activity and per-node presentation for automated acceptance.

Use real input or `setValue()` for state changes. A manual `press`, `focus`,
`open` or other preview action does not synthesize a click, focus the editor,
commit a value or open a closed dialog. System removal/disable/destroy must
cancel active presentation before the target is destroyed. Select open/close
preview requires a popup already opened by real interaction; otherwise it fails.
Rapid state changes
retarget from the displayed value instead of restarting from a stale default.
A shared cancelable frame drives concurrent channels.

```sh
node scripts/cli.mjs pack examples/programmatic-gallery.document.json --resource fixtures/plate.svg=public/fixtures/plate.svg --resource fixtures/gem.svg=public/fixtures/gem.svg --provenance-kind programmatic-fixture --provenance-description "Generated gallery" --motion-system .tmp/playful-system.json --output .tmp/playful.bundle.json
```

Use the exact resources declared by the UI document (check `inspect` first).
An optional `--motion <timeline.json>` preserves an independent timeline in the
same bundle. System bundles use bundleVersion 0.2; bundles without a system
remain 0.1. `unpack` restores `ui-motion-system.json` and optional `ui-motion.json`
alongside UI/resources. An older reader must reject 0.2 instead of silently
dropping its interaction system.

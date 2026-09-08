# Explicit timeline recipes and offline commands

For Playful/Premium/Corporate press and state feedback, use the separate
[interaction system](motion-system.md). These five recipes compile custom
six-property timelines; their trigger and easing limits remain unchanged.

Run commands from the containing UI Component Harness directory. Source users
run `npm run build` first; installed packages use their built library and the
`ai-ui-motion` executable. Source invocation is `node scripts/motion-cli.mjs`.
Output defaults to stdout; `--output` requires a new path and refuses overwrite.

## Explicit recipe format

Every recipe requires `presetVersion: "0.1"`, `id`, `targetId`, `trigger`,
`preset`, and `parameters`. No timing, style or trigger defaults are supplied.
The result is a normal MotionDocument consumable by the existing player/bundle.

| Preset | Required parameters | Behavior |
| --- | --- | --- |
| fade-in | duration, fromAlpha, easing | fromAlpha to 1 |
| fade-out | duration, toAlpha, easing | 1 to toAlpha; no automatic hide/disable |
| slide-in | duration, fromX, fromY, fromAlpha, easing | Explicit offsets/alpha to base position and alpha factor 1 |
| pulse | attackMs, releaseMs, scale, easing | Unit scale to scale and back; compensates x/y about layout center |
| shake | stepMs, distance, cycles, easing | Alternating diminishing local x displacement, ending at 0 |

All durations are milliseconds and at least 1. Total duration is at most 120000.
Alpha is in [0,1], scale in [0.001,100], shake cycles an integer in [1,8], distance
in [0,1000000], and slide offsets in [-1000000,1000000]. The resulting tracks
also pass core numeric, timeline and overlap limits. Bounds are validation
limits, not recommended visual amplitudes. Easing is `linear`, `ease-out`, or
`ease-in-out` with the exact formulas in the adapter reference. No physical
spring solver, repeat loop, shader, color or internal-value track is present.

The [activation pulse example](../assets/confirm-pulse.recipe.json) targets
`confirm` in the packaged programmatic gallery. It is an authored fixture, not
the user's reviewed purchase image and not a held-press implementation.

```sh
node scripts/motion-cli.mjs capabilities examples/programmatic-gallery.document.json
node scripts/motion-cli.mjs compile skills/ui-motion/assets/confirm-pulse.recipe.json examples/programmatic-gallery.document.json --output .tmp/confirm-pulse.motion.json
node scripts/motion-cli.mjs validate .tmp/confirm-pulse.motion.json examples/programmatic-gallery.document.json
node scripts/motion-cli.mjs sample .tmp/confirm-pulse.motion.json examples/programmatic-gallery.document.json 60
```

Paste the generated JSON into the workbench motion editor and apply it. Use
manual play/seek/stop and real control input as appropriate. A second command
using the same output path fails intentionally; choose a fresh revision path.

## Composition and delivery

For `compose <composition.json> <document.json>`, supply
`{motionVersion:"0.1", id, duration, trigger, clips:[{motion, at}]}`. Each `motion`
is the full compiled local timeline, not a filename or recipe. Offsets and
canvas duration are explicit; clip triggers are validated but not inherited.
The result addresses multiple node IDs with canvas scope. No target/property
intervals may overlap. Parent/child transforms can still multiply visually, so
review them together even if their node IDs differ.

The component CLI packages the result with the original UI and explicit local
resources using `pack ... --motion <motion.json>`; syntax and provenance are in
[the component CLI guide](../../../docs/automation.md). A bundle holds one
timeline plus an optional motion system. Retain the recipe for re-authoring. Offline commands do
not execute model calls, play animations or constitute visual acceptance.

## Optional starting choices

For a restrained activation pulse, a scale around 0.97-0.98 with a short attack
and slightly longer return is a useful preview candidate. A playful confirmation
can expand slightly above 1. Select based on the user's game style and frequency
of use, then record every chosen value explicitly. A submitted action's success
or error feedback requires an explicit host outcome, not inference from a click.

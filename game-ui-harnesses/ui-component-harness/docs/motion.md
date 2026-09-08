# Motion systems and timelines

The [UI Motion Skill](../skills/ui-motion/SKILL.md) is the authoring entry.
Two separately validated documents can be attached to the same UI v0.2 tree:

- `MotionSystemDocument` 0.1 selects Playful, Premium or Corporate and binds
  component-specific actions across all 16 types. It drives real interaction
  feedback through the Pixi adapter. Read the
  [profiles, schema and commands](../skills/ui-motion/references/motion-system.md)
  and [coverage matrix](../skills/ui-motion/references/component-coverage.md).
- `MotionDocument` 0.1 is the explicit, six-property timeline described below.
  It supports custom recipes and coordinated canvas sequences.

The public `motion-system.ts` compiler, validator, catalog and `MotionAnimator`
are engine-neutral. Pixi owns input routing, generated parts and rendering.
State commits immediately; animation follows it through a separate presentation
layer. Rapid events retarget only their channel. Clearing, hiding, disabling and
destroying must cancel affected work before presentation targets are removed.

Workbench style controls apply a system to all current nodes, preview entrance
and exit, expose validated JSON, and clear it. Attaching does not automatically
play an entrance. `window.uiHarness` exposes `setMotionSystem`, `getMotionSystem`,
`playMotionAction` and `inspectMotionSystem`. Manual actions change presentation
only; use real input or component setters for focus, selection, open and value
state. Presentation exit alone does not disable input or release modality.

`pack --motion-system` creates bundleVersion 0.2 and can coexist with `--motion`.
Import restores both. Without a system, bundleVersion remains 0.1; legacy Button
behavior stays unchanged. Only PixiJS is implemented; portable contracts are not
evidence that other engines work.

## Explicit timeline contract v0.1

The bundled [UI Motion Skill](../skills/ui-motion/SKILL.md) adds capability
discovery and five explicit recipe compilers without changing this timeline
schema. `motionCapabilities()` reports all 16 type definitions plus actual node
targets; `compileMotionPreset()` expands a recipe into the tracks below. Read
the Skill's coverage and engine references before claiming specialized control
feedback or another engine adapter.

`src/motion.ts` defines a separate, engine-neutral timeline for a validated
v0.2 UI document. It does not add fields to nodes, alter layout policy, or
change the document returned by `getDocument()`. The timeline only addresses
existing node IDs and produces temporary transform values for the runtime.

```ts
import { MotionPlayer, composeMotions, sampleMotion, validateMotion } from './src/motion.ts';

const motion = validateMotion({
  motionVersion: '0.1',
  id: 'confirm-enter',
  scope: 'component',
  duration: 300,
  trigger: { type: 'manual' },
  tracks: [
    { targetId: 'confirm', property: 'x', start: 0, duration: 300,
      from: -18, to: 0, easing: 'ease-out' },
    { targetId: 'confirm', property: 'alpha', start: 0, duration: 300,
      from: 0.2, to: 1, easing: 'linear' },
  ],
}, document);
```

All times are explicit milliseconds. `duration` is from 1 through 120,000;
each track has a non-negative `start`, a positive `duration`, and must end no
later than the timeline duration. Numeric values must be finite. `alpha` is
from 0 through 1, and `scaleX`/`scaleY` are positive (up to 100). The accepted
properties are `x`, `y`, `alpha`, `scaleX`, `scaleY`, and `rotation`; easing is
`linear`, `ease-out`, or `ease-in-out`.

A target/property pair may have sequential tracks, but their half-open
intervals must not overlap. Adjacent intervals are legal. Before the first
track begins, its `from` value is sampled; between sequential tracks, the
previous track's completed value is retained. This lets a later entrance track
declare its initial visual state without a hidden default.

`scope: 'component'` permits tracks for exactly one target. Use
`scope: 'canvas'` for a coordinated multi-node animation. Every target must be
an ID in the supplied v0.2 document. `trigger` is either `{type:'manual'}` or
`{type:'event', targetId, event}`. Event metadata is checked against actual
control capability: `activate` is supported by `Button`, while `change` is
supported by `Switch`, `CheckBox`, `RadioGroup`, `Slider`, `Input`, `Select`,
`List`, and `Tabs`.

The contract records event intent; it does not subscribe to browser events.
The workbench or another caller must subscribe to the tree runtime and call
`player.play()` when the declared event arrives. This keeps the motion document
portable and avoids storing runtime listeners in a bundle.

## Explicit canvas composition

`composeMotions()` (also exported as `compileCanvasMotion()`) reuses validated
local timelines in one canvas-scoped motion. Every clip has an explicit `at`
offset; the composed document also supplies its own `id`, `duration`, and
`trigger`. It never sequence clips automatically or inherit their triggers.

```ts
const canvasMotion = composeMotions({
  motionVersion: '0.1', id: 'screen-intro', duration: 700,
  trigger: { type: 'manual' },
  clips: [
    { motion: titleEnter, at: 0 },
    { motion: confirmEnter, at: 240 },
  ],
}, document);
```

Each local `MotionDocument` is validated against the supplied UI document
before it is flattened. The local trigger remains validated metadata but is not
used by the composed timeline; only the explicit canvas trigger is retained.
The clip must finish within the explicit canvas duration. Flattened tracks are
then validated as one `scope:'canvas'` document, so invalid targets, invalid
property values, time overflow, and same-target/property overlap all fail. The
input clips and UI document are cloned and never mutated.

## Sampling and preview semantics

`sampleMotion(motion, time)` is pure. It returns one entry per affected node:

```ts
[{ id: 'confirm', values: { x: -9, alpha: 0.6 } }]
```

The current tree preview consumes these through
`applyMotion(id, values)`. In that adapter, `x` and `y` are transient pixel
offsets added to the node's contract layout; they are not absolute coordinates.
`alpha` multiplies the existing style/enabled alpha, `scaleX` and `scaleY` are
temporary scale factors, and `rotation` is passed to the preview's
radians-based rotation. `resetMotion()` restores layout position, base alpha,
unit scale, and zero rotation. Other engine adapters must document an
equivalent mapping before claiming compatibility.

## Playback

`MotionPlayer` receives a validated motion input, a `UiDocument`, a target with
`applyMotion`/`resetMotion`, and an injected clock:

```ts
const player = new MotionPlayer(motion, document, preview, clock,
  (time, running) => updateTimeline(time, running),
  error => reportMotionFailure(error),
);
player.play();
player.seek(150); // stops playback, samples exactly 150ms
player.stop();    // time 0 and reset temporary transforms
player.replay();  // seek(0), then play
player.destroy(); // cancel frame and reset; later operations fail
```

The injected `MotionClock` makes the player deterministic under test and lets
each host choose its scheduling mechanism. `play()` advances from the current
position, or restarts at zero after reaching the end. Playback failures cancel
the pending frame, reset temporary transforms, and call `onError`. A
synchronous `seek()` failure also resets transforms before it is rethrown to
the caller. `destroy()` is idempotent and does not mutate the UI document.

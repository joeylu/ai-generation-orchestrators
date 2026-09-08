# Component motion coverage

Motion System 0.1 covers every row for each named style: Playful, Premium and
Corporate (48 style/type pairs). Run `catalog` for strict profiles/actions;
`system` binds them to actual UI v0.2 node IDs. All types support explicit
`enter` and `exit` presentation.

| Component | Additional system actions | Pixi presentation and state feedback |
| --- | --- | --- |
| Image | emphasis | Whole-image entrance, exit and emphasis; baked art stays intact |
| Text | emphasis | Whole-text entrance, exit and emphasis; no glyph/typewriter animation |
| Container | stagger | Coordinated explicit child entrances |
| Button | emphasis, press, hover | Held press, release peak/settle, cancel and hover; stable logical hit rectangle |
| Switch | change, hover | Thumb/track transition to committed checked state |
| CheckBox | change, hover | Tick alpha/scale transition to committed checked state |
| RadioGroup | change, hover | Option marker transitions to committed selection |
| Input | focus | Focus ring follows real focus/blur; text editing stays authoritative |
| Select | open, close, change, hover | Popup entrance/exit and selected-option feedback |
| ProgressBar | progress | Fill smoothly follows the immediately committed value |
| Slider | progress, hover | Programmatic fill/thumb transition; live dragging follows the pointer and cancel restores state |
| ScrollView | scroll | Content presentation follows committed scroll coordinates |
| List | change, stagger | Selected-row feedback and generated/explicit row entrance |
| Panel | stagger | Coordinated explicit child entrances |
| Dialog | open, close | Panel transition with a stable full-canvas modal blocker during closure |
| Tabs | change | Header indicator and active-content transition |

The system addresses a component ID; generated rows, options, ticks and tab
headers are adapter-owned presentation. Their item IDs are not new nodes.
Initial attachment does not play `enter`. Explicit preview actions animate
presentation only; they do not commit values, open a dialog, focus an input or
run a business callback. Real events and runtime setters drive state feedback.

## Coexisting timeline contract

MotionDocument 0.1 still accepts whole-node `x`, `y`, `alpha`, `scaleX`, `scaleY`
and `rotation` tracks on every type, with a manual trigger. Its event triggers
remain Button `activate`, and `change` on Switch, CheckBox, RadioGroup, Input,
Select, Slider, List and Tabs. `capabilities` reports this timeline contract,
not the system registry. It does not gain internal-part tracks or held-press
triggers merely because the system supports them.

Both attachments can coexist: the timeline owns the logical view transform,
while the system owns a separate presentation layer. Multiple legacy timeline
players on the same preview still conflict because each resets that target.
Use one composed timeline plus one system per preview.

## Boundaries

- Transparent presentation does not change visibility, input or modality.
  The component state machine controls those transitions.
- Ancestor transforms compose. Inspecting a bounding rectangle alone is not
  proof of rotated interaction correctness; verify actual gestures.
- Removing nodes prunes system bindings and cancels their scheduled work.
  A custom timeline referencing removed nodes must be detached/revalidated.
- The implementation and automated acceptance use PixiJS. Physical touch/pen,
  native IME panels, user aesthetic approval and other engines are separate
  evidence. Read the executed report in the package's task ledger.

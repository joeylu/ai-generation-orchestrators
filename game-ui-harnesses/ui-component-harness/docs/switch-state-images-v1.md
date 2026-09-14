# Switch state images v1 — consumer contract

The consumer supports `stateImages.version: "1.0"` as a versioned extension of appearance binding 0.2 and runtime UI tree 0.2. Outer handoff v1/v2 and bundle versions are unchanged. Older consumers reject the extension: never strip it for compatibility.

In `bindings[].states.switch`, add:

```json
{
  "stateImages": {
    "version": "1.0",
    "off": { "trackLayerId": "switch-track-off", "thumbLayerId": "switch-thumb-off" },
    "on": { "trackLayerId": "switch-track-on", "thumbLayerId": "switch-thumb-on" }
  }
}
```

Keep existing `parts` track/thumb and `thumbPositions`. Base parts establish dimensions, not a fallback for incomplete stateImages. All four explicit layer references must exist in the authenticated decomposition archive. Each state track/thumb must match its base part dimensions. Alternate templates use shared sourceCanvas and thumbPositions, not their scene placement. Explicit reuse across states is permitted; colors are never inferred.

The compiler emits `props.appearance.stateImages` with the same version/off/on structure, replacing trackLayerId/thumbLayerId with portable trackImage/thumbImage resource paths. Both states are validated and loaded before preview, included in resource completeness checks, and preserved by save/reopen/full v2 ZIP export. Invalid or missing state images fail without procedural fallback. Textures follow the semantic checked value, just like ON/OFF labels; existing thumb motion interpolation remains unchanged.

Legacy packages without stateImages retain one track/thumb pair. Compatibility does not establish distinct state artwork. Acceptance must verify values, events, labels, positions and both state textures after actual input.

## Producer integration pending

This task implements the consumer and its authenticated binding validator. The decomposition producer must support this exact extension in its schema/validator, stateful renderer and exporter before claiming support. No producer code or Battle HUD package was modified. The existing HUD will retain its original colors until an authored replacement package supplies the missing states.

## Evidence

Local procedural fixture and actual PixiJS captures: `work/ui-component-harness/switch-state-images-20260912-r001/`. This is regression artwork, not Battle HUD. `human_visual_acceptance` remains false.

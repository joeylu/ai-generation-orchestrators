# Reference-defined natural terrain cover

The explicit `naturalSurfaceProfile: "reference-defined-cover-v1"` selects a new
natural perimeter source contract. The accepted reference, checked native
material and single-role brief determine the surface cover and exposed body.
The natural family itself does not imply leaves, soil, turf, moss or roots.
Snow, sand, leaf cover and bare rock remain content decisions rather than
hard-coded scene templates.

## Selection and identity

Use the option together with all three existing declarations:

```js
{
  coverageProfile: "full-perimeter-v1",
  nativeSizeProfile: "bounded-native-4m-v1",
  renderEnvelopeProfile: "visible-alpha8-outward16-native-rgba-v1",
  naturalSurfaceProfile: "reference-defined-cover-v1"
}
```

The option is for the natural family. Combining it with `surfaceFamily:
"engineered-city"`, an unknown profile or missing required perimeter/native
declarations fails. SDK `previewTerrainEdgeSources` and
`freezeTerrainEdgeSources` accept the same option; CLI `preview`/`freeze` consume
that typed options JSON. Requests still bind the complete accepted reference
and current checked original material, in that order.

The new plan/request v37 and policy/batch/technical-QA v7 have distinct
identities. Absence of this option preserves v29/v33/v35 natural requests and
their policy, batch and QA bytes. City v30/v34/v36 remain unchanged. Historical
plans are not rewritten or silently upgraded; new requests require fresh
digest-bound single-use confirmation.

## Responsibilities

The seven native roles remain left/right exposed walls, left/right upper outer
corners, a horizontal underside and left/right lower outer corners. An upper
corner connects the requested surface cover to its matching front body. A
vertical edge carries its own exposed body and only explicitly requested
attachments. A lower edge is drawn in its actual lower orientation and does
not acquire an upside-down copy of the top cover.

This is a prompt and source-planning contract. It does not automatically detect
snow, certify semantic purity, guarantee a model result or supply new rendering
geometry. Keep actual source review independent. Source dimensions, original
RGBA, transparent gutters, total pixel/byte budgets and at-most-once execution
retain the native-size contract.

## Reception and assembly

Technical reception, durable replay and delivery consume the new contract
without transferring human art acceptance. Source-to-world scale, repeat
windows, opaque collars and all connection coordinates still require explicit
measurement from each new source family. The existing v2 lower endpoint rule
may be selected only after its upstream native collar checks pass.

The horizontal upper surface is still a measured opaque material band; this
contract adds no independent transparent horizontal snow-cap role. A reference
that requires unsupported free-hanging snow geometry must expose that capability
gap rather than borrow rotated artwork or alter its Alpha.

Offline synthetic regressions exercise multiple natural cover descriptions,
role orientation, rejected option combinations, single-use execution/replay and
delivery, plus unchanged legacy identities. Actual artwork and Studio behavior
for a new theme remain separate evidence.

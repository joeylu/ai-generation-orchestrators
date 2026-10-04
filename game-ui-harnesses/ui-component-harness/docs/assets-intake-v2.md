# Single-package material intake and Agent planning

Implemented locally and offline. The only material format authority is the
producer's [assets-package-v2 contract](../../ui-decomposition-harness/docs/assets-package-v2.md)
and [schema](../../ui-decomposition-harness/references/assets-package-v2.schema.json).
This consumer does not define a competing material schema.

`importDecompositionZip` explicitly dispatches archives containing `manifest.json`
to v2. Unsupported kinds/versions fail; they never fall back to legacy. Archives
without a manifest retain the strict legacy inventory and validation. V2 validates
every declared byte count/digest, image format/dimensions, original mapping, exact
layer coverage, unknown fields, relations and lineage. It decodes layer PNG alpha
to verify `visibleBounds`. Original image bytes and metadata are retained; no
recognition, hidden-detail recovery or image-quality judgement is implied.

Only the fixed contract members are permitted, including the optional existing
QA document. Declaring an arbitrary extra file does not authorize it. Limits remain
256 MiB per archive/uncompressed total, 256 layers, 262 members, 2 MiB JSON,
32 Mi cumulative layer pixels and 16 Mi canvas pixels. Portable imports use
ZIP_STORED and support the producer's local ZIP64 size headers.

```sh
ai-ui-component assets-intake assets.zip --output intake.json
ai-ui-component assets-plan assets.zip --input reviewed-plan.json --output plan.json
ai-ui-component assets-build assets.zip target.ui-bundle.json appearance-binding.json --output built.ui-bundle.json
```

`assets-intake` needs only the ZIP. Its report contains source identities, complete
manifest facts and original bytes in base64, plus separate material, semantic,
binding, business and reference-acceptance statuses. A `complete` package describes
the delivered materials, not complete business or state coverage. A supplemental
package can be inspected, but appearance binding/build requires the producer's
deterministic merge with its exact declared base. Unknown baked content/source
regions remain unknown. Empty state or missing-part observations do not prove
that all required states or parts exist.

`assets-plan` is the deterministic compilation boundary for Agent decisions.
It does not perform the Agent's visual review or call a model. Its consumer-only
input is:

```json
{
  "kind": "ui-assets-planning-input",
  "schemaVersion": "1.0",
  "archiveSha256": "<exact imported ZIP SHA-256>",
  "requirements": "<explicit user business request; separate from image facts>",
  "basis": "agent-reviewed",
  "openQuestions": []
}
```

The Agent may add either `observation` (the existing source-bound semantic v0.2
observation) or `target` (an explicit v0.2 UiBundle), and an explicit `binding`
(existing appearance-binding 0.2). Unknown fields and simultaneous observation
plus target are rejected. Tests must use `basis: "programmatic-fixture"`.

For an observation, the program reuses `compileSemanticObservation` with the
published neutral procedural preview policy, authenticated original dimensions,
bytes and digest. It returns a validated draft target and document digest when
possible. Observation coordinates remain original raw-image coordinates; they
are not silently transformed or equated to scene coordinates. The Agent must
author the binding's explicit registration/geometry. The neutral preview is not
artwork reconstruction. In particular, unknown Tabs content mappings remain
unresolved rather than receiving invented hidden pages.

The Agent reviews original artwork, objective layer facts and mapping, records
supported visible text/state, asks only for necessary business decisions, and
authors the semantic target and binding. The program reports semantic missing
fields, unresolved business questions, absent binding, supplemental-base needs,
and build validation errors. A `needs_input` report is a diagnostic artifact,
not a failed generation or a successful runtime package. A `build_ready` report
contains the validated compiled bundle; business acceptance remains `not_run`.
Declared missing parts remain visible observations and are not indiscriminately
promoted to generation failures.

The existing three-input `assets-build` CLI remains compatible. For v2 it stores
the exact source ZIP, semantic target and binding through the existing component
handoff/bundle 0.3 attachment. Saving and `reference-export` preserve original
members while runtime 1.1 records permitted state changes. The runtime delivery
container is distinct from the input assets ZIP: the latter has no nested ZIP.
Changing structure or resources without replanning still fails stale-evidence
validation. Studio uses the same compiler and preservation path for v2 bindings.

Studio's material import identifies v2 and its scope. It is not automatic business
construction; users still provide a semantic target and binding. The static
material composite can show multiple mutually exclusive skins and must not be
called the runtime default. `reference-state` and `acceptance-scope` are separate
formal inputs: having an original image alone leaves reference acceptance
`blocked / MISSING_REFERENCE_EVIDENCE`. Material review never establishes whole
UI or user visual acceptance.

Offline fixture tests establish deterministic import/compile/persistence and
actual browser input behavior. They do not establish real model recognition or
an unseen application's business semantics.

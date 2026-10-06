# Explicit prototype instances (preview)

New `ai_ui_layers.host_delivery` jobs may supply `materialReuse` in their host
config. This path binds an immutable `ui_material_reuse_v1` document. The default
continues to generate every material. This feature does not detect identical
artwork automatically or make old jobs reusable.

The document has exactly `kind`, `referenceSha256`, `sourcePlanSha256`, and
`groups`. Each group has `prototypeMaterialId`, `instanceMaterialIds` (excluding
the prototype), and nonempty `evidence`. Hashes bind original PNG and complete
source-plan bytes. Unknown/duplicate IDs, chains, cycles and background reuse
are rejected. Initially only foreground cards/badges with one whole object,
`bboxNorm: null`, preserve adaptation and matching text permissions are supported.

Structural checks do not establish visual identity or state. Independent
planning review receives every original material, the declaration and a source
comparison attachment. Required `reuseAudit` must confirm each complete group
with visual evidence; missing/false confirmation stops the job. Similar size
alone is insufficient. Distinct states, controls or attached artwork need distinct
prototypes. Approved minor appearance variation is judged under the new policy.

The compiler retains all assets, nodes, placements and reference crops. Only the
generation set is filtered before existing four-member context grouping.
Snapshots bind `materialReusePolicy: identity-byte-copy-v1`, full contract SHA
and `generatedMaterialCount`; `materialCount` retains the complete delivery count.
Preflight rebuilds groups and requires expanded instances to cover every material
exactly once. Partial image selections and variants are unsupported here.

After genuine raw responses and ordinary singleton/sheet technical gates, the
program copies prototype bytes into a separate PNG per instance. Pixels and
continuous alpha are unchanged. Copies create no generation receipt or call.
Local records bind raw/receipt, verified cell, prototype, contract, scoped mapping
and instance SHA. The scoped mapping covers only groups in that review; the full
contract has a separate SHA.

Every instance enters its source generation request's independent material
review. Deterministic attachments compare each instance with its own original
crop and ownership. Ownership observations cover every instance; approval is
never copied from its prototype. Any instance issue blocks extraction. Changed
bytes or evidence fail verification. Every foreground instance still receives
its own separately authorized body observation and target coordinates.

Uniform registration, complete support, original viewport, alpha validation and
packaging remain required. The portable proof includes prototype ID, artifact
fingerprints, source cell and derivation; local job/submission IDs and paths stay
outside the package. Historical jobs and failed gates are unchanged.

This preview has fixture coverage only. It does not establish real generation
fidelity, visual approval of a reuse group or completed sample delivery.

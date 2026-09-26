# Explicitly accepted material variants

`python -m ai_ui_layers.accepted_materials --selection SELECTION.json --output
NEW_DIRECTORY --viewer BUILT_VIEWER --acceptance USER_DECISION` is an optional,
offline packaging entry point for a user-accepted composite assembled from
received variants. It does not submit models or media, relax quality gates,
change the original DAG, or rewrite a failed model review as a pass.

The selection (`ui_accepted_material_selection_v1`) identifies the reference
and accepted preview by path/hash, `expectedMaterialIds`, text/background
policies, known visual differences, optional path/hash evidence, and ordered
layers. Each layer supplies its snapshot path/digest, preview directory/report
hash, material ID, received job/request/source-material IDs and explicit
adaptation policy (`preserve`, `simple-strip`, or `horizontal-frame-slice`).
These are inputs, not a hand-authored delivery manifest. Source paths and
private lineage stay outside the portable ZIP.

For each layer the program verifies its frozen snapshot, generated request,
submission/receipt relationship, raw SHA-256, reference identity and preview
geometry. It replays native-alpha sheet preparation and cell extraction when
needed, the explicitly selected adaptation, then the existing material
processor. The replayed source and final PNG must exactly match the reviewed
bytes. Existing material gates remain mandatory. Both the explicit complete
layer set and every pixel of the accepted composite are checked: identical
pixels alone would not detect omission of an occluded layer.

The existing writer produces `ui-layers.zip`, including independent PNGs,
composition, preview, reference, manifest, review and local Pixi viewer. The
composition remains `ui_layer_composition_v1`. `acceptance.json` outside the
ZIP records the user's stated decision, source hashes, original receipt
digests, replay measurements and resulting archive hash. Historical review
findings remain evidence; they are not retroactively erased. This route is an
explicit adoption, not proof that the original automatic DAG passed.

Public `review.json` and package validation retain their existing conservative
`review-required`/`humanVisualAcceptance=false` semantics; the local explicit
acceptance record is distinct. Known accepted differences are visible in the
review notes. CLI actions and status names of existing DAGs are unchanged.
Docker/Web final-package consumers need no migration. A host that chooses to
expose the optional adoption operation must collect and bind its selection and
user decision; this change implements no host, service or deployment.

# Explicit simple-strip adaptation

User-approved simple strips such as plain scrollbar thumbs or progress fills may
be resized non-uniformly to a declared target size. This exception is opt-in,
not inferred from an ID, aspect ratio or visual kind. It does not apply to icons,
portraits, decorative rails, illustrated cards or ornate panels; eligible wide
frames use the separate `horizontal-frame-slice` policy after M2 review. Do not use it
to hide wrong ownership, duplicated ornaments, missing artwork or clipped input.

Run the deterministic module `ai_ui_layers.adapt_strip` with `--source`, its
verified `--source-sha256`, target `--width` and `--height`, `--policy simple-strip`
and a new `--output` directory. Target dimensions must come from the reviewed
plan or explicit user requirement. This command makes no model/media request.

The command retains raw bytes, clears only alpha 0/1 noise in a separate copy,
crops the remaining support, resamples with premultiplied-alpha Lanczos, and adds
two transparent pixels around the resized artwork. Original alpha above the
cleanup floor is preserved until resampling. It records source/output hashes,
source box, target artwork dimensions, padding, and independent X/Y scales.
An existing output is never overwritten. A source hash mismatch stops processing.

The result is `adapted_pending_visual_review`, never proof that generation
matched the requested ratio. Review roundness, edge thickness and texture after
adaptation; short rounded ends may become elliptical under non-uniform scaling.
If unacceptable, do not automatically regenerate or substitute procedural art.

The delivery DAG reads optional material `adaptationPolicy` from the reviewed,
frozen visual plan. Missing or `preserve` leaves existing behavior unchanged.
`simple-strip` requires a single decoration, no preserved lettering, foreground
role and target aspect at least 4; M2 additionally checks that artwork is plain
and that the user permitted this policy. Names alone never enable adaptation.
After raw receipt verification (and normal sheet extraction/review if grouped),
the raw_complete stage writes adaptation evidence and uses the derived PNG for
registration. Its checkpoint binds every derived file; raw receipts stay intact.
Clipped source contours stop before padding or resampling. Sheet visual gates
remain unchanged: a failed sheet review is not bypassed by adaptation.

New M1 transports explicitly emit the field; old stored v5 plans may omit it.
Shared-schema consumers must update their validator to accept the optional field
before consuming new plans. CLI, DAG node names and ui_layer_composition_v1 are
unchanged. Docker/Web require no composition migration; hosts adopting the new
planning field must update schema/runtime together and surface adaptation evidence.
Existing frozen runs remain immutable and cannot resume with a changed runtime.
No Docker/Web implementation or new release tag is included.

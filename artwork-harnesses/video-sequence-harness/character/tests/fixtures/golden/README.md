# Character video-sequence golden fixtures

`timeline-atlas-cases.json` locks the regression where a 21-frame natural loop
must not be expanded to 32 or 64 frames merely to fill an atlas. It also records
the required transparent unused-cell counts.

These fixtures are deterministic public reconstructions, not private production
media or alpha ground truth.

- `matte-cases.json` covers global chroma holes and dynamic per-frame keying.
- `input-delivery-cases.json` covers ordinary reference input and safe fitting.
- `moving-hole-cases.json` covers video transparency and deterministic reruns.
- `sequence-matte-cases.json` covers observed multi-key residue and detached-noise regressions.
- `subject-fit-cases.json` covers shared sequence envelopes and clipping guards.

The matching tests use generated images, test doubles, and synthetic decoded
frames. They never contact ComfyUI, submit a provider request, use GPU, or call a
private service.

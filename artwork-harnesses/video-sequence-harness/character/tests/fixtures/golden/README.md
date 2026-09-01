# Character video-sequence golden fixtures

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

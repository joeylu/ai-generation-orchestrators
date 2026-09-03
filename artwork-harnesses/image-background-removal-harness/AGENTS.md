# Image background removal contract
- Accept opaque images and meaningful existing transparency. Missing model setup
  is not bad source quality and never means users must supply a transparent PNG.
- Opaque-image foreground extraction is supplied only by the explicit fal.ai BiRefNet V2
  adapter. It requires a digest-bound, single-use confirmation and is never
  invoked by `doctor`, `plan`, validation, or tests.
- Never write credentials, upload/output URLs, request IDs, or provider-private
  state into portable plans, reports, examples, logs, fixtures, or releases.
- Preserve continuous alpha and zero RGB wherever alpha is zero.
- Do not erase all white pixels, use filename/subject special cases, or replace
  global evidence with an edge-connected-only background rule.
- `correct` is an optional bounded repair. Apply only the exact digest-approved
  preview and never infer user approval.
- Preserve original input bytes and publish every preparation to a fresh output
  directory with fingerprints and warnings.

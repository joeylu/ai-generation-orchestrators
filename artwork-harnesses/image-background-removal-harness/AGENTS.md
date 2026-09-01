# Image background removal contract
- Accept opaque images and meaningful existing transparency. Missing model setup
  is not bad source quality and never means users must supply a transparent PNG.
- CPU segmentation never downloads a model, calls a service, or uses GPU.
- Preserve continuous alpha and zero RGB wherever alpha is zero.
- Do not erase all white pixels, use filename/subject special cases, or replace
  global evidence with an edge-connected-only background rule.
- `correct` is an optional bounded repair. Apply only the exact digest-approved
  preview and never infer user approval.
- Preserve original input bytes and publish every preparation to a fresh output
  directory with fingerprints and warnings.

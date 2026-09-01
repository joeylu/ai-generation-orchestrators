# Repository agent contract

## Product scope

This repository is a catalog of AI Agent-driven game-asset Harnesses organized
under artwork, audio, game-UI, and game-scene categories. A planned Harness is
documentation only and must never be presented as implemented or callable.

The currently implemented public runtime turns character reference images and
motion requirements into transparent 2D character frame animation. The detailed
generation, preparation, media, and retry rules below govern that runtime until
its behavior is migrated into the corresponding nested Harness contracts.

Keep the public core provider-neutral. Provider integrations are optional plugins;
they must not leak host-specific paths, endpoints, workflow files, credentials, or
private operational state into plans, logs, examples, fixtures, or releases.

## Responsibility boundary

The Agent may:

1. understand the user's natural-language character and motion request;
2. produce a structured plan;
3. run read-only preflight checks;
4. request one explicit compute confirmation;
5. invoke the project CLI and explain its result.

Deterministic programs own generation attempts, state transitions, media
processing, validation, manifests, checksums, and packaging. An Agent must not
hand-edit an attempt log or delivery manifest, invent a successful state, or
silently bypass a failed quality gate.

## Compute and retry safety

- `init`, `self-test`, `tools check`, `doctor`, `plan`, `inspect`, and `validate` must not
  generate media or submit a provider job.
- `tools install` may access the public locked download only after explicit user
  setup authorization. It must verify byte count and SHA-256, write only below
  the workspace's ignored `.ai-frame-animation/tools/`, and never change system
  `PATH`.
- A generation attempt requires one fresh, single-use authorization bound to an
  immutable plan digest.
- Once a provider request may have been accepted, never automatically resubmit it.
  An indeterminate generation attempt is terminal and needs a new user decision.
- Deterministic post-processing may be rerun from the same raw-video SHA-256.
- A 16/32/64-frame delivery family must share one raw source, one probe, and one
  decode operation.
- A runtime adapter may provide a canonical `decoded-handoff` document so the
  core can reuse an already verified probe/decode. The Agent must not author or
  repair that document; the deterministic producer owns its fingerprints.

## Media invariants

- User reference artwork need not be transparent. Before new generation, use
  program-owned `prepare` to separate the foreground and fit the canvas; bind
  its original/foreground fingerprints into the plan. Missing segmentation
  setup is not bad source quality. Never erase all white pixels or ask for a
  transparent PNG solely because the source is opaque.
- `prepare` may run explicitly configured local CPU segmentation, but never
  downloads models, calls a service, or uses GPU. Inspect its foreground before
  requesting the one video-generation confirmation; do not silently regenerate
  or invent missing character details.
- `correct` is optional for a specifically identified residual-background patch,
  not an automatic step after `prepare`. Check command availability, use original
  EXIF-oriented cutout coordinates, and show the program's preview and digest.
  Call `correct apply` only after explicit user approval of that exact preview;
  never approve it on the user's behalf or hand-edit masks/reports. Keep the
  original, parent and preview, publish to a fresh directory, and replan from the
  new preparation. This visual-edit approval does not authorize video compute.
  Correction cannot restore omitted hair, clothing or translucent material.
- Transparent PNG frames are authoritative. GIF and spritesheets are derived
  delivery artifacts.
- Global key removal includes enclosed canvas holes. Do not switch to an
  edge-connected-only matte.
- Preserve continuous PNG alpha, remove key spill from soft edges, and set RGB to
  zero wherever alpha is zero.
- A transparent GIF preview maps every non-opaque source pixel to its transparent
  palette index; it is not an alpha-quality source.
- Loop sampling uses a half-open semantic interval and must not duplicate the
  terminal pose. One-shot sampling includes the requested terminal pose.
- Preserve the original rational timeline. Derive delivery FPS from selected
  source timestamps; do not substitute hard-coded provider profiles.
- Matte, spill, timing, or GIF changes require a regression fixture that reproduces
  the corresponding failure.

## Quality policies

`strict` is the default release policy. Every requested variant and required
artifact must pass transparency, timeline, checksum, structure, and package
validation. Opaque output is never a transparent success.

`best_effort` must be explicit. It may omit an optional GIF or an independently
failed variant, but it may not weaken raw-source identity, attempt integrity,
alpha correctness, checksum correctness, or path safety.

## Repository and test boundaries

- Do not add Docker, web, database, WSS, worker claim/lease/heartbeat, supervisor,
  Owner-wake, login authorization, internal beta state, deployment scripts, or
  internal handoff prompts.
- Do not copy a production directory wholesale. Port only allowlisted behavior
  that is covered by public contract and regression tests.
- A decoded handoff is public only when it contains provider-neutral artifact and
  tool evidence. Private attempt, authorization, host, or transport fields are
  forbidden.
- Tests must use fixtures or test doubles. They must not start or connect to
  ComfyUI, submit `/prompt`, consume GPU, generate media, or access private
  services.
- `doctor` output must redact credentials, query strings, user-home paths, model
  paths, and workflow paths.
- Nested `AGENTS.md` files may tighten these rules but may not relax them.
- Production consumers must install an immutable tagged release by digest. Fixes
  land here first; production must not maintain a copied second source tree.

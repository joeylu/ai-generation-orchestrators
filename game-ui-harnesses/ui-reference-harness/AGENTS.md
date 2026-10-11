# UI Reference Harness contract

- This is a local CLI/source preview. Real generation is an optional adapter or
  explicit host exchange; offline tests are not real visual acceptance evidence.
- Import prototypes through the public `ui-panel-harness` validators/compiler.
  Keep producer code read-only; do not copy it or infer a layout from control names.
- Project style is a reviewed immutable revision. A panel intent may emphasize
  existing elements; structural changes go back to the panel producer, global
  style changes create a new style revision.
- Inspect user style images and the exact style draft before recording the user's
  style approval. Human approval of a style or image is separate from compute.
- Style packs are data-only UI contracts. Preserve original pack/base/PNG bytes;
  never execute archives or import character-only generation/re-design rules.
  Rule-only defaults have no art sample. Six-style comparison uses six separate
  projects and one identical prototype, never a mixed-style game project.
- Tests use synthetic fixtures and provider doubles. At runtime, freeze and
  inspect the plan before obtaining the fresh digest-bound
  compute decision. Reserve once before submitting; unknown provider outcome is
  terminal. Never reuse an authorization or replace a rejected raw result.
- Only the deterministic program writes plans, attempts, QA, review records,
  manifests and deliveries. The Agent can supply an intent/rule draft and relay
  the human's exact approval/review decision, not invent one.
- PNG validation is technical QA. Layout, style and exact-copy acceptance are
  separate explicit human decisions bound to the final image digest.
- Preserve original user images, raw generation, frozen snapshots and old styles.
  Post-processing only normalizes PNG encoding, with identical RGBA pixels.
- Freeze `native` or `exact` resolution policy before generation. Native mode keeps
  actual PNG pixels and records a verified logical-to-pixel canvas transform;
  neither the aspect-ratio gate nor this transform proves control placement.
- A verified terminal exact-size rejection may enter a new zero-call native
  reprocess plan after the user chooses that policy. Keep the failed source and
  its exact raw fingerprint; never dispatch a provider for a reprocess plan or
  treat it as human acceptance. Do not reuse indeterminate or invalid sources.
- An accepted anchor is fixed for its style revision and must trace to an accepted
  result of that same style. Whole-project export defaults to every registered
  panel; an explicit subset is allowed and must be disclosed.
- Keep all references, requests, approvals and generated outputs in an ignored
  private workspace such as repository `work/`. Public fixtures are synthetic.
- The user's local-workbench request permits the loopback-only `web/` frontend
  and host adapter described in the root exception. It must call the existing
  core and preserve all compute, retry, human-review and artifact contracts.
  No deployment, authentication, database or private provider config belongs in
  this Harness. Providers own their private operational setup.
- The user-approved local workbench may combine preparation and authorization
  into one explicit Generate/Modify click. The deterministic host must freeze
  current inputs and bind that single-use click to its immutable plan before
  dispatch. This UX exception does not authorize background generation or retry.

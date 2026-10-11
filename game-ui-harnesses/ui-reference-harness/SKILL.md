---
name: ui-reference-harness
description: Generate consistent game UI reference images from ui-panel-harness prototypes using a versioned project style, six built-in UI packs, custom rule packs or a primary PNG, through the local digest-bound CLI.
---

Use the sibling `ui-reference.mjs` CLI; read [README.md](README.md) for command
arguments and [docs/contracts.md](docs/contracts.md) for intake, exchange and QA.
This source preview has no built-in online image provider.

For a project-level reference-only workflow, use the public dag-* commands and
[project DAG contract](docs/project-dag.md). Create/inspect/advance never compute.
Keep the current DAG ID across reload/restart, use stable operation IDs for replay,
and explicitly accept the representative image as anchor before preparing other
panels. Each generation still needs a fresh plan-bound decision. Do not recreate a
DAG or operation to bypass uncertain results or the three-revision session limit.
The existing Studio is the UX reference; deployment belongs in consumer repositories.

Choose the game project first. Import a validated PanelBundle or PanelSpec plus
catalog; inspect the neutral prototype and any supplied original screenshot.
The saved selected tab and scroll origin define the reference view.

For a new style, choose from the six website presets, validate a custom UI JSON
with `pack-check`, or inspect the user's primary PNG reference. Character packs
must be adapted to `schemas/style-pack.schema.json` first; never execute archives
or import character camera, animation, redesign or provider rules into UI tasks. If
useful, draft visual rules matching `schemas/style-rules.schema.json`; reference-only
mode also works without semantic image analysis. Describe the draft and its visual
sources before relaying the user's style decision to `style-activate`.
New packs may be rule-only and have no art sample. Only legacy presets have
deterministic palette guides; those are not generated art samples. Resolve
project rules and primary-image conflicts before activation. The raw pack, base
pack, PNG and final rules are snapshotted; later external edits do not change them.
Use `samples-prepare` for six uniform prototype drafts. Inspect `style-review.md`,
relay actual style decisions, then `samples-plan`; this does not authorize compute
or imply sample acceptance. Do not mix the six comparison styles in one game project.
For an accepted external local default-sample package, inspect
`presets --sample-catalog FILE` and its PNGs. Use
`style-create --preset ID --sample-catalog FILE` to freeze the selected PNG as
primary-style. This is exclusive with pack/reference and does not activate the
style or create an accepted project anchor. Reuse the user's existing decision
when it explicitly covers the same reviewed rules and selected sample.
For multiple panels, freeze the remaining plans after the first representative
panel is accepted and explicitly chosen as the project's anchor, so those plans
include both the fixed project style and the accepted project anchor.
Use `plan-project` to freeze pending panels under one project lock after that
anchor exists. An explicit `--panels` selects a disclosed subset; optional
`--intents` is an array of existing panel-intent objects for selected panels.
Inspect its review file and every frozen request, then verify the set with
`inspect-project-plans --batch ...`. It does not approve or dispatch compute.
The set digest never replaces each plan's digest-bound decision. Do not rerun
planning as an automatic generation retry. A completed project returns
`nothing_to_plan`; use explicit optimize for accepted-image improvements.

Resolve natural-language requests that change layout or project style before
compiling: revise the upstream prototype or create a project style draft. Panel
intent only emphasizes existing controls within the fixed project rules.

Run `plan`, inspect its exact prompt, ordered image roles, logical canvas,
resolution policy and digest. Default `native` preserves model pixels with a
256-pixel minimum short edge, 4096-pixel maximum edge and 1% relative aspect-ratio
error limit; `--resolution exact` requires prototype pixel dimensions. Neither
mode resizes, crops or pads the image. Canvas mapping does not prove control placement.
For a generation plan, obtain one fresh approval for its one image-generation call. Style acceptance
does not authorize this call. Record the decision with `authorize`.

Use either a configured optional `generate --adapter` or `request` followed by
one host image-tool invocation and `receive`. For host exchange, resolve the frozen
relative artifact paths under the project workspace, attach them in exact order,
and forward the frozen prompt unchanged. Reserve before calling the tool. Never
call again for that plan once it is reserved, including after a timeout. Report
an unknown outcome with `stop --outcome indeterminate`.

After the user chooses native resolution, a verified exact-size rejection may be
reused with `reprocess-plan --source-run ... --raw-sha256 ...`, then `reprocess`
bound to its new plan digest. This local plan has `maximumCalls=0`: do not authorize,
request or generate for it. The CLI verifies the failed source chain and unchanged
project context, retains the old failure and copies the identical raw bytes.
Only PNG encoding is normalized; human acceptance remains pending. Do not relabel
the old run, replace its image or reuse indeterminate/invalid sources.

Show `reference.png` together with prototype/style evidence. Ask the human to
decide layout, style and exact-copy acceptance for the reported image digest.
Relay that decision through `review`; never mark human acceptance on their behalf.
The first accepted representative panel may be fixed as the project's anchor
when the human chooses `--anchor true`.

Use `status` to disclose panels requiring the current style. Export all registered
panels by default; name any requested subset. Run `validate` on the resulting
delivery. v2 handoff `canvas` is the actual pixel canvas; `logicalCanvas` and
`coordinateMapping` describe prototype coordinates. Send the accepted PNG to `ui-layer-harness` only when requested.
That consumer applies its own ordinary-text removal policy.

For a rejected result, an explicit `optimize` creates a new plan requiring a new
compute decision. `finish` is only for deterministic processing of the same raw
SHA-256. Do not hand-edit any program-owned record.

For a closed dropdown incorrectly shown as parallel choices, use
`correct-select-plan --source-run ...` (optional `--targets` Select IDs). Inspect
the frozen source PNG, target IDs, selected labels and ordered image roles. The
compiler hides unselected options from visible copy and freezes a single closed
field with a down-chevron. A verified unaccepted image may supply edit context;
it is never promoted to an accepted project anchor. Preserve other appearance,
obtain a fresh digest-bound compute decision, and visually inspect the new result.
No automatic correction chains or pixel-preservation claims are supported.

---
name: skills-2d-frame-animation-video
description: Prepare ordinary character reference artwork and deliver transparent 2D frame animation from motion requests, using an existing character video or one authorized generation attempt followed by deterministic local processing.
---

# Transparent 2D Frame Animation

Use this skill when the user provides character reference artwork and asks for a
transparent 2D sequence-frame animation, including processing an existing raw
character video. Ordinary reference-artwork background preparation is in scope;
arbitrary-background video removal and general video editing are not.

## Agent workflow

1. On first use, run `ai-frame-animation self-test`. If the user asks for a new
   workspace, call `init` with their motion request; never overwrite an existing
   workspace. Run `tools check` for that workspace. Call `tools install` only
   after the user has explicitly asked for or approved dependency setup.
2. Translate the request into a job JSON without inventing character, action,
   camera, continuity, size, or frame-count decisions that materially change it.
3. Choose the input route before provider setup:
   - **Existing video:** keep a copy inside the workspace's ignored `work/` tree,
     run `doctor --root <workspace> --require-ready` without provider options,
     then `plan`. Do not configure ComfyUI, call `run`, create a generation
     attempt, or request a generation-compute confirmation. The user's request
     authorizes local processing; it does not authorize a new video generation.
     `init` currently creates an unused provider template; it can remain unused.
     A motion description records the existing action; processing cannot make
     that video perform a different action.
   - **New video:** accept ordinary reference artwork, including white or complex
     backgrounds; do not require the user to supply a transparent PNG. Use
     `doctor --reference <original> --preparation-config <config>` to check local
     CPU segmentation setup (omit config for existing alpha), then `prepare
     --reference <original> --out-dir <new-directory> --config <config>`.
     The program preserves the original, separates the foreground and fits the
     canvas. This explicit local processing may use CPU, but no GPU, service or
     automatic model download. Dependency setup still needs user authorization.
     Inspect `foreground.png` and warnings; if ambiguous, request a subject choice
     or better source, not transparency merely as a format requirement.
     For an identified residual-background patch, offer the optional correction
     below; do not run it automatically or treat missing material as residual background.
     Call `plan --prepared-reference <preparation.json>`, then repeat
     `doctor --plan <plan>` with provider options. The plan binds original,
     foreground and preparation evidence; key colour is chosen from foreground.
     The program composites this foreground onto the selected key during `run`.
     Show the immutable plan digest and request one
     explicit compute confirmation. Create a unique attempt ID and invoke `run`
     once. Neither `doctor` nor `plan` may submit provider work.
4. Keep tool execution in the Python environment where the matching CLI release
   is installed; `python -m ai_frame_animation` is equivalent to the executable.
   Plan, reference, preparation report, raw, and delivery arguments are relative
   to `--root`; configuration and inspect target paths are relative to the shell's
   current directory.
   Manage IDs and internal paths for the user.
5. Once raw video exists, call `process`, `inspect`, and `validate`. Deterministic
   processing may be repeated from the same raw-video digest. If a deterministic
   runtime adapter supplies a verified `decoded-handoff`, pass it to `process`;
   do not inspect, invent, or edit its hashes.
6. Report the requested artifacts, quality policy, warnings, and manifest path.
   Inspect the actual frames as well: structural validation does not establish
   character fidelity or a natural loop. Do not present a visibly failed result
   as an accepted animation even if the program reports a structural pass.

The Agent does not generate frames itself, edit attempt state, assemble manifests,
or waive quality failures. The installed CLI owns those operations.

## Optional local reference correction

Use only for a requested, identified patch of leftover canvas in an otherwise
useful preparation. Check `ai-frame-animation correct --help` first; older
releases may not support it or its v5 preparation reports. Do not simulate a
missing command by editing images/reports. Keep the Skill and CLI compatible.

Coordinates are in the original EXIF-oriented `cutout.png`, not the fitted
foreground or a thumbnail. A rectangle is half-open and covers at most 5% of the
original canvas; its sample point identifies visible residual background. Example
coordinates below are placeholders for the actual image, not reusable defaults:

```powershell
ai-frame-animation correct preview --root my-animation --prepared-reference work/reference/r001/preparation.json --region 88 62 112 86 --background-point 100 74 --out-dir work/correction/c001
```

Show the program's before/after purple views, source/detail views on purple and
black, changed-pixel counts and `correction_sha256`. Stop for explicit user approval
of that exact preview; never approve on the user's behalf. If accepted:

```powershell
ai-frame-animation correct apply --root my-animation --preview work/correction/c001/correction.json --confirm-correction-sha256 <approved-correction-sha256> --out-dir work/reference/r002
ai-frame-animation plan --root my-animation --job job.json --prepared-reference work/reference/r002/preparation.json --out work/plan-r002.json
```

Keep the original, parent and preview; use a fresh output directory. `preview` is
not a preparation and must not be passed to `plan`. Neither command uses a model
or provider. Edit approval does not authorize video compute; a later `run` still
needs fresh plan-bound confirmation. Local removal cannot restore omitted hair,
clothing or gauze. Same-coloured foreground inside the rectangle may be damaged;
decline a bad preview rather than expanding removal or calling it a quality pass.

## Required boundaries

- Do not automatically retry generation after submission may have occurred.
- Derive 16/32/64 variants from one raw video, one probe, and one decode.
- Remove the selected key globally, including enclosed background holes; preserve
  soft alpha and decontaminate key-coloured edge spill.
- Treat PNG alpha as authoritative. GIF is a binary-transparency preview.
- Use half-open loop sampling and terminal-inclusive one-shot sampling while
  preserving the original rational timeline.
- Default to `strict`; use `best_effort` only when the user explicitly chooses it.
  Opaque media can never pass as transparent delivery.
- Never expose credentials, private endpoints, workflow/model paths, Docker or
  worker state, or private handoff material. The public decoded-handoff may
  contain only provider-neutral fingerprints and tool evidence.
- Never choose a random FFmpeg download. `tools install` must use the packaged
  platform lock, verify its digest, stay inside the ignored workspace, and leave
  system `PATH` unchanged.

Read [references/video-state-machine.md](references/video-state-machine.md) when
handling authorization, attempts, or retries. Read
[references/video-runtime-adapter-protocol.md](references/video-runtime-adapter-protocol.md)
when binding a provider plugin. Repository-wide rules are in
the root `AGENTS.md` when using a source checkout. An installed Skill is
self-contained; do not assume the source repository is present beside it.

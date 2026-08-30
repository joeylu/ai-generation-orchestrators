---
name: skills-2d-frame-animation-video
description: Deliver transparent 2D character frame animation from reference artwork and motion requests, using an existing character video or one authorized generation attempt followed by deterministic local processing.
---

# Transparent 2D Frame Animation

Use this skill when the user provides character reference artwork and asks for a
transparent 2D sequence-frame animation, including processing an existing raw
character video. It is not a general video editor or arbitrary-background remover.

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
   - **New video:** validate the user's local provider configuration with
     `doctor`, then call `plan`. Show the immutable plan digest and request one
     explicit compute confirmation. Create a unique attempt ID and invoke `run`
     once. Neither `doctor` nor `plan` may submit provider work.
4. Keep tool execution in the Python environment where the matching CLI release
   is installed; `python -m ai_frame_animation` is equivalent to the executable.
   Plan, raw, and delivery arguments are relative to `--root`; provider-config
   and inspect target paths are relative to the shell's current directory.
   Manage IDs and internal paths for the user.
5. Once raw video exists, call `process`, `inspect`, and `validate`. Deterministic
   processing may be repeated from the same raw-video digest. If a deterministic
   runtime adapter supplies a verified `decoded-handoff`, pass it to `process`;
   do not inspect, invent, or edit its hashes.
6. Report the requested artifacts, quality policy, warnings, and manifest path.

The Agent does not generate frames itself, edit attempt state, assemble manifests,
or waive quality failures. The installed CLI owns those operations.

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

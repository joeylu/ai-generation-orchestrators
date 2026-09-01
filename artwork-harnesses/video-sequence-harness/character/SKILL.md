---
name: skills-2d-frame-animation-video
description: Deliver transparent 2D character frame animation from a reviewed transparent reference and motion request, using an existing video or one authorized generation attempt followed by deterministic local processing.
---

# Transparent 2D Frame Animation

Use this skill when the user provides character reference artwork and asks for a
transparent 2D sequence-frame animation, including processing an existing raw
character video. Producing a transparent still reference is a separate optional
Harness or service. This Skill only validates and consumes its neutral handoff;
arbitrary-background video removal and general video editing are not in scope.

## Agent workflow

1. On first use, run `ai-frame-animation self-test`. If the user asks for a new
   workspace, call `init` with their motion request; never overwrite an existing
   workspace. Run `tools check` for that workspace. Call `tools install` only
   after the user has explicitly asked for or approved dependency setup.
2. Translate the request into a job JSON without inventing character, action,
   camera, continuity, size, or frame-count decisions that materially change it.
   For structured Agent interpretation, write only a semantic draft, then use
   `intent build`, `intent validate`, and `compile`; the deterministic CLI binds
   request/reference digests and compilation evidence. These commands never call
   an LLM or provider. Existing callers may continue directly with `job.json`.
3. Choose the input route before provider setup:
   - **Existing video:** keep a copy inside the workspace's ignored `work/` tree,
     run `doctor --root <workspace> --require-ready` without provider options,
     then `plan`. Do not configure ComfyUI, call `run`, create a generation
     attempt, or request a generation-compute confirmation. The user's request
     authorizes local processing; it does not authorize a new video generation.
     `init` currently creates an unused provider template; it can remain unused.
     A motion description records the existing action; processing cannot make
     that video perform a different action.
   - **New video:** first inspect the reference. A meaningful transparent RGBA
     image can be planned directly. For opaque artwork, obtain a reviewed
     `ai_reference_preparation_handoff_v1` bundle from either the optional local
     `ai-image-background-removal` CLI or a configured MCP/service adapter. Both
     routes must materialize the original, transparent foreground, producer
     report, and `handoff.json` inside the private workspace. The Agent must not
     author, repair, or re-sign that handoff. Inspect `foreground.png` and the
     producer's warnings; if ambiguous, request a subject choice or better source,
     not transparency merely as a format requirement. Call
     `plan --prepared-reference <handoff.json>`, then `doctor --plan <plan>` with
     provider options. The video package imports no background-removal package;
     it binds the original, foreground, producer evidence, and handoff digest.
     Legacy `preparation.json` is accepted only as a transition path.
     The program composites this foreground onto the selected key during `run`.
     Show the immutable plan digest and request one
     explicit compute confirmation. Create a unique attempt ID and invoke `run`
     once. Neither `doctor` nor `plan` may submit provider work.
4. Keep tool execution in the Python environment where the matching CLI release
   is installed; `python -m ai_frame_animation` is equivalent to the executable.
   Plan, reference, preparation handoff, raw, and delivery arguments are relative
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

## Optional reference preparation

When an opaque input needs preparation, invoke a separately installed tool or an
MCP tool documented by its own Skill. The repository's local implementation is
`image-background-removal`; it owns CPU model setup, correction previews, visual
review evidence, and the producer report. An MCP adapter may use a different
implementation, but the materialized output must pass this video CLI's neutral
handoff validation. Visual approval of a cutout never authorizes video compute.

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
- Never import a background-removal implementation from this video package or
  require a particular producer name. Depend only on the versioned handoff and
  its verified local artifacts.

Read [references/video-state-machine.md](references/video-state-machine.md) when
handling authorization, attempts, or retries. Read
[references/reference-preparation-handoff.md](references/reference-preparation-handoff.md)
when using a local or MCP background-removal producer. Read
[references/video-runtime-adapter-protocol.md](references/video-runtime-adapter-protocol.md)
when binding a provider plugin. Repository-wide rules are in
the root `AGENTS.md` when using a source checkout. An installed Skill is
self-contained; do not assume the source repository is present beside it.

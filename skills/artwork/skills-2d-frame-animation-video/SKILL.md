---
name: skills-2d-frame-animation-video
description: Plan and deliver transparent 2D character frame animation from reference images and motion requests through one authorized video generation attempt and deterministic local processing.
---

# Transparent 2D Frame Animation

Use this skill when the user provides character reference artwork and asks for a
transparent 2D sequence-frame animation.

## Agent workflow

1. On first use, run `ai-frame-animation self-test`. If the user asks for a new
   workspace, call `init` with their motion request; never overwrite an existing
   workspace. Run `tools check` for that workspace. Call `tools install` only
   after the user has explicitly asked for or approved dependency setup.
2. Translate the request into a job JSON without inventing character, action,
   camera, continuity, size, or frame-count decisions that materially change it.
3. Run `ai-frame-animation doctor` and `ai-frame-animation plan`. Neither command
   may submit provider work.
4. Show the immutable plan digest and request one explicit compute confirmation.
5. Create a unique attempt ID and revision paths, then call `ai-frame-animation
   run` once. Do not ask the user to manage IDs or internal paths.
6. If raw video exists, call `process`, `inspect`, and `validate`. Deterministic
   processing may be repeated from the same raw-video digest. If a deterministic
   runtime adapter supplies a verified `decoded-handoff`, pass it to `process`;
   do not inspect, invent, or edit its hashes.
7. Report the requested artifacts, quality policy, warnings, and manifest path.

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
[`../../../AGENTS.md`](../../../AGENTS.md).

# Agent setup

The CLI is authoritative. The Agent Skill explains when and how to invoke it; the
Skill does not contain a second copy of provider or media-processing code.

## Repository-local use

Open this repository as the Agent's workspace and ask it to read:

```text
artwork-harnesses/video-sequence-harness/character/SKILL.md
```

For background removal without animation, use:

```text
artwork-harnesses/image-background-removal-harness/SKILL.md
```

Then provide the reference image, motion request, desired frame count, size, and
whether the motion should loop. If a raw video already exists, provide its path
and explicitly request processing only. A minimal generation prompt is:

```text
Use the transparent 2D frame-animation Skill for my reference.png. Create a
32-frame 256 px running loop under strict quality. Show the plan and ask once
before generation compute.
```

The root `AGENTS.md` defines repository-wide safety boundaries. The Skill adds the
task-specific workflow and references.

## Installed Skill use

Releases built with the current packaging workflow include
`skills-2d-frame-animation-video-<version>.zip` and
`image-background-removal-<version>.zip` in addition to the Python wheel.
Download the ZIP and wheel from the same fixed release, verify each against that
release's `SHA256SUMS.txt`, and extract the ZIP into a new directory. Import the
extracted `skills-2d-frame-animation-video/` folder into your Agent; it contains
the entrypoint, references, metadata, and license, but no duplicate runtime code.

If an older release does not have the Skill ZIP, use that exact tag's GitHub
`Source code (zip)` archive, not the Python source-distribution artifact, and
take the full directory shown below. Do not mix the wheel with a
Skill taken from a floating branch. The wheel alone does not register a Skill.

The canonical character-video Skill package is the directory:

```text
artwork-harnesses/video-sequence-harness/character/
```

The canonical background-removal Skill package is:

```text
artwork-harnesses/image-background-removal-harness/
```

Import or copy that complete directory using the Skill mechanism supported by
your Agent host. Do not copy only `SKILL.md`, because its `references/` and
`agents/openai.yaml` are part of the package. Skill installation locations and
commands vary by Agent product and version, so follow the current documentation
for the host rather than assuming a global path.

The machine running the Agent must also have the immutable `ai-frame-animation`
wheel installed. The Skill deliberately contains no executable duplicate of the
CLI. Follow [Installation](installation.md) to check or explicitly install
FFmpeg/ffprobe for each workspace.

## Expected interaction

The user supplies natural language and assets. The Agent:

1. chooses existing-video processing or new-video generation, runs `self-test`
   on first use, then `tools check` and `doctor` before planning;
   it may call `tools install` only when the user has explicitly asked for or
   approved dependency setup;
2. writes or updates the job request;
3. calls `plan` without compute;
4. for new generation only, presents the immutable digest and asks once for
   compute confirmation, creates a unique attempt ID, and calls `run` once;
5. for an existing raw video, skips provider configuration and `run` without
   fabricating generation state or asking for generation-compute confirmation;
6. chooses a fresh revision directory and calls `process`, `inspect`, and `validate`;
7. returns artifact and manifest locations with warnings.

The Agent must not ask the user to copy a digest into a shell command, invent a
successful attempt state, retry an uncertain submission, or waive a failed alpha
or package-integrity check.

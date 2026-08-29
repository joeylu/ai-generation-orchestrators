# Agent setup

The CLI is authoritative. The Agent Skill explains when and how to invoke it; the
Skill does not contain a second copy of provider or media-processing code.

## Repository-local use

Open this repository as the Agent's workspace and ask it to read:

```text
skills/artwork/skills-2d-frame-animation-video/SKILL.md
```

Then provide the reference image, motion request, desired frame count, size, and
whether the motion should loop. A minimal prompt is:

```text
Use the transparent 2D frame-animation Skill for my reference.png. Create a
32-frame 256 px running loop under strict quality. Show the plan and ask once
before generation compute.
```

The root `AGENTS.md` defines repository-wide safety boundaries. The Skill adds the
task-specific workflow and references.

## Installed Skill use

The canonical Skill package is the directory:

```text
skills/artwork/skills-2d-frame-animation-video/
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

1. runs `self-test` on first use, then `tools check` and `doctor` before planning;
   it may call `tools install` only when the user has explicitly asked for or
   approved dependency setup;
2. writes or updates the job request;
3. calls `plan` without compute;
4. presents the immutable digest and asks once for compute confirmation;
5. creates unique attempt and revision identifiers internally;
6. calls `run` once, followed by `process`, `inspect`, and `validate`;
7. returns artifact and manifest locations with warnings.

The Agent must not ask the user to copy a digest into a shell command, invent a
successful attempt state, retry an uncertain submission, or waive a failed alpha
or package-integrity check.

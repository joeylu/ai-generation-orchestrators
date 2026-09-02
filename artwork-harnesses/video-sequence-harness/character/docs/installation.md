# Installation

The project has four separate installation layers: the immutable Python wheel,
FFmpeg/ffprobe, the Agent Skill, and an optional local generation provider. A
separate optional CPU segmenter prepares non-transparent reference artwork. None
of these layers bundles model weights, credentials, private workflows, or media.

## 1. Install the immutable Python release

Download the wheel and `SHA256SUMS.txt` from the project GitHub Release. Verify
the digest before installing the exact wheel:

```powershell
Get-FileHash .\ai_frame_animation-<version>-py3-none-any.whl -Algorithm SHA256
python -m pip install .\ai_frame_animation-<version>-py3-none-any.whl
ai-frame-animation self-test
```

`self-test` is offline. It checks packaged schemas, the FFmpeg tool lock,
canonical digests, and timeline rules without generating media or contacting a
provider.

## 2. Create a workspace

```powershell
ai-frame-animation init `
  --root my-animation `
  --motion "A stable side-view running loop"
```

The workspace ignores `.ai-frame-animation/`, `work/`, and the configured
reference image. Project-local tools, provider configuration, raw video, and
deliveries therefore stay outside source control by default.

## 3. Check or install FFmpeg and ffprobe

First check without network access:

```powershell
ai-frame-animation tools check --root my-animation
```

Resolution order is:

1. explicit `--ffmpeg`/`--ffprobe` values where those options are accepted;
2. `<root>/.ai-frame-animation/tools/ffmpeg/bin/`;
3. the system `PATH`.

### Locked project-local install on Windows x64

The packaged lock currently contains one verified automatic-install target:
Windows x64. Install it explicitly with:

```powershell
ai-frame-animation tools install --root my-animation
ai-frame-animation tools check --root my-animation --require-ready
```

The installer downloads the locked BtbN build linked by the
[FFmpeg Windows download page](https://ffmpeg.org/download.html#build-windows),
checks the expected byte count and SHA-256, rejects unsafe ZIP entries, verifies
the executable version, and writes an `INSTALL.json` provenance record. It only
writes below `my-animation/.ai-frame-animation/tools/ffmpeg/`; it does not modify
the system `PATH`, generate media, contact ComfyUI, or use a GPU.

The lock uses BtbN's dated `autobuild-2026-07-31-14-10` month-end asset rather
than the mutable `latest` release. BtbN's published retention policy keeps the
last build of each month for two years; updating a project release must never
silently switch this lock back to a rolling alias.

Installation also refuses to start unless the workspace root `.gitignore`
explicitly ignores `.ai-frame-animation/`. It rejects symlinked tool parents so
the destination cannot escape the selected workspace.

The downloaded build is GPL-licensed. Its `LICENSE.txt` remains beside the local
installation. The MIT-licensed project wheel does not contain or redistribute
the FFmpeg binary.

If a target directory already exists but does not pass verification, the
installer refuses to overwrite it. Inspect it with `tools check` before manually
moving or removing that exact ignored directory.

### Other platforms or externally managed FFmpeg

Automatic project-local installation deliberately fails with
`ffmpeg_tool_platform_unsupported` when the packaged lock has no entry for the
current platform. Install both `ffmpeg` and `ffprobe` through a trusted operating
system package manager, expose them on `PATH`, or pass explicit executable paths:

```text
ai-frame-animation doctor --root <workspace> \
  --ffmpeg <path-to-ffmpeg> --ffprobe <path-to-ffprobe>
```

Do not copy an unverified binary from another host into a release or repository.

## 4. Install or expose the Agent Skill

See [Agent setup](agent-setup.md#installed-skill-use) to get the complete,
version-matched Skill ZIP from a release, or use the exact tag's source archive
when that older release has no Skill ZIP. Installing the wheel alone does not
register the Skill with an Agent.

The canonical Skill package is:

```text
artwork-harnesses/video-sequence-harness/character/
```

For repository-local use, point the Agent to its `SKILL.md`. For installed use,
import the complete directory through the mechanism supported by the Agent host;
do not copy only `SKILL.md`, because its references and Agent metadata are part
of the contract.

## 5. Configure an optional provider

Skip this section when processing an existing raw video. Leave the generated
provider template unused and run `doctor --root <workspace> --require-ready`
without provider options. See [CLI and Agent flow](cli-and-agent-flow.md).

The core planning and processing commands are provider-neutral. Local MiniMax H3
generation uses the private configuration created by `init`:

```text
my-animation/.ai-frame-animation/provider.minimax-h3.json
my-animation/.ai-frame-animation/workflow.json
```

The CLI never starts ComfyUI. Keep the chosen installation directory and launch
command in the ignored private inventory described by the
[local MiniMax H3 provider guide](local-minimax-h3-provider.md), so another
installation cannot be selected by guesswork.

Export the ComfyUI workflow in API format and replace all placeholder bindings:
reference image, positive prompt, generation width/height, and reference-resize
width/height. Keep the configured generation canvas square; the public example
uses 512x512. Use [reference preparation](../../../image-background-removal-harness/docs/reference-preparation.md) on ordinary artwork;
users need not supply transparent PNGs. Opaque-input preparation uses the optional
`segmentation` extra (ONNX Runtime CPU + PyMatting) and a separately verified
BiRefNet General ONNX model. It never downloads a model during preparation and
does not require rembg, Web packages or GPU. Compile the prepared job to
`work/plan.json`, then run the plan-aware static check:

```powershell
ai-frame-animation doctor `
  --root my-animation `
  --provider minimax_h3 `
  --provider-config my-animation/.ai-frame-animation/provider.minimax-h3.json `
  --plan work/plan.json `
  --require-ready
```

`doctor` does not connect to ComfyUI or submit `/prompt`. After explicit compute
confirmation, `run` checks the live runtime's node and model inventory with
read-only endpoints before uploading the reference or submitting `/prompt`.

## Maintainer rule for updating the tool lock

The lock is packaged at
`artwork-harnesses/video-sequence-harness/character/src/ai_frame_animation/tooling/ffmpeg-lock.json`.
A lock
update must pin an HTTPS release asset, byte count, SHA-256, archive shape,
required files, exact reported version, dated release tag, retention class,
source page, and license. Tests must use a local ZIP test double; CI must never
download the real binary.

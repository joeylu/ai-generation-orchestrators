# AI Frame Animation：中文快速入门

[English](README.md) · [安装详情](docs/installation.md) · [Agent 配置](docs/agent-setup.md)

给 AI Agent 一张角色参考图和动作需求，在个人电脑上得到经过校验的透明
2D 序列帧。你描述需求，Agent 调用工具，程序负责处理、校验和打包。
不需要搭建网站、数据库或 Docker 服务。

## 先选一条路径

| 你手上有什么 | 选择 | 是否需要 ComfyUI |
| --- | --- | --- |
| 已有角色视频和对应参考图 | [A：只做本地后处理](#a已有视频只做本地后处理) | 不需要，也不需要 GPU |
| 只有角色参考图，需要生成动作 | [B：本地生成后再处理](#b只有参考图需要生成动作) | 当前可选生成插件需要已配置的本地 ComfyUI |

这里的透明化面向主体与背景可区分、背景接近纯色的角色动画；不是任意实拍
或复杂背景视频的通用抠像工具。已有视频的动作不会因为重新填写描述而改变。

## 1. 安装程序并离线自检

需要 Python 3.10 或更新版本。下面使用 Windows PowerShell；请在一个自己新建的
工作目录中执行，并一直使用同一目录。macOS/Linux 的虚拟环境解释器路径为
`.venv/bin/python`，命令参数相同。

从项目的 [GitHub Releases](https://github.com/joeylu/ai-generation-orchestrators/releases)
选择一个固定版本，下载 wheel 和 `SHA256SUMS.txt`。把下面的 `<version>` 换成
下载的版本；确认输出的 SHA-256 与校验文件中该 wheel 的条目一致，再安装：

```powershell
Get-FileHash .\ai_frame_animation-<version>-py3-none-any.whl -Algorithm SHA256
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install .\ai_frame_animation-<version>-py3-none-any.whl
```

后续显式使用这个虚拟环境，不需要激活脚本或修改系统 PATH：

```powershell
$AnimationPython = (Resolve-Path .venv/Scripts/python.exe).Path
& $AnimationPython -m ai_frame_animation --version
& $AnimationPython -m ai_frame_animation self-test
```

`self-test` 应返回 `status: passed`。它不生成媒体、不连接服务，也不使用 GPU。
如果 Agent 已经帮你装好了程序，让它使用相同解释器即可，不必重复安装。

## 2. 建立私有工作区，检查媒体工具

下面创建32帧、256像素、循环动作、strict 质量的工作区；把动作描述换成你的需求：

```powershell
& $AnimationPython -m ai_frame_animation init --root my-animation --motion "侧视角色跑步循环，镜头固定" --frames 32 --size 256
& $AnimationPython -m ai_frame_animation tools check --root my-animation
```

`init` 拒绝覆盖非空目录。需要16/32/64帧一起交付时，用 `--frames 16 32 64`；
三个版本共享同一原视频。非循环动作用 `--continuity one_shot`。

如果检查提示缺少 FFmpeg/ffprobe，Windows x64 用户可明确选择下载项目锁定的工具：

```powershell
& $AnimationPython -m ai_frame_animation tools install --root my-animation
& $AnimationPython -m ai_frame_animation tools check --root my-animation --require-ready
```

安装会联网下载并校验工具，只写入工作区的忽略目录，不改系统 PATH；
Agent 必须先取得你的安装授权。其他平台使用可信系统安装或显式工具路径，见
[安装说明](docs/installation.md#other-platforms-or-externally-managed-ffmpeg)。

把角色参考图的副本放到 `my-animation/reference.png`。工作区中的 `work/`、
参考图和 `.ai-frame-animation/` 默认不进入 Git；保留原始素材，不要把密钥或模型
路径写进 `job.json`。

## A：已有视频，只做本地后处理

把原视频的副本放到 `my-animation/work/raw/source.mp4`（先创建相应子目录）。
不需要工作流、模型或 provider 配置。`init` 生成的 provider 模板可以不填；
它存在不代表会自动调用生成服务。

让 Agent 读取本项目的 [Skill](skills/artwork/skills-2d-frame-animation-video/SKILL.md)，
然后可以直接说：

> 使用透明2D序列帧 Skill。我已有 my-animation/reference.png 和
> my-animation/work/raw/source.mp4。只做本地后处理，输出32帧、256px、
> loop、strict 的透明序列帧。不要生成新视频、配置或连接 ComfyUI。
> 使用刚才安装程序的虚拟环境，完成后给出产物位置、校验结果和警告。

也可以手动执行以下同一条流程：

```powershell
& $AnimationPython -m ai_frame_animation doctor --root my-animation --require-ready
& $AnimationPython -m ai_frame_animation plan --root my-animation --job job.json --out work/plan.json
& $AnimationPython -m ai_frame_animation process --root my-animation --plan work/plan.json --raw-video work/raw/source.mp4 --out-dir work/revisions/r001
& $AnimationPython -m ai_frame_animation inspect my-animation/work/revisions/r001
& $AnimationPython -m ai_frame_animation validate --root my-animation --delivery work/revisions/r001 --policy strict
```

这里没有 `run`，不会提交生成任务，也不需要“生成计算确认”。`process` 会在本地
解码、抠图并写出新产物，会使用 CPU、内存和磁盘。重新处理时保留同一原视频，
使用新的输出目录（如 `work/revisions/r002`），不要覆盖旧交付。

## B：只有参考图，需要生成动作

当前内置的可选生成插件是本地 ComfyUI MiniMax H3。你需要自行准备兼容的
本地 ComfyUI、模型和可用工作流；项目不会下载模型、启动 ComfyUI 或代配所有节点。

1. 把 ComfyUI 工作流导出为 **API 格式**，保存到
   `my-animation/.ai-frame-animation/workflow.json`。
2. 编辑 `my-animation/.ai-frame-animation/provider.minimax-h3.json`，
   将参考图节点、正向提示词节点的占位 ID 换成工作流中的实际 ID；如输入名称
   或本地地址不同，也要按实际配置。真实配置只留在私有工作区。
3. 静态检查配置：

```powershell
& $AnimationPython -m ai_frame_animation doctor --root my-animation --provider minimax_h3 --provider-config my-animation/.ai-frame-animation/provider.minimax-h3.json --require-ready
```

`doctor` 就是“环境体检”：检查依赖、文件和节点绑定，不连接 ComfyUI。
`statically_ready` 不代表模型已加载或实际生成一定成功。

让 Agent 读取同一 [Skill](skills/artwork/skills-2d-frame-animation-video/SKILL.md)，再说：

> 根据 my-animation/reference.png 生成侧视跑步循环，交付32帧、256px、strict。
> 先检查本地配置并展示计划，获得我一次明确计算确认后才能生成。
> 不得自动重试视频生成；如果已有原视频，只重跑确定性后处理。

Agent 负责 `plan → 一次确认 → run → process → inspect → validate`。
你不用手工复制摘要、管理 attempt ID 或填写交付清单。
生成请求可能已被接受但结果不明时，程序会停止，不会偷偷再提交一次。

## 3. 获取和安装完整 Skill

- **打开源码仓库使用：**让 Agent 读取
  `skills/artwork/skills-2d-frame-animation-video/SKILL.md`。
- **只安装发布版：**如果所选 Release 附有
  `skills-2d-frame-animation-video-<version>.zip`，按同一 Release 的
  `SHA256SUMS.txt` 校验后解压，再通过 Agent 支持的机制导入完整 Skill 文件夹。
  wheel 和 Skill 选择同一版本。
- **旧 Release 没有 Skill ZIP：**下载该固定 tag 的 GitHub `Source code (zip)`
  （不是 Python 源码分发包），取出其中完整的
  `skills/artwork/skills-2d-frame-animation-video/`，不要从浮动分支混取。

仅安装 wheel 不会自动给 Agent 注册 Skill；仅安装 Skill 也不会安装 Python 程序。
不要只复制 `SKILL.md`，其 `references/` 和 `agents/` 也需要保留。
具体安装目录由 Agent 产品决定，本项目不会替你改全局 Agent 配置。

## 怎样判断交付成功

示例的输出在 `my-animation/work/revisions/r001/`：根目录有
`delivery-manifest.json` 和 `delivery.zip`，`frames-32/` 下有透明 PNG 帧、
spritesheet、atlas 和可选 GIF。以 `validate` 通过为准，不是“有 ZIP 就成功”。

- PNG 的连续 alpha 是正式透明度来源，GIF 只支持二值透明预览。
- `strict` 默认要求完整交付通过校验；失败应保留诊断，不自动改成 `best_effort`。
- `best_effort` 也不能把不透明结果算成透明成功。
- 结构校验不等于动作或美术质量验收，仍需查看实际画面。

更多说明：[CLI 和路径规则](docs/cli-and-agent-flow.md)、
[质量策略](docs/quality-policies.md)、[开发与回归测试](CONTRIBUTING.md)。

# AI Generation Orchestrators：中文快速入门

[English](README.md) · [安装详情](artwork-harnesses/video-sequence-harness/character/docs/installation.md) · [Agent 配置](artwork-harnesses/video-sequence-harness/character/docs/agent-setup.md)

这是一个由 AI Agent 驱动的游戏资产 Harness 集合，公开目录分为
[美术](artwork-harnesses/)、[音乐音效](audio-harnesses/)、
[游戏 UI](game-ui-harnesses/)和[游戏场景](game-scene-harnesses/)四大类。
未实现能力只提供明确标记为 `planned` 的文档，不伪装成可调用 Skill。

当前可安装的 `ai-frame-animation` 兼容程序对应美术类中已经实现的图片背景移除
与角色视频序列链路。下面的快速入门仍只描述这条已实现路径。

只需要抠图而不制作动画时，使用独立的
[Image Background Removal Skill](artwork-harnesses/image-background-removal-harness/SKILL.md)。

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
[安装说明](artwork-harnesses/video-sequence-harness/character/docs/installation.md#other-platforms-or-externally-managed-ffmpeg)。

把角色参考图的副本放到 `my-animation/reference.png`。工作区中的 `work/`、
参考图和 `.ai-frame-animation/` 默认不进入 Git；保留原始素材，不要把密钥或模型
路径写进 `job.json`。

## A：已有视频，只做本地后处理

把原视频的副本放到 `my-animation/work/raw/source.mp4`（先创建相应子目录）。
不需要工作流、模型或 provider 配置。`init` 生成的 provider 模板可以不填；
它存在不代表会自动调用生成服务。

让 Agent 读取本项目的 [Skill](artwork-harnesses/video-sequence-harness/character/SKILL.md)，
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
3. 直接提供普通参考图，白底、截图、复杂背景都不要求你先抠成透明 PNG。
   Agent 调用 `prepare` 自动分离前景、等比整理画布，再根据前景选键色。
   已有透明图无需模型；普通背景使用本地 CPU BiRefNet＋边缘去混色，不套旧补洞规则或 alpha matting。
   缺少工具会提示安装，
   不会把“没装工具”误报成“源图不合格”。[准备步骤与安装说明](artwork-harnesses/image-background-removal-harness/docs/reference-preparation.md)。
4. 程序保留原图，产出前景图和可校验处理报告。Agent 复核后生成计划：

```powershell
& $AnimationPython -m ai_frame_animation prepare --root my-animation --reference reference.png --out-dir work/reference/r001 --config my-animation/.ai-frame-animation/segmentation.json
& $AnimationPython -m ai_frame_animation plan --root my-animation --job job.json --prepared-reference work/reference/r001/preparation.json --out work/plan.json
```

`prepare` 可能执行本地 CPU 分割，但不下载模型、不联网、不调用 ComfyUI 或 GPU。
无法辨认主体、遮挡严重或分割结果不可靠时才需要复核/补充素材，不能一概要求透明图。
最后检查这份计划对应的输入：

```powershell
& $AnimationPython -m ai_frame_animation doctor --root my-animation --provider minimax_h3 --provider-config my-animation/.ai-frame-animation/provider.minimax-h3.json --plan work/plan.json --require-ready
```

`doctor` 就是“环境体检”：检查依赖、文件、节点绑定和计划参考图，不连接 ComfyUI，
也不生成图片。生成路线缺少 `--plan` 时，输入检查不算完成。
`statically_ready` 不代表模型已加载或实际生成一定成功。

让 Agent 读取同一 [Skill](artwork-harnesses/video-sequence-harness/character/SKILL.md)，再说：

> 根据 my-animation/reference.png 生成侧视跑步循环，交付32帧、256px、strict。
> 先检查本地配置并展示计划，获得我一次明确计算确认后才能生成。
> 不得自动重试视频生成；如果已有原视频，只重跑确定性后处理。

Agent 负责 `prepare → 前景复核 → plan → doctor --plan → 一次确认 → run → process → inspect → validate`。
你不用手工复制摘要、管理 attempt ID 或填写交付清单。
生成请求可能已被接受但结果不明时，程序会停止，不会偷偷再提交一次。

### 可选：局部残底先预览，再确认

正常结果不需要额外修正。若主体已经可用，但某处孔洞还留有背景，可以直接说：

> 这处孔洞还有残底，先给我局部修正预览，等我确认后再应用。不要生成视频。

Agent 调用 `correct preview` 展示前后图，你明确批准这一份预览后，才调用
`correct apply` 写到新目录，再用新报告生成计划。坐标与摘要由 Agent 管理，
像素修改和可校验证据由程序负责；原图和旧结果保留。这次是**视觉编辑确认**，
不抵扣或代替后续的视频计算确认。

先用 `ai-frame-animation correct --help` 检查命令是否存在：此功能需要
v0.4.0 或更高版本，v0.3.2 不包含此功能。CLI 和 Skill 应取自同一版本的 Release，
不要拿新版 Skill 混用旧程序。
它不能补回已经丢失的发丝、衣料或薄纱，也不能自动判断同色区域是不是背景。
详见[局部修正说明](artwork-harnesses/image-background-removal-harness/docs/reference-correction.md)和[固定样本验收矩阵](artwork-harnesses/image-background-removal-harness/docs/reference-acceptance.md)。

## 3. 获取和安装完整 Skill

- **打开源码仓库使用：**让 Agent 读取
  `artwork-harnesses/video-sequence-harness/character/SKILL.md`。
- **只安装发布版：**如果所选 Release 附有
  `skills-2d-frame-animation-video-<version>.zip`，按同一 Release 的
  `SHA256SUMS.txt` 校验后解压，再通过 Agent 支持的机制导入完整 Skill 文件夹。
  wheel 和 Skill 选择同一版本。
- **旧 Release 没有 Skill ZIP：**下载该固定 tag 的 GitHub `Source code (zip)`
  （不是 Python 源码分发包），取出其中完整的
  `artwork-harnesses/video-sequence-harness/character/`，不要从浮动分支混取。

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
- 非方形画布保持等比并补透明边；明显跨边背景残留、空帧会阻断，未解决的裁切在
  `strict` 下不再仅作为警告放行。验证通过前不会发布本次交付目录或 ZIP。
- 结构校验不等于动作或美术质量验收，仍需查看实际画面。

更多说明：[CLI 和路径规则](artwork-harnesses/video-sequence-harness/character/docs/cli-and-agent-flow.md)、
[质量策略](artwork-harnesses/video-sequence-harness/character/docs/quality-policies.md)、[开发与回归测试](.github/CONTRIBUTING.md)。

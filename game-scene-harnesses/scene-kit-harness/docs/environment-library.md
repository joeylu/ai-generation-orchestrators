# 生成环境素材

项目绑定风格后，Studio 的「素材 → 环境」页会在前景、平台 · 环境、中景、远景和背景各组末尾显示生成入口，空组也可使用。弹窗显示本次要加入的分组。可以输入提示词、上传一张 PNG，或同时提供两项。选中的参考图会显示缩略图，可以移除。参考图最大 4 MiB，支持 8 位 RGB 或 RGBA PNG。

点击「生成」授权本次设定提取和一张图。进度显示提取设定、出图和检查入库，关闭弹窗后任务可继续。两个阶段各自冻结并记录确切计划的授权和预约。项目风格及锚图只进入出图请求。用户的原始文字及参考图只进入设定提取请求。

透明素材通过技术检查后自动加入发起项目的指定分组。选定的分组随计划、入库素材和项目 ZIP 保存。项目内各地图共享素材，拖入画布时优先使用该分组内当前选中的图层，其次使用该组最靠前的图层。地图缺少对应图层时，首次放置会一并创建图层，两项可以一起撤销。自动入库有独立记录，美术接受仍单独判定。旧任务可通过「查看上次结果」打开原有确认或复检流程。原始输出和审批证据留在本机交换目录。

环境素材库允许画布最外两圈的 Alpha 最多为 `1/255`，同时检查有效主体面积。旧结果如果仅边缘检查失败，可点「重新检查原图」。这会保留原始 PNG 和原判定，另存复检报告。复检通过后可预览并确认入库。

## 本地启用

完整项目可用[正式启动入口](local-workspace.md)统一绑定工具、风格、项目及两个 CLI
工作进程。启动配置只读取本机文件，HTTP 请求沿用原有的 ID 和计划确认。

使用独立的工作区、交换目录和私有适配器目录。Studio 启动参数加上 `--environment-exchange DIRECTORY --environment-style JSON`，同时启用 `--projects DIRECTORY`。风格文件由启动方配置，包含以下字段。

| 字段 | 内容 |
| --- | --- |
| `kitId` | 项目当前素材包的家族 ID |
| `name` | 项目风格显示名 |
| `rules` | 1 至 10 条项目画法规则 |
| `anchorAssetId` | 项目中作为画法锚点的环境素材 ID |
| `anchorSha256` | 该素材 PNG 的确切 SHA-256 |

在单独进程中运行 `node scripts/environment-library-worker.mjs --exchange DIRECTORY --private-workspace DIRECTORY --adapter codex`。交换目录须与 Studio 启动参数一致。可用 `--codex-executable` 指定已安装的本地执行程序，或启动时选择导出 `createEnvironmentLibraryAdapter` 的受信任模块。保持每个交换目录只运行一套 Studio 与生成进程。

内容适配器返回四个短字符串 `subject`、`structure`、`materials`、`details`。出图适配器使用原有 Scene Kit 图像请求接口，返回一张 PNG 的字节。两个调用分别核对确切计划并先写入独占预约。进程意外中断后，已预约但未回收的结果显示为未知，用户可创建新计划。

## 环境素材动画

在项目编辑器中点击普通环境素材卡片上的「动画」。静态素材显示原图。默认类型只配置一条循环的 Idle。交互物可添加最多 12 个状态，指定初始状态、点击后切换的状态，以及单次播放完成后切换的状态。静止状态可用原图或单张姿态 PNG。

选择帧表 PNG，设置列数、行数和每帧毫秒，预览后保存。生成和导入都校验 PNG 与网格结构，透明效果由用户在预览中判断。帧表按从左到右、从上到下读取。每个画布实例独立播放。在 Play Mode 中点击实例可测试切换。素材配置和 PNG 随场景或项目 ZIP 导出。

树、路灯等有固定底座的动画可在当前状态的「逐帧定位」中选择「固定底座」。Studio 以首帧为基准，用每帧底部五行中 Alpha 至少为 128 的像素计算整帧平移。播放一整圈确认树根或底座的位置，再保存。默认「保留原始运动」，适用于有意移动或接触点变化的动画，也可切回并保存。生成和手动导入的帧表都支持该选项。项目和导出包保存原 PNG 与经过复验的整数位移，水墨半透明边缘随整帧移动。有帧缺少可识别的底部像素时，Studio 提示检查帧表或关闭对齐。

在 Studio 启动时用 `--animation-exchange DIRECTORY` 绑定交换目录，并启用 `--projects DIRECTORY`。另起一个本机进程执行 `node scripts/environment-animation-worker.mjs --exchange DIRECTORY`。工作进程使用已登录 ChatGPT 的 Codex CLI。

填写动作描述后，点击「生成帧表」和「确认生成一次」。通过检查的帧表会载入预览，点击「保存动画设置」后应用到项目。任务可在关闭弹窗后继续，重新打开相应状态即可查看最近一次结果。检查失败或结果未知时会保留原始记录。

未配置本机交换时，可下载生成计划，在 Scene Kit 目录中检查并执行一次。

```text
node scripts/environment-animation.mjs inspect PLAN.zip
node scripts/environment-animation.mjs run PLAN.zip --confirm SHA256
```

CLI 使用本机已登录 ChatGPT 的 Codex 内置生图。计划包含确切的项目素材原图、动作和帧表参数。成功后，在仓库的 `work/scene-kit-environment-animation/<SHA256>/` 查看原图和检查报告。人工审阅后，把其中的 `raw.png` 导入对应状态。未知结果保留原预约，后续生成须另建计划并确认。

游戏预览可用 `createSceneView` 的 `resolveAnimationAtlas(source)` 绑定包内 PNG，并在自己的时钟上调用 `advanceAnimations(deltaMs)`。用 `interact(nodeId)` 把游戏交互传给指定实例。

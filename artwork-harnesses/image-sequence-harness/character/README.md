# Character image sequence

**Status: released, version 0.2.1.** 固定 4×4、16 帧的角色图片序列 Harness。
包含独立 Python CLI、可选云端异步图片 MCP 适配器和离线回归测试。
公开核心保持 provider-neutral；具体云端服务、模型身份和生产可用性仍须由安装方在自己的环境中验收，
本发布不宣称任何特定模型已经集成或通过生产验证。封版范围和已知限制见
[版本说明](docs/release-0.2.1.md)。

```text
参考图 + 动作描述 + 四段动作阶段
  → 准备计划 → 普通图云端抠图 / 已抠好的 PNG、WebP 规范化复用
  → 参考前景审核 → ai_reference_preparation_handoff_v1
  → 不可变计划（4×4 / 16 帧 / 动作时长）
  → 单次授权 → imagegen → 原始 PNG
  → 原图视觉审核
  → 单次授权 → remove_background_image → 透明 PNG
  → 整板规范化 → 严格固定切帧 → 可选脚底基线/中心锚点平移 → alpha 与边界检查 → 审核联系表 / GIF 预览
  → 绑定候选指纹的语义审核
  → 16 张 PNG + 4×4 atlas.png + manifest.json + 可选 preview.gif
```

本包只处理单角色、单动作。整板抠图使用云端 MCP，不运行本地分割、抠色或去色边。
云端生图只要求正方形，不要求命中 prompt 中的期望像素尺寸；整板抠图必须保持该原图的实际尺寸。
处理阶段将整板统一缩放到计划的规范工作尺寸后切格。遗漏角色、跨格、裁切或缺帧仍会阻断，
不自动补帧、降帧或改用其他策略。
默认保留原有格内坐标。`alignment_mode: "bottom_y"` 只修正脚底基线的 Y 坐标，X 始终不动；
`bottom_center` 同时修正脚底接触锚点的 X/Y。原始帧、每帧原始/输出锚点和 `dx/dy` 均保留，
任何裁切风险都会失败。
该模式不能自动开启，也不能用于掩盖本来应该存在的腾空运动。

```json
{
  "alignment_mode": "bottom_y",
  "alignment_reference_frame": 1,
  "alignment_padding": 16
}
```

站立待机、站桩施法和原地攻击默认推荐 `bottom_y`；只有明确需要同时锁定水平接触点时才使用
`bottom_center`。跳跃、下落、击飞和悬浮保持 `none`。跑步和走路应先看 `preview-align`，
因为稳定脚底的同时也可能削弱有意设计的身体起伏。

动作自然度可通过两个显式、不可变的请求字段控制：`pose_blueprint` 必须逐帧提供恰好 16 条
姿势职责并写入生成提示词；`timing_weights` 必须提供 16 个正整数，用于在保持 `duration_ms`
总时长不变的前提下分配每帧展示时长。缺省时仍使用四阶段提示和等时播放。

## 安装与运行

需要 Python 3.11+、Pillow 和 jsonschema。开发安装在本目录执行：

```powershell
python -m pip install -e .
ai-character-image-sequence self-test
ai-character-image-sequence init --root .test-work/my-animation
```

将参考图放进新工作区，编辑生成的 `request.json`，然后运行：

```powershell
ai-character-image-sequence plan --root .test-work/my-animation --request request.json
```

首次 `plan` 输出准备计划摘要；参考图审核后再次执行 `plan`，得到绑定前景的新正式摘要。
生图只能使用正式计划，不能使用未准备参考图的旧计划。`init`、`plan`、`doctor`、
`inspect`、`validate`、`self-test` 都不访问云端。`doctor` 只检查本地配置和密钥环境变量是否存在。
`probe` 只执行远端工具发现和 schema 校验，不提交生图或抠图任务。
正式消费者应安装经过校验的不可变版本 wheel，而不是复制源码后单独维护。

- [完整 CLI 流程](docs/cli.md)：配置、授权、提交、查询、审核与交付。
- [接口与状态约定](docs/contracts.md)：MCP 参数、恢复边界、透明度与时间线。
- [Agent Skill](skills/character-image-sequence/SKILL.md)：在 Agent 中加载此入口；wheel 不会自动注册 Skill。
- [示例请求](examples/request.json) 与 [私有配置形状示例](examples/adapter.example.json)。

实际端点只填写在任务工作区 `.character-image-sequence/adapter.json` 中。密钥通过该文件
指定的环境变量提供。源码、公开计划和交付清单不记录真实端点、密钥、任务 ID 或签名链接；
任务私有目录保存提交输入、授权和任务回执。

参考图不是“有 alpha 通道就算抠好”：检查外缘连通透明区域和非空前景后仍需视觉审核。
全不透明 RGBA 图会走云抠图。`reference_mode: "cloud"` 可显式要求透明图也重新云抠图。
已抠好的 PNG/WebP 可以运行 `prepare-reference` 转为规范 RGBA PNG；只转换格式与方向、
清零透明像素 RGB，不抠图、不修改 alpha，不产生云端调用。
参考审核返回的 handoff 路径可作为新请求的 `reference_preparation_handoff`，在原图指纹一致时
复用同一个已审核前景，避免为不同动作重复参考抠图和审核。
前置阶段接受最大 16 MiB 原图，实际用于生图的已审核前景须符合 2 MiB 输入上限。
本包只复用视频链路的中立 handoff 格式，不引入其本地分割或视频处理依赖。

## 帧与时间语义

- 生成布局永远为 4×4；原图尺寸和交付单帧尺寸分别设置。
- 生图原图可为任意正方形尺寸；非正方形会拒绝。抠图输出必须与原图尺寸完全一致。
- `board_size` 是确定性处理的规范工作尺寸。不同尺寸的正方形整板会先整体缩放到该尺寸，
  再按 `board_size / 4` 切格；只有计划显式绑定的 `bottom_y` 或 `bottom_center` 模式会在切格后平移整帧。
- 已审核的透明 raw board 可以运行 `preview-align` 生成不进入交付的灰底前后对比；正式候选仍要求
  经过现有 matte 证据门。
- 交付尺寸大于规范单格时会记录“未增加原生细节”的 warning。
- `duration_ms` 指整段播放时长；FPS 以有理数 `16000 / duration_ms` 保存。
- 循环动作的动作相位为 `0/16 … 15/16`；单次动作是 `0/15 … 15/15`，含终点。
- PNG 保留连续 alpha；alpha 为 0 的 RGB 归零。GIF 将所有非完全不透明像素映射为透明，
  仅用于动作预览，不能作为 alpha 质量依据。
- GIF 用累计边界舍入分配厘秒，保证总时长；启用 GIF 时总时长必须为 10ms 的倍数。
- 非等时 GIF 使用 `timing_weights` 确定性分配厘秒；计划、候选帧时间线和校验器共享同一权重。

## 测试与构建

在本目录中：

```powershell
$env:PYTHONPATH = Join-Path (Get-Location) 'src'
python -m unittest discover -s tests -v
python -m build --wheel --no-isolation
```

测试使用几何 PNG fixture 和 HTTP/MCP doubles，不调用生图、云抠图或私有服务。
测试临时文件、构建产物均位于本目录的忽略路径。其他 Harness、父级目录索引和全局配置
不属于本次实现范围。

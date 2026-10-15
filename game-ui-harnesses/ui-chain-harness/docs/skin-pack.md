# PNG 皮肤包：导入、验证与维护

本文说明离线 PNG 资产包与消费接口。它接收已经存在的透明素材板，不调用模型、不去背、不猜测主体位置。当前 [Studio](local-studio.md) 已连接参考图、批次生成、定位、任务后处理和预览；这些上游能力与严格导入边界分开。程序夹具通过不等于真实风格已生成或人工接受。历史阶段与试验记录见 [执行文档](execution-plan.md)。

## 输入与输出

输入 `skin-import.json` 遵循 [导入 Schema](../schemas/skin-import.schema.json)：

| 字段 | 维护职责 |
| --- | --- |
| id / revision / sourceKind | 皮肤身份与修订；程序测试输入必须为 fixture；外部图片只能标记 imported，不能直接写 accepted |
| sheets | sheetId 到本地板图文件的映射；板/部件清单与裁切坐标继续来自活动模板 JSON |
| parts | 以 assetId 为键，维护本套皮肤的 nineSlice、contentInsets、minSize，以及可选 density（默认 1）；四边与最小尺寸均用逻辑像素 |
| theme | 文字字号、颜色、状态派生参数与控件几何；通用类型约束由 runtime-theme Schema 唯一维护 |
| fonts / licenses | 一套正文字体的 WOFF2 子集、字重 400、normal、unicodeRange 与许可证；显式打包，不使用系统字体作交付资源 |

所有输入文件路径相对导入 JSON 所在目录。禁止绝对路径、URL、父目录跳转、编码路径、Windows 设备名与符号链接/junction。输出目录必须与输入元数据分开。调用方应保留原图；导入只读取源文件。

活动模板、组件注册和皮肤角色映射仍分别来自 configs 中原有 JSON。`skin-usage.draft.json` 中的生产待定值不会被离线测试填写。这里的 parts 是每套具体皮肤的使用元数据，不再手写资产状态、组件名单或裁切坐标。

输出遵循 [皮肤包 Schema](../schemas/skin-pack.schema.json)，包含：

- `assets/<assetId>.png`：完整清单的独立 RGBA PNG，保留连续 alpha。
- `sources/<sheetId>.png`：未改写的原始输入板，保留来源摘要。
- 字体子集和许可证。
- `skin-pack.json`：身份、来源、角色映射、尺寸、切片/安全区/最小尺寸、文件字节数与 SHA-256。
- 包外的 `inputs.json`、`report.json`：冻结输入及技术检查证据，由程序产生。

每次成功导入写入一个新 build；完全验证后才更新 current。失败保留 `.staging`，不替换上一版。不要手工编辑 manifest、report 或 current。技术通过仍固定为 `visualAcceptance: unreviewed` / `productionReady: false`。Studio 有真实 PNG 预览与组件检查入口，但尚未实现将外观正式记录为 accepted 的完整接受流程或生产发布命令；不要把“可预览”“已入库”解释为美术已接受。

启用可选 S05 时，基础四图和 30 部件合同不变。确定性材质扩展会额外保存 `materialAssets`、`surfaceStyles`、原图摘要及裁切来源，派生新的皮肤版本；它复用本节的包验证与 PNG 消费接口，不额外创造组件类型。详见[任务接入](skin-task-dag.md)。

## 命令

在本 Harness 目录执行：

```powershell
# 离线夹具：生成测试板、裁切并打包，再用真正的 PNG/字体运行全部组件检查
npm run skins:check -- --browser chrome
npm run skins:preview-status

# 导入自己准备好的本地图片及使用元数据（路径示例需替换）
npm run skins:import -- --input path/to/skin-import.json
npm run skins:status
npm run skins:verify -- --package generated/skin-packs/builds/<buildId>/pack

# 只派生首套真实风格的准备计划；不会调用模型
npm run skins:plan
```

`skins:check` 的入口在 `previews/skin-packs/current.json`，包含独立资产包、输入示例、横竖 PNG 与报告。示例由 [raster-skin.mjs](../fixtures/raster-skin.mjs) 从当前模板和中性夹具配置自动派生，不是用户另一份维护源。校验脚本使用已安装 Chrome、软件 WebGL，网络阻断。

`skins:import` 的默认输出在 `generated/skin-packs/`；可用 `--out` 选择其他输出目录。`skins:status` 核查当前包的文件、来源裁切、依赖绑定与导入工具摘要。`skins:preview-status` 检查 PNG 消费验证版本、截图及包摘要。current 只代表对应来源未过期，不代表生产可用或美术已接受。

生成准备计划在 `generated/skin-plans/`，清单和几何来自模板投影，优先选择包含较多伸缩方式的板作试验。缺少参考图、风格 JSON 和生成能力信息时保持 `missing-inputs`；它不是可执行生成请求或计算授权。每次生成新的计划文件，历史不覆盖。

### 绑定真实参考图的单板计划

风格意图维护在每套皮肤自己的 `work/skins/<style-id>/style.json`，遵循 [风格草案 Schema](../schemas/skin-style.schema.json)。它区分参考图观察、视觉估计色板、设计扩展建议和按资产 ID/前缀匹配的材质规则；不再维护第二份部件坐标、数量或图片。新增部件仍改模板 JSON，提示词和几何投影从活动模板派生；新材质需要对应风格规则。`status` 仅允许 draft，不能用手写字段伪造人工接受。

```powershell
# 无网络、无生图；参考图暂支持与 PNG 导入相同的编码范围，可为不透明图片
npm run skins:plan -- --reference path/to/reference.png --style work/skins/example/style.json --sheet S03 --out work/skins/example/plans

# 用上一步返回的完整摘要核查冻结输入及当前合同/规划工具
node scripts/skins.mjs plan-verify --package work/skins/example/plans/<sha256> --sha256 <sha256>
```

带参考图的计划强制输出到本 Harness 被忽略的 `work/` 下。每份计划以 `plan.json` 的 SHA-256 为目录名，冻结原始参考 PNG、风格 JSON、活动模板/注册/角色映射、单板几何、两版模板 PNG、完整提示词和人工核对页；参考原字节不重写。两张输入图的职责分别是“仅提供风格”和“精确几何模板”，核对图不作为生图输入，JSON 投影嵌入提示词。同样输入得到同一摘要；更改风格或合同须派生新计划，不覆盖旧版。

`plan-verify` 是输入完整性和过期检查，不是授权消费或模型调用。原图选择、风格接受、计算授权、技术通过和最终美术接受分别记录。尺寸、几何、alpha 和 PNG 编码能力仍标记 unverified，待实际试验结果证明；计划工具没有伪装为已经实现完整的真实生图 Harness。切片/安全区/最小尺寸在看到真实结果后确定，不能照抄夹具值。

### 外部单板调用的本地记录

`scripts/skin-attempt.mjs` 提供离线 reserve/receive 两步，不直接接入模型，也不会重试。调用者必须先取得对应完整摘要的明确人工确认；`--confirmed` 只传递这份已经取得的确认，命令自身不是确认界面。首版每份计划只允许预留一次；已有 reservation 或不明结果不允许再提交。

```powershell
# 仅在用户明确确认这个完整摘要的一次调用后执行
node scripts/skin-attempt.mjs reserve --plan work/skins/example/plans/<sha256> --sha256 <sha256> --confirmed <sha256> --out work/skins/example/attempts

# 外部工具返回后，复制原字节并检查；不透明/错尺寸/越界仍保留原图并写 rejected
node scripts/skin-attempt.mjs receive --plan work/skins/example/plans/<sha256> --sha256 <sha256> --attempt work/skins/example/attempts/<sha256> --raw path/to/raw.png
```

记录目录包含 reservation.json、receive.claim、raw.png、inspection.json 和 receipt.json。检查使用冻结模板的逻辑坐标及 outputScale，统计尺寸、alpha、主体区域非空、主体外像素；连通区域仅作诊断，不能证明资产语义或自动更改裁切。原图保留全透明像素的原始 RGB，不在接收阶段修复。几何通过也仍需美术、身份及拉伸检查。

此单板桥接命令的重复预留/接收会拒绝；没有 receipt 的预留属于未完成或结果不明，禁止删除记录后重投。当前整批执行另有适配器、显式原图恢复与单张补图入口；它们不改变这里的单次预留规则，见 [Studio 恢复边界](local-recovery.md)。首次单板试验结果保留在执行文档 12.4。

## 当前严格支持范围

已生成的板若几何不符，可进入单独的 [定位与规范化候选流程](skin-normalization.md)。该流程不修改原始失败，不放宽下列导入条件；候选经审核、补齐全部必需板及使用元数据后，才能作为新输入进入正式资产包校验。

- 输入为每边不超过 4096 像素的 8-bit、非交错 RGB/RGBA PNG，sRGB；输出尺寸必须与模板的 outputScale 精确对应。索引色、16-bit、动画、ICC、tRNS 和其他 gamma 暂不支持，须由明确的上游转换步骤提供兼容输入。
- 裁切使用模板 bodyRect。主体矩形外任何可见像素都会拒绝；空部件、错尺寸、缺板/缺使用元数据也拒绝。阴影、描边越界须调整源或模板后重新评审，不静默裁掉、不自动纠偏。
- 输出完全透明像素的 RGB 归零，非零 alpha 保留；校验时重新解码原板并逐像素核对裁切来源。该检查不能判断语义串位、风格好坏或九宫格是否美观。
- 单文件最多 32 MiB，导入元数据最多 2 MiB，总输入最多 96 MiB，总包资源最多 128 MiB；当前 Schema 最多 64 板、256 部件、256 字体子集。
- 首版只提供 body 正文字体族；多字号由已有 TextStyle 覆盖规则处理。完整语言覆盖、真实 IME/触摸、字体生产授权与跨主题接受仍需分别验收。
- 非对称九宫格已支持。按钮及列表/页签按钮、输入框、Panel 使用内容边距；Dialog 仍使用统一 padding，若小于皮肤安全区会拒绝。Select 弹出底板暂只支持零内容边距，非零会明确报能力不足；更复杂皮肤应在真实绑定阶段补适配。
- Studio 组件画布已消费项目真实 PNG 皮肤，面板生成会冻结所选皮肤及合同版本，并提供本地预览和文件下载。这些入口不代表完整皮肤的美术接受或生产发布已完成。

## 运行时接口与生命周期

### 从已有定位素材组装完整包

#### 统一参数，不强制统一渲染封装

正式 PNG 皮肤的密度、四边切线及文字安全边距统一由 [usage.mjs](../src/skins/usage.mjs) 消费；皮肤打包、运行时和 Panel 文档共用 [geometry.mjs](../src/slicing/geometry.mjs) 的源尺寸换算与九宫格几何校验。PixiUI 的四值数组、Pixi 的四边属性及 Panel 的背景参数从同一份元数据派生，不分别维护。组件自身行为和各自的渲染接入方式保留，Panel 的实例边框倍率也保留。

Panel 文档仍存原图像素切线 `bordersPx`；皮肤仍存逻辑切线 `nineSlice`，避免破坏既有文件。包纹理的物理分辨率为 `scale × density`，两种表示通过共用换算入口对应。内容安全边距由皮肤维护，不从切线直接猜测；程序中性夹具的参数仍由夹具生成。

可选的只读建议入口复用 Panel 的 `analyzePanel` 算法，对最终独立 PNG 分析（包含组包后的透明边距）：

```powershell
node scripts/skin-slices.mjs --package work/skins/example/assembled/<assembly-id>/package/builds/<build-id>/pack
```

输出 JSON 含来源包/图片摘要、分析代码摘要、当前切线、建议像素/逻辑切线及最小尺寸兼容性。`supported` 只代表算法给出候选，不等于适合所有控件尺寸；`unsupported` 不给替代数值，等比部件直接跳过。命令不会改包、原图、密度、状态组、内容边距或维护配置，也不会在运行时重新分析。

自动 metadata 派生通过同一 `suggestSlices(image, resolution, { axis })` 入口传入模板的拉伸方向：九宫格为 `both`，横向部件为 `horizontal`，纵向部件为 `vertical`。单轴部件仅验证所需方向的中心空间，另一方向切线为 0；状态组仍共享原图框与等比尺度。Panel 编辑器与独立面板 PNG 默认保持双轴分析。对于轻微侧向明暗变化，结构分析可使用边框搜索范围之后、与中心色差不超过 35 且稳定不透明的实测底色带；记录 `framed-texture-local-shade-v1` 证据，不改原像素、不放宽中心图案/透明孔洞拒绝规则。不能识别时仍停止，不能用默认切线伪装通过。

采用建议前须查看圆角/装饰是否完整、状态切换是否对齐，以及窄尺寸和文字边距；只在该皮肤的维护输入中调整，再派生新包。已经手动调好的切线保持优先，不把算法建议自动写回。通用几何检查能发现负值、无中心和尺寸不足，不能替代视觉验收。

每套皮肤的 `work/skins/<style-id>/assembly.json` 集中维护来源文件及 SHA-256、可选定位框、每件使用元数据和主题。模板继续唯一维护部件、状态组和目标槽位。组装工具要求完整部件清单，并验证模板及输入图片摘要；等比缩放并居中放入槽位，同组状态共享源框和尺度，不自动修边，也不保证不同状态轮廓相同。

```powershell
node scripts/skin-assemble.mjs --config work/skins/example/assembly.json --out work/skins/example/assembled
node scripts/skin-pack-preview.mjs --package work/skins/example/assembled/<assembly-id>/package/builds/<build-id>/pack --out work/skins/example/full-preview
node scripts/surface-preview.mjs serve --out work/skins/example/full-preview/<preview-id> --port 4183
```

每次派生新目录，保留组装输入与报告，再调用既有严格打包流程。包内 sources 是此次派生标准板；原始生成图及原始失败回执应继续保留。当前工具自动随包附带已安装 Noto Sans SC 的字体子集及 OFL 许可证，不调用生成服务。组装配置是每套皮肤的维护输入，不手改派生 manifest、报告或标准板。

`density` 将素材像素与显示逻辑尺寸分开：Pixi 纹理 resolution 为 `pack.scale × density`，默认 1 兼容既有包；图片字节不因此改写。九宫格、内容边距与最小尺寸保持逻辑单位，校验会拒绝切线挤没中心区域。改用高分辨率素材时应同时核对密度与这些使用参数。

完整预览复用 16 类组件及其检查，支持横竖版切换；它不是面板需求生成器或生产接受凭据。风格意图仍在 style.json，部件清单仍在模板 JSON，具体图片和使用参数在 assembly.json；新增交互能力需要对应运行时适配器。

[loadPngSkin](../src/runtime/png-skin.mjs) 接收 manifestBytes、调用方选择的 manifestSha256、expectedBindings 和 `read(relativeFile)` 字节读取回调。组件运行时继续使用同一套 `createRuntime`。加载器不隐式发网络请求；调用方负责从本地包或自己的资源系统提供字节。

manifest 与各纹理/字体均在使用前核对摘要。PNG 先解码为 ImageBitmap，再创建有独立所有权的 Pixi Texture/ImageSource；不把 URL 传给 Texture.from，不借用全局纹理缓存。字体使用每实例唯一的 FontFace 名，避免两套同名字体互相覆盖。加载失败释放已创建资源，不销毁当前活跃皮肤。

尺寸修改先检查组件和皮肤约束。销毁顺序为组件实例/运行时，再 `skin.dispose()`；dispose 可重复调用。九宫格、内容安全区和字体变化后，重跑 PNG 消费检查；不要只看原始资产缩略图。

已有模板新增部件后，完善这套皮肤对应的使用元数据与来源图，再重新导入即可派生新文件与清单。新增交互类型仍需要适配器；额外角色不会自动创造组件行为。

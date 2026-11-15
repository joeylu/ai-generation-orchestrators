# 纯横版地图编译、编辑与导出 v1

源码版本 0.14.0；本文保留 v1 Node ESM 离线内核合同。可选 [本地 Studio](studio-v1.md) 复用
该内核；模型调用和正式美术仍未接入。
作者数据沿用 [五份核心合同](contracts-v1.md)，执行进度见 [执行文档](execution-plan.md)。

0.9.0 增加显式 v2 作者地图与编译格式，曲线字段、四类命令、保存导出兼容和限制见
[曲线原型合同](curves-v1.md)。v1 输入/编译内容保持不变，旧格式不会默默容纳新字段。
0.10.0 的 join-curve-terrains 通过一个原子命令合并邻近端点，沿用 v2 文件格式，
不会在打开旧地图时自动合并数据。
0.11.0 的显式 v3 地图增加矩形格子接头及统一编译网格，见
[混合地形合同](mixed-terrain-v1.md)。v1/v2 原字段和编译内容仍保留。

## 1. 加载与编译

`loadSceneKit(root)` 完成原包全部 P1 校验，返回不可变句柄，并在内存保留实际校验过的
文件字节、文档和语义模型。`readMap(handle, role)` 返回 default/inspection 地图副本。
调用者修改副本不会改变来源包；伪造或复制句柄不能作为合法上下文。

`compileMap(handle, document)` 共用 P1 的预设展开和地图语义校验，返回深度冻结的
`ai_scene_compiled_v1` 描述：

| 字段 | 实际语义 |
| --- | --- |
| source | mapId、规范作者数据摘要、原 kit.json 字节摘要 |
| kitRef / rulesRef | 作者地图绑定的资产与规则修订 |
| grid / worldBounds / defaultCamera | 逻辑格尺寸、逻辑世界范围、播放初始镜头 |
| layers | 按 zIndex 排序的图层、视差、显隐与节点 |
| 节点 | nodeId、assetId、layerId、logicalAnchor、position、size、原 PNG 引用/摘要/尺寸 |
| sourceToLogical | 源像素到逻辑单位的分数变换 |
| 地形节点的 cell / signature | 世界格坐标及归一化邻接角色 |
| 条带节点的 repeat | x 轴与单次周期；可选 Pixi 适配负责可见覆盖和相位 |
| collisionSuggestions | 合并后的暴露边与朝上的站立表面建议 |
| counts / contentSha256 | 地形/视觉节点数量与可重放内容摘要 |

地形按行、列排序，视觉实例按稳定 ID 排序；预设的派生视觉 ID 含层级路径。碰撞来自
占用格，去除内部公共边并合并同线连续边，保留封闭空洞边界；不读取图片 Alpha 猜碰撞，
也不提供物理运行时、跳跃可达性或角色运动保证。

变体候选按 ID 排序，对规则 ID/修订、地图 seed、地形层 ID、格坐标和签名取稳定摘要
选择。改变远处地形或遍历顺序不会重新洗牌未受影响格。节点位置为逻辑锚点加视觉偏移，
再减去 anchorPx 按像素密度转换的值；尺寸按相同比例换算。

当前完整重编译，未实现增量缓存或性能优化。编译结果由独立 Pixi 适配消费；Node
核心入口不直接导入浏览器，本地 Studio 通过确定性宿主调用，呈现边界见 Pixi 文档。

## 2. 编辑会话与命令

`createEditor(handle, document?, {historyLimit:32}?)` 返回内存会话：getDocument、getScene、
execute、undo、redo、history、serialize。省略 document 时使用默认地图。作者数据与
历史独立于来源包；getDocument 返回副本，getScene 返回冻结编译结果。

`execute(commands)` 把最多 256 个命令作为一次原子手势。命令和嵌套字段严格校验；
手势内每步须保持有效，任一步失败会丢弃整个草稿，不改变作者数据、撤销和重做分支。

| type | 其他必需字段 | 行为 |
| --- | --- | --- |
| paint-cells | cells: [{x,y}], familyId | 设置直接地形；同家族已占用格可形成无操作 |
| erase-cells | cells: [{x,y}] | 删除直接地形；空格为无操作 |
| add-instance | instance | 添加符合地图合同的环境/条带实例 |
| move-instance | instanceId, x, y | 移动直接视觉实例，保留 ID |
| remove-instance | instanceId | 删除直接视觉实例 |
| place-assembly | instance | 放置符合地图合同的预设实例 |
| remove-assembly | instanceId | 移除预设及其派生内容 |
| expand-assembly | instanceId | 将预设转换为直接地形和独立视觉实例 |
| resize-bounds | bounds | 显式扩建或改变范围，不平移现有坐标 |
| reorder-layers | layerIds | 按从前到后提交全部图层的完整排列，复用原有渲染层级；兼容旧版同组独立图层的完整排列 |
| reorder-layer-objects | layerId, instanceIds | 按从前到后重排同一图层的全部对象，组合按一个对象处理；兼容旧版同层分类行的完整排列 |

地图对象可用可选的 `drawOrder` 保存层内前后关系，数值较大的对象后绘制。
旧地图沿用实例 ID 的绘制顺序。没有显式排序值的对象绘制在已有排序值的对象之后。

Studio 保留前景、平台（地形／环境）、中景、远景、背景等分组；组内按真实
`zIndex` 降序显示，支持拖动或按钮重排。地形组在环境组前，应将相应作者图层
放到环境图层前方。接手已有地图时，须核对实际层级与预期分组顺序；不一致时用
明确、可撤销的排序命令对齐，不能只改面板或声称分组自动改变了渲染。
同一作者图层被分成多个用途行时仍共用一个层级，不可当作独立遮挡层。
显示、锁定与折叠仍是编辑器状态；打开地图不会静默重写旧场景。

地形画刷每手势最多 100,000 个请求格，不能隐式扩大边界，不能直接修改仍属于预设的
地形格。先 expand-assembly，再修改其地形。展开使用原预设坐标，视觉实例 ID 由父
实例 ID/局部路径稳定派生，冲突则整体拒绝，不随机重命名，也不重复显示原预设。

边界缩小若裁掉地形、预设、视觉锚点或默认相机会失败。检查地图上的 inspectionCases
持续校验，不会为了让编辑通过而自动清除证据。普通工作草稿允许清空地形；这不改变
P1 正式来源包两张地图必须有地形的要求。

每个成功改变形成一条历史。无操作保留 redo，失败也保留 redo；撤销后的新改变清除
redo。历史默认最多 32 条（可设 1—128），并有 16 MiB 内容预算；丢弃最旧项时通过
historyTruncated 明确计数。会话历史不写入运行时作者文档，重新打开建立新历史。
状态中的 recompile=full 表示重编译策略，不是增量性能或视觉验证声明。

## 3. 保存与重新打开

`saveMap(handle, document, newFile)` 验证后写规范 JSON；`loadMap(handle, file)` 验证
并返回规范作者文档。`saveCompiledMap(handle, document, newFile)` 写编译描述。

输出父目录须存在且为普通本地目录，拒绝链接路径、既有目标，以及来源 kit 内的目标。
失败可能留下待检查的部分新输出，不会覆盖或自动重试。保存不修改原始 kit 的默认地图、
摘要、修订或美术接受状态。

摘要区分：

- 作者摘要是规范化作者数据的紧凑 canonical JSON 的 SHA-256，合并相邻地形段并稳定排序。
- 保存文件摘要是实际带缩进、换行的文件字节 SHA-256，与作者摘要用途不同。
- compiled.contentSha256 对去掉自身摘要字段的规范编译内容计算。
- 导出 manifest.compiledSha256 对实际编译文件字节计算。

## 4. 便携目录包

`exportScene(handle, document, newDirectory)` 由程序输出：

```text
export/
  kit/                    # 已校验来源包的准确文件闭包，字节不变
  scene.document.json     # 用户地图，与来源默认模板分开
  scene.compiled.json     # 可重新计算的场景描述
  manifest.json           # 最后写入，记录文件字节数/摘要与来源
```

导出记录的格式为 `ai_scene_export_v1`，精确字段见
[导出 Schema](../schemas/scene-export.schema.json)。不把自身列入文件摘要表，避免循环摘要。
该包是用户地图工作成果，不冒充新的资产发布修订或已接受的美术包；原 kit 的 ID/修订
和全部原始 JSON/PNG 保持不变。载入后原目录文件即使被外部修改，导出仍使用已验证的
内存快照，不悄悄把新字节混入旧摘要。

`openSceneExport(root)` 检查严格 Schema、文件清单、路径、字节数与摘要，拒绝多余或
缺失文件、链接、不完整目录；重新加载来源 kit，并从作者地图重编译，与保存的编译
描述完整比较。即使人为重算了被改编译文件的 manifest 摘要，无法正确重放也会失败。
返回 {handle, document, compiled} 供继续编辑。

单编译文件最大 64 MiB，导出列举最多 8192 文件、总声明内容最多 256 MiB，目录遍历
最多 16384 项。其他输入/地形预算沿用核心合同；展开工作预算按单次分析计算。
P2 只写目录包，不读写 ZIP。manifest 最后写入；部分输出不自动删除，下一次使用新目录。

## 5. 命令与演示

从本 Harness 目录运行，输出的父目录须存在，文件/目录须为新目标：

```powershell
node scripts/scene.mjs compile --root tests/fixtures/synthetic --map default --out ../../work/map.compiled.json
node scripts/scene.mjs edit --root tests/fixtures/synthetic --map default --commands ../../work/commands.json --out ../../work/map.scene.json
node scripts/scene.mjs export --root tests/fixtures/synthetic --document ../../work/map.scene.json --out ../../work/map-export
node scripts/scene.mjs verify-export --root ../../work/map-export
node scripts/demo.mjs --out ../../work/scene-demo
```

compile/edit/export 可选择 --map default|inspection 或 --document FILE。edit 额外要求
--commands FILE。参数错误退出 2，执行或校验失败退出 1；结构化诊断不回显宿主绝对路径。
命令文件是上述命令组成的 JSON 数组，不执行脚本、不允许模型或提供商操作。

demo 以一次手势完成预设展开、擦除/绘制、放置预设、向右扩建和环境放置，得到
99→104 个地形格、4→6 个视觉实例；核验 undo/redo、save/open 与 export/replay，保存
初始/最终场景、作者地图、命令与 demo-report。实际证据见执行文档第 17 节。

本阶段所有结果保留 visualAcceptance=not-assessed。正常编辑、保存、重放均不生成
美术、不调用提供商；P3 浏览器交互和合成视差验证见 Studio 文档，真实接缝观感与美术
验收仍属于 P5。

# 仓库面板

Studio“仓库面板 → 物品仓库”现在与其他预设使用同一条AI规划链：填写需求、选择组件与唯一比例、准备不可变计划、确认一次模型调用、校验模型方案、程序编译和发布。默认5列×4行，行列各1–32、合计最多144格，比例和行列在生成前固定；不是仅允许12×12，32列×4行也有效。

需求支持4000字符，未提供物品数据时输出空仓库 items:[]；只有明确请求示例物品时才设计样例。AI输出标题、物品名称、数量、格位与初始选择，程序保留这些内容，不回填旧8件样例。容量可为1或空仓库，不再要求至少8格。未指定格位时提示模型逐行连续排列、空位留后；显式格位按方案保留。

## 规划与转换

复用上游inventory-row、context0.12 / intent0.13合同。直接消费原生意图，继续使用Chain的PixiUI/Layout与所选皮肤，不复制规划引擎、不修改上游未提交工作。其他预设继续使用原目录与既有协议。

程序按所选方向、行列及真实皮肤计算并冻结物理 grid，模型须原样输出。目前接通方格、相等横纵间距、零 grid padding、左上起点、逐行排列。新计划以planning/capabilities 1.5及layout 1.6冻结`cellSize`、`surfaceLayer:inset`、`frameScale:3`、`slotFit:"visible-square-v1"`、`viewportFit:"whole-slots-v1"`、`slotAssets:"dedicated-square-v1"`与`scrollMode:"fixed-cells-both-v1"`，转换标记仍为`surfaceRecipesVersion:3`。

新布局只有一个放大角部的主框：主框节点使用 `surfaceLayer:frame`、`surfaceScale:3`，对应四边安全区同步放大；库存格区与详情使用从真实 PNG 安全中心取得的弱 inset 底板，不重复主框金角。主标题使用 `surfaceBand:reference-v1` 与节点级 `surfaceFontSize`，保留端部纹饰比例、延展中间区域；不修改皮肤密度、源图或 S05 平铺尺度。常见 16 像素正文皮肤的主标题为 28，盒高至少 64；用户明确编辑的 `props.fontSize` 优先。

当前主标题明确 `titleAlign:center`，左右装饰安全区对称后将文字居中。`slotFit` 仅为库存派生显示：正常/选中图使用同一非零 alpha 并集，去除完全透明的外边并同步扣减九宫格边距，保留全部可见和柔边像素，原 PNG、摘要及通用 List 角色不变。无法安全裁边时保留原显示与诊断，不阻断用户任务，也不冒称可见本体已归一。`viewportFit` 在预留内部滚动条后显示完整行列，编译与运行时共用容量计算；不以缩小格子解决空间不足。

`slotAssets`仅对新布局启用：新皮肤两态`skin.slot.normal/selected`俱全时使用S04专用正方形素材，等比显示整张边框，不再叠加旧的矩形边框与程序勾选标记；内容、数量与交互仍由运行时绘制。两态均缺失的旧包沿用横向item底图及上述适配，只有一态则明确拒绝。普通List和旧layout 1.5不切换素材。来源和模板位置见[正方形仓库格子](slot-assets.md)。

单个 inventory 的 sectionTitle/label 默认作为结构包装保留在导出内容，不再重复为同级可见标题。用户明确要求“分组标题／分区标题／区域标题／小标题／格位标题”且没有相邻否定时，保留可见分组名；普通“显示仓库物品”不触发。消费者也可显式设置 `inventoryShowGroupHeading`，不新增模型字段、不改物品或计划。旧 layout 1.3 继续展示原有独立标题。

格子安全区包含实际边框，固定尺寸按 8 逻辑像素向上取整。空间不足时横纵独立滚动，不缩小格子、文字或切片；使用已有皮肤轨道与滑块显示必要的滚动方向。准备阶段检查每轴 1–32、总格数≤144 及自然网格宽高≤4000 逻辑像素；超预算在模型调用前拒绝，不截断物品或改变行列。附加控件及无法映射的几何、资产、业务语义明确拒绝。

| 冻结 planning / layout | 保留的消费行为 |
| --- | --- |
| 1.0 / 1.1 | 原宽度 fit／纵向滚动，不添加 scrollMode 或新底板 |
| 1.1 / 1.2 | 固定格双向滚动与原 Graphics 外观 |
| 1.2 / 1.3 | 固定格双向滚动、content 底板与原有可见标题；不放大主框 |
| 1.3 / 1.4 | 单主框、弱 inset 与原参考图标题层级；保留原透明外边与部分行列视口 |
| 1.4 / 1.5 | 主标题居中、库存可见本体适配与完整行列视口；原始素材不变 |
| 1.5 / 1.6 | 显式优先S04专用正方形两态素材，缺失两态的旧包继续适配item底图 |

旧文档、原始转换标记和消费者快照共同决定重放；不会仅因当前默认版本变化而升级旧任务、原交付或编辑副本。

当前没有物品图集输入，模型item.icon须为null，格内显示名称和数量，详情显示完整名称、数量、格位；不以旧程序示例图标替代资产。上游物品合同无description，转换不编造说明。标题、分组标题、库存标签与初始空槽选择按合同保留，是否重复显示包装标题由上述版本化策略决定。多格占用、拖换、堆叠、装备、消耗、存档仍不支持。

继续支持画布尺寸、名称、字号颜色、撤销重做、保存副本及普通预览。显式文字颜色优先，皮肤安全区与真实字体继续校验；试玩不改变作者数据。

## 维护入口

- `src/panel/inventory-model-request.mjs`：Studio预设描述、默认行列、完整需求与默认起点。
- `configs/inventory-planning.json`、`src/panel/inventory-intent.mjs`：专用目录快照、消费合同、程序grid、字段映射与明确拒绝。
- `configs/planning-compatibility.json`、`src/panel/planning-client.mjs`：精确协议配对与planning/v1公开边界。
- `prompts/inventory-planner.md`：AI职责、明确用户事实、固定比例/行列与不支持能力。
- `src/panel/action-model.mjs`、`scripts/action-model.mjs`：共用不可变计划、授权摘要、独占dispatch、原始response/receipt及确定性转换生产者。
- `scripts/action-preview.mjs`：按原始响应、receipt、转换文件摘要和重新编译结果核验来源，仅产所选方向。
- `src/runtime/inventory-{policy,geometry,adapter}.mjs`：库存合同、方格尺寸、安全区、文字和选择行为。
- `src/studio/{panel-presets,pipeline,pipeline-ui}.mjs`：新建走模型确认，澄清保留原方向、行列、皮肤及历史。

离线测试使用真实生产者与替身transport，不手写成功receipt；真实模型调用数单独标明。实现、验收和本地接入见执行文档12.139。

## 历史程序预设

12.136–12.138的确定性路径保留给已准备的旧计划和离线CLI，不再用于Studio新建仓库。维护位置仍为inventory-panel.json、inventory-preset、inventory-plan和inventory-preview。旧1.0固定10×10、旧1.1默认20格及此前的稀疏格位均不改写。历史CLI仍默认config1.1及原1–10限额；只有显式config1.2与版本化scrollMode启用新固定格行为。

旧prepared任务按deterministic-inventory builder和冻结摘要执行，新任务标为model-inventory并确认一次模型调用。不把旧结果改标为AI结果，不自动迁移原始preview、包绑定、副本或草稿。

历史CLI仍只写work，支持成对--columns/--rows、--config及可选--config-sha256；兼容执行对同次读取的字节核摘要后再解析。新AI结果使用通用action-model/action-preview来源链。规划API与专用目录通过统一SDK入口读取，正式发布锁定与协议兼容见规划接入文档。

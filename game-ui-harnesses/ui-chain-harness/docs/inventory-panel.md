# 仓库面板

Studio“仓库面板 → 物品仓库”现在与其他预设使用同一条AI规划链：填写需求、选择组件与唯一比例、准备不可变计划、确认一次模型调用、校验模型方案、程序编译和发布。默认5列×4行，行列各1–32、合计最多144格，比例和行列在生成前固定；不是仅允许12×12，32列×4行也有效。

需求支持4000字符，未提供物品数据时输出空仓库 items:[]；只有明确请求示例物品时才设计样例。AI输出标题、物品名称、数量、格位与初始选择，程序保留这些内容，不回填旧8件样例。容量可为1或空仓库，不再要求至少8格。未指定格位时提示模型逐行连续排列、空位留后；显式格位按方案保留。

## 规划与转换

复用上游inventory-row、context0.12 / intent0.13合同。直接消费原生意图，继续使用Chain的PixiUI/Layout与所选皮肤，不复制规划引擎、不修改上游未提交工作。其他预设继续使用原目录与既有协议。

程序按所选方向、行列及真实皮肤计算并冻结物理grid，模型须原样输出。目前接通方格、相等横纵间距、零grid padding、左上起点、逐行排列。新计划以planning/capabilities1.2及layout1.3冻结cellSize、content底板与scrollMode:"fixed-cells-both-v1"，新标题和分组标题接已有title/section表面配方；库存格区和详情使用真实PNG底板，新格子安全区包含实际边框，固定尺寸按8逻辑像素向上取整。空间不足时横纵独立滚动，不缩小格子、文字或切片。准备阶段检查每轴1–32、总格数≤144及自然网格宽高≤4000逻辑像素；超预算在模型调用前拒绝，不截断物品或改变行列。旧planning1.0/layout1.1与无scrollMode文档保留原宽度fit/纵向滚动行为；planning1.1/layout1.2保留此前固定格双向滚动与原Graphics外观，不自动换底板。附加控件及无法映射的几何、资产、业务语义明确拒绝。

当前没有物品图集输入，模型item.icon须为null，格内显示名称和数量，详情显示完整名称、数量、格位；不以旧程序示例图标替代资产。上游物品合同无description，转换不编造说明。标题、分组标题、库存标签与初始空槽选择按合同保留。多格占用、拖换、堆叠、装备、消耗、存档仍不支持。

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

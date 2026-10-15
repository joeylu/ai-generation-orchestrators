# 组件合同维护说明

本工具检查和派生**设计合同**，不创建 PixiUI 组件、不处理真实皮肤 PNG，也不验证 PanelDocument 树。独立的 [组件候选运行时](component-runtime.md) 已实现全部 16 类的首轮夹具交互验证；合同工具不导入其结果，不把断言子集误算成完整验收。三段 Harness 尚不可端到端调用。

## 三个维护源

| 文件 | 维护内容 | 不放在这里的内容 |
| --- | --- | --- |
| [skin-template-set.draft.json](../configs/skin-template-set.draft.json) | 模板板、候选部件、几何、资产 ID、使用方 | 组件行为、真实资产接受记录 |
| [component-registry.draft.json](../configs/component-registry.draft.json) | 配方、属性及 default、规则、计划适配器、状态/事件、角色/几何/文字需求、槽、组合引用、用例规格 | 具体文件路径、运行时通过状态、皮肤尺寸的副本 |
| [skin-usage.draft.json](../configs/skin-usage.draft.json) | 某套候选皮肤的角色→资产映射、使用元数据、文字/状态样式、控制几何、间距 token | 模板部件尺寸、图片 manifest、真实字体资源、手填成功标记 |

新增已有能力的部件或板仍只改模板。新增已有类型的配方/变体改注册源；只有引入新角色或新增使用方时才同时修改相关映射。真正新交互需要工程适配及独立测试，不能靠加 JSON 自动获得实现。三类源各有自己的内容 revision；Schema version 变化需要显式迁移，不忽略未知版本。

## 命令

在 ui-chain-harness 目录执行：

```sh
npm run contracts:validate
npm run contracts:build
npm run contracts:status
```

validate/status 只读，不启动浏览器或模型。build 生成文本/JSON，不生成美术或接受记录。参数支持 `--registry`、`--usage`、`--template`、`--out`；默认路径来自工具自身目录，不依赖 shell 的当前目录。

`npm run contracts:validate -- --require-ready` 会返回 not-ready 和非零退出码。当前源严格标记 template-candidates；即便把所有 null 填满，也缺真实资源闭包与运行时验收，不能因此变成可交付包。普通 validate 返回 valid-draft，附带可定位的 blockers。真正的生产包合同留待相应阶段实现，不能拿这个开关替代生产验证器。

## 配方与属性

引用写作 `recipeId@recipeVersion`，例如 `button@1.0.0`。同一类型可有多个独立 recipeId；每个引用必须唯一。adapterId/library 是声明入口，不是实现或验收证明。生成目录使用 implementation=not-evaluated，runtimeAvailableTypes 为空只表示本工具不授予运行时能力；实际候选适配和断言证据查 components:status，不在合同源手填成功。

属性用受限 Draft 7 JSON Schema 描述，支持基础类型、枚举、范围、pattern、array/items、关闭未知字段的 object/properties/required。default 只写在字段定义内，生成目录里的 defaults 不手改。公共 visible 从 commonProps 合入，配方不得覆盖。字段不接收脚本、远程 `$ref` 或函数。

`validateProps(registry, recipeRef, props, context)` 返回 `{props, issues, unresolved}`，在副本上补默认值，包括选项 enabled 等嵌套默认值；不会修改调用者对象。不允许隐式类型转换。缺必填属性、未知字段、非法默认值都报错。

语义规则在注册项的 rules 维护，kind 必须属于工具已实现集合：选择/唯一 ID、范围/量化、UTF-16 长度、配方/资源/文字样式引用。字段引用和类型也校验。新增规则种类需实现校验与故障测试。Slider 的量化容差为步数差 1e-9；精确 max 允许成为不可整除区间的端点，候选运行时已按此规则验证拖动与取消。浏览器运行时与 Node 工具共用 src/contracts/props.mjs，不各自复制默认值和属性校验。

props 检查无法代替节点树编译。可选 context 中的 resourceIds、textStyleIds、nodeIds 和 layoutTokens 用于解析相关引用；不提供时会返回 unresolved。节点所有权、递归实例化、自由区域权限、真实尺寸/字体和共享资源释放都未由本工具实现。

## 皮肤映射和元数据

skinRoles 引用逻辑 role；usage.bindings 将其映射到候选 assetId。角色名暂以 skin 前缀区分于资产 ID，但二者不靠同名隐式绑定。改映射后校验资产存在及对应 consumer；不把文件路径硬编码到配方。

required 表示单实例需要的视觉层；when 使用已声明枚举的 equals 或 notEquals，例如按钮变体和 scrollbar=hidden。合同构建检查整套组件配方的角色映射完整性，尚不输出某个面板的最小资源闭包。

模板版本/修订在 templateRef 显式确认；源内容 SHA-256 在构建时自动绑定。模板尺寸通过引用读取，不在 usage 重写。九宫格切片、内容边距、最小尺寸采用具名方向和逻辑像素；边距不得耗尽主体或最小盒子。null 是待确定值，不是 0，也不是自动估算成功。

controlGeometry 当前只声明基于 asset-body 的轴向行程：assetId、axis、start/end、crossOffset。完整 fillBox、滑块最小长度、标题/标签位置等适配所需细节仍记录在 metadataRequirements。程序皮肤的工程尺寸集中在 fixtures/neutral.skin.json，经 fixture-profile.schema.json 校验，由 runtime/geometry.mjs 推导组件最小尺寸；这套测试配置不覆盖正式源中的 null。N07 尚须收敛真实资产的完整消费 Schema，不能把测试几何声称为完整生产布局元数据。

三个结构标记的正式生产方式保留 undecided；测试夹具可以画出它们，但这不构成生产生成器或正式 procedural 接受记录。textStyles 仅是样式声明，fontRef 不意味着生产字体文件已就绪。夹具单独锁定 Noto Sans SC 测试字体；真实 PNG 的像素比例、trim、摘要、字体资源及接受记录将由独立生产合同处理。

## 派生产物与证据

[当前入口](../generated/component-contracts/current.json) 指向不覆盖的 builds/UUID。status 返回 catalog 相对路径，打开其所在版本中的：

| 产物 | 用途 |
| --- | --- |
| registry.source.json / usage.source.json / template.source.json | 原字节冻结源；不是新的维护入口 |
| catalog.md / catalog.json | 类型、配方、默认值、角色、待定项；无可调用能力声明 |
| props-schema.json | 属性 Schema 定义集合；未来编辑器/AI 消费的候选投影，尚未接线 |
| acceptance-plan.md / acceptance-plan.json | G01–G07、T01–T16 规格和逐配方分配；not-run 表示此投影未绑定完整用例证据，夹具子集执行结果在独立报告 |
| dependency-evidence.json | 本地已安装精确版本、lock integrity、声明探针文件及摘要；不是浏览器集成测试 |
| build-record.json | 三份源、工具和依赖证据、输出文件摘要 |

每个配方必须包含全部公共组和本类型专属用例。操作预期在注册源维护；实际测试代码必须独立实现断言。执行结果将由运行器生成，不能在源配置或派生 JSON 中填写 passed。

## 更新、故障与扩展

构建先写 .staging/UUID，完整校验后移入 builds，再原子更新 current.json。源或工具在构建期间改变、无效源、文件系统错误和互斥锁冲突不会切换当前入口。历史版本保留，不自动删除。status 区分 current/stale/invalid-source/corrupt/missing；即使忘记递增 revision，源字节改变也能检测为 stale。

同一个输出目录只允许一个构建者。.build.lock 不采用后台租约。异常退出后，先确认没有仍在运行的构建进程并检查 staging/current；再删除**该目录的 .build.lock 文件**后重新构建。不要删除 builds 历史来处理过期，不手改记录。Windows 短时占用只对本地重命名有限重试，不重复模型请求。

添加已有 Button 能力的变体：复制注册项，分配新 recipeId，修改属性 default/现有枚举内的初值；保持合法角色、适配器与本类型用例引用。运行 validate/build，目录与待执行矩阵自动扩展。新增属性或新的交互模式还需要实际适配器支持；静态数据通过不算行为实现。

`npm test` 包含合同与故障测试；`npm run test:render` 是模板 PNG 测试；`npm run components:check` 执行全部 16 类的当前断言子集并生成证据。执行文档继续记录实际完成阶段和剩余工作。

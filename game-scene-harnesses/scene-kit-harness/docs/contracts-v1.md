# Scene Kit 离线合同 v1

状态：核心作者合同 v1，当前源码版本 0.14.0。本文保留五份 v1 作者格式和只读校验；
编译/命令/导出见 [编辑内核](authoring-v1.md)，可视编辑见 [本地 Studio](studio-v1.md)。
生成计划/外部交换见 [生成编排](generation-v1.md)。内置提供商执行、物理与正式美术
接受仍未实现。完整路线由 [执行文档](execution-plan.md) 维护。

0.9.0 的 v2 作者地图为显式曲线扩展，见 [曲线合同](curves-v1.md)；本页原 v1 字段
继续关闭，不能向旧格式附加 curveTerrains。基础 kit/rules 与来源字节不因编辑升级改变。
0.11.0 的 terrainConnections 只属于显式 v3，见 [混合地形合同](mixed-terrain-v1.md)。

## 1. 格式与文件角色

包根入口固定为 `kit.json`。其引用路径均相对包根，而不是相对引用它的子目录文档。
不支持远程资源、绝对路径、穿越路径、链接、脚本或自动网络下载。

| 格式 | Schema | 作者数据 |
| --- | --- | --- |
| `ai_scene_kit_v1` | [kit](../schemas/kit.schema.json) | kitId/revision、profile、purpose、网格、像素密度、五份文件引用及摘要 |
| `ai_scene_kit_v2` | [kit-v2](../schemas/kit-v2.schema.json) | 显式连续材质、16 相位顺序及曲线材质依赖，限定为 art-candidate；[边界](candidate-kit-v2.md) |
| `ai_scene_module_catalog_v1` | [module-catalog](../schemas/module-catalog.schema.json) | 模块角色、PNG 路径/摘要/字节数、像素尺寸、占地、锚点、偏移与变换限制 |
| `ai_scene_terrain_rules_v1` | [terrain-rules](../schemas/terrain-rules.schema.json) | 规则版本、单地形家族、47 个签名及各自的变体列表 |
| `ai_scene_assembly_presets_v1` | [presets](../schemas/presets.schema.json) | 预设局部占地、地形连续段、局部实例与子预设引用 |
| `ai_scene_document_v1` | [scene-document](../schemas/scene-document.schema.json) | 地图边界、地形、图层、实例、预设实例、镜头与检查点 |

另有 [common](../schemas/common.schema.json) 定义共享字段。Schema 使用 JSON Schema
Draft 2020-12；本包的无依赖校验器只执行这些随包 Schema 所用的关键字，遇到新增而
未支持的 Schema 关键字直接报错，不是接受用户任意 Schema 的通用校验服务。

五种数据格式均严格拒绝未知字段及未知版本。新增格式须实现显式兼容，不忽略新字段。
`kitRef` 绑定 kitId/revision；地图另绑定 rulesId/revision。kit 通过 SHA-256 绑定实际
文档字节，目录再绑定每份 PNG 字节。地图不引用 kit 自身摘要，避免循环摘要依赖。

## 2. 网格、来源与模块

坐标 X 向右、Y 向下。边界、地形与预设位置以整数格表达；视觉实例与相机使用逻辑单位。
`pixelsPerUnit` 为 numerator/denominator；单格逻辑尺寸乘该比值须为整数源像素。
夹具采用 64×64 逻辑单位和 1:1 像素密度；校验器也通过了 32×32、2:1 的参数化案例。
这些值不锁定未来真实生图规格。

模块 kind 为 terrain/environment/strip。首版 allowedTransforms 仅允许 identity。
地形模块一格占地，visualOffset 为零；PNG 必须从 anchorPx 起覆盖完整单格像素核心，
允许画布另有留边。未来呈现位置约定为：实例位置 + visualOffset − anchorPx/像素密度。
这里校验几何声明，尚不证明图片实际画对了轮廓或接触面。

environment 必须有非完全不透明像素，并且主体不为空；strip 记录 repeatAxis=x，
其他角色为 none。P1 不进行纹理首尾相似度、条带覆盖、视觉接缝或正确分割的判定。

当前 PNG 接收范围为非隔行 8-bit RGB/RGBA、单边最多 4096，检查签名、块顺序、CRC、
受限解压、扫描行过滤、真实尺寸及零 Alpha RGB 清零。仅允许基础图像块和文本附加块；
其他颜色类型、透明扩展和色彩元数据明确拒绝，后续须按新接收合同扩展，不能悄悄丢弃。
校验器不重编码或修图，不凭环境图存在 Alpha 就宣布视觉接受。

## 3. 地形、预设与地图语义

profile 固定为 `sideview-solid-blob47-v1`。八邻域位序及对角归一化见执行文档第 15.1 节。
每个有效签名恰有一条规则，变体至少一个、均引用 terrain 模块；同一模块不能冒充
多个不同签名，目录中的 terrain 模块也不能没有规则归属。

首版一个地形家族，不支持家族间过渡。地图地形只保存 `terrainRuns`：每段 x/y/length
是格坐标和正整数长度。重叠、越界与未知家族均拒绝，不能在运行时用后写覆盖前写。
地形图片实例是 P2 的编译结果，不允许以额外字段写回作者地图。

预设保存局部地形、局部视觉实例和子预设的 column/row。全部预设都检查，未使用的
循环引用也拒绝；展开后的地形必须位于父级占地内且不重叠。子预设继承放置实例的
非地形图层，地形归地图唯一的 terrain 层。首版不提供预设内部多图层映射。

地图必须恰有一个 terrain 层，其视差为 (1,1)；视觉实例不能引用该层，也不能手摆
terrain 图片来绕开地形数据。图层 ID/zIndex、同作用域实例 ID 必须唯一。
环境对象允许视觉轮廓超出边界，但作者锚点须在范围内；预设完整占地须在范围内。
相机中心须在世界范围内，覆盖、缩放与滚动效果要留待实际呈现检查。

包必须引用不同的默认/检查地图文件和地图 ID。检查地图提供 47 个独立中心检查格，
每个期待签名均从展开后的真实邻域重新计算；复用中心、伪造标签或缺少角色均拒绝。

## 4. API、命令与状态

`src/index.mjs` 导出 `validateDocument(format, value)`、`validateBundle(root)`、
`normalizeSignature(mask)`、`signatureAt(cells,x,y)`、`SIGNATURES` 和 `PROFILE`。
前者返回 Schema 错误数组；完整包校验返回结构化结果；signatureAt 对空中心返回 null。

```powershell
# 从本 Harness 目录执行，均不提交生成请求：
node scripts/validate.mjs --root tests/fixtures/synthetic
node scripts/build-fixtures.mjs --check
node --test tests/*.test.mjs
```

validate 输出 contract-valid/contract-invalid、检查范围和错误 artifact/path/code。
成功报告保留 `visualAcceptance: not-assessed`；不是正式生成交付 manifest。
不会输出选中包根的绝对路径，也不会把底层文件系统异常栈暴露为公开诊断。

JSON 文档上限 2 MiB，单 PNG 16 MiB，累计源图 128 MiB、声明像素 67,108,864；
每张展开地图/预设最多 100,000 个占用格，单次分析展开工作量最多 1,000,000，预设深度最多 32。
其他字符串、实例与数组上限由 Schema 声明。超限即拒绝，不截断后报告成功。

P1 validate 只展开必要作者数据验证引用、占用与检查样例，不写文件，也不派发计算。
P2 新增独立编译、命令编辑、保存打开和目录导出 API，不改变 validate 的只读行为。
`contract-valid` 仍不能推导为已完成可视呈现、画布编辑、生图或美术接受。

## 5. 合成包与证据

[合成包入口](../tests/fixtures/synthetic/kit.json) 及其摘要由确定性夹具生产器写入。
55 个文件包含 49 个 PNG 和 6 份 JSON：47 个地形角色、两个视觉标记、两个预设、
一张 64×9 格默认地图和一张 40×30 格检查地图。

默认地图展开有 99 个地形格、4 个视觉实例；检查地图有 235 个地形格、47 个检查点。
图片是工程标记，不代表实际模块美术、自然接边或用户接受。
夹具使用 Node zlib 编码；字节重放与记录摘要绑定实际生产器及其工具链，升级工具链
若出现字节差异必须审查，不能篡改既有生成记录来消除差异。

离线测试、标准校验和环境跳过项见执行文档第 14、16、17 节。公开美术生产发布、
P4 已提供风格/结构/能力合同与参考图/模块离线交换；内置图片执行适配器和真实消费项目
验收仍留在后续阶段。本地画布与原作者合同保持独立。

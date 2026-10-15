# 模板字段与维护方法

这是已实现的离线模板工具说明。产品方向与未定事项仍以 [执行文档](execution-plan.md) 为准；这里不另立执行方案。

## 唯一编辑源

[skin-template-set.draft.json](../configs/skin-template-set.draft.json) 是活动模板源，[Schema](../schemas/skin-template-set.schema.json) 提供编辑器提示。Schema 使用 Draft 7，由锁定版本的 Ajv 校验；不请求远程 `$schema` 地址。文件保存为 UTF-8。

每个部件只在 `sheets[].parts[]` 中定义一次；对照表、计数、模型部件名单和几何坐标从它派生。`consumerTypes` 是声明的使用方名称，`stateGroups` 是状态关系，二者引用稳定 ID，不复制部件定义。它们不代表对应组件已实现。

| 字段 | 含义与约束 |
| --- | --- |
| `kind` / `version` | 当前固定为 `ui_skin_template_set_draft` / `0.2`；这是字段合同版本 |
| `revision` | 内容修订，正整数；有意改变模板内容时递增。实际来源身份始终包含 SHA-256，未递增修订也会被识别为内容变化 |
| `status` | 固定 `discussion-draft`；校验成功不等于皮肤可生产或视觉通过 |
| `purpose` | 模板用途说明 |
| `coordinates` | 原点左上、逻辑像素。宽高必须相同，范围 128–4096；`outputScale` 为 1–4 整数，最终每边不超过 4096 像素。槽位、主体、字号、圆角随渲染分辨率统一映射 |
| `constraints.minimumOuterMargin` | 每个槽位到板边的最小距离；必须至少为核对字号 + 4，以容纳页眉 |
| `constraints.minimumSlotGap` | 槽位之间的最小分隔；至少有一个轴达到该距离，不能重叠 |
| `constraints.minimumBodyPadding` | 主体到槽位四边的最小留白；必须至少为核对字号 + 4，以容纳说明 |
| `constraints.cleanContainsText` / `functionalIcons` | 当前均固定为 false；无标注图不含说明文字，范围不含功能图标 |
| `palette` | `#RRGGBB` 颜色键；可增添自定义填充色。stroke 和 review 系列是绘图器需要的保留角色 |
| `reviewFont.family` / `size` | 核对图的本机字体回退序列和逻辑字号；不下载字体。字号用于页眉、编号与尺寸，过长标签在槽位宽度内等比缩小 |
| `consumerTypes` | 本模板可以引用的使用方 ID 列表；新增声明不会自动实现新组件 |
| `stateGroups[].id` / `assetIds` | 需要对齐的状态组。至少两个不同资产，同组 state 不重复；尺寸、相对槽位偏移、原语、伸缩和边距须一致。删除成员而保留引用会报错 |
| `sheets[].id` | 板 ID，全局唯一 |
| `sheets[].filePrefix` | PNG 文件名前缀，全局唯一；格式为 `s数字-小写名称`，例如 `s05-extra`，不含目录路径 |
| `sheets[].title` | 核对图和对照页显示的板名 |

| 部件字段 | 含义与约束 |
| --- | --- |
| `code` | 人工核对编号，全局唯一，例如 E01；不依赖文字识别绑定资产 |
| `assetId` | 稳定资产 ID，全局唯一，例如 `surface.extra`；消费者和状态组用它引用 |
| `label` | 人工可读名称；不是要生成到皮肤上的文字 |
| `consumers` | 引用 `consumerTypes` 中的名称；仅表明使用关系，不是完整配方 |
| `state` | 状态名称，例如 normal、pressed；新状态可用新名称，但其交互和派生行为须另行实现 |
| `slotRect` | `[x,y,width,height]`，全板绝对逻辑坐标；主体和未来允许的光效所属区域 |
| `bodyRect` | 同样为绝对坐标，表示基础轮廓。宽高正整数；四周必须留在槽位内 |
| `primitive` | `roundRect` 加 radius、`circle`、`ring`、`polygon` 加 points。圆/环必须等宽高，圆角不超过短边一半 |
| `primitive.points` | polygon 的主体局部坐标 `[x,y]`；至少三个不同点、面积非零，点不得越出主体。当前仅填充，不支持描边；作者仍需目视检查复杂路径 |
| `paint` | 引用 palette 中的填充色键；ring 将该色用作环的描边 |
| `strokeWidth` | 逻辑描边宽，朝轮廓内侧。小于主体短边一半；ring 必须大于零，polygon 必须为零 |
| `stretch` | nine-slice / horizontal / vertical / uniform；当前是使用建议，不是已验证的生产能力 |
| `productionPolicy` | raster-candidate 或 raster-or-procedural-undecided；后者在核对图标为待定，不会被自动排除或宣布通过 |
| `contentInsets` / `sliceInsets` | null 表示待定；非空为 `[top,right,bottom,left]`，必须保留正内部宽高。它们不改变中性模板轮廓，实际皮肤使用仍须另行验收 |

当前安全上限为每份配置 64 张板、每板 256 个部件；不是业务目标数量。新增原语等行为需要同时修改合同、绘图器与针对性验证；未知字段/类型会报错，不会被静默忽略。

## 新增部件与模板板

1. 在现有空槽位或新板的 `parts` 增加部件；选择已支持的原语，设置唯一 code/assetId，填写使用方、主体与槽位。位置不会自动打包，板间不需要相同部件数量。
2. 新板只需新的 id、filePrefix、title、parts；不编辑脚本里的板名单。
3. 如果是某个控件的配对状态，把资产 ID 加入相应 `stateGroups`。若是独立部件，不必建立状态组。添加新的使用方时才扩充 `consumerTypes`。
4. 递增 revision，执行 `npm run templates:validate`，再执行 `npm run templates:build -- --browser chrome`。
5. 检查构建返回的 `overview`，查看两版图、部件目录和待定项。删除部件/板也走同一流程，悬空状态引用会明确阻断。

删除资产会检查本模板的状态关系；再执行 `npm run contracts:validate` 可检查组件注册与皮肤映射引用。面板实例依赖尚未接入，当前不承诺全链路影响分析。合同维护入口见 [说明](contract-fields.md)。

## 命令与输出

在本目录根部安装锁定依赖：`npm ci --ignore-scripts --no-audit --no-fund`。需要已安装的 Chrome、Edge 或 Playwright Chromium，工具不安装或下载浏览器。

```sh
npm run templates:validate
npm run templates:build -- --browser chrome
npm run templates:status
```

也支持 `--config 路径` 和 `--out 路径`；显式相对路径从命令当前工作目录解析。默认输入/输出相对工具目录固定，不依赖启动位置。输出必须与源配置分开；validate 和 status 不写文件、不启动浏览器。

```text
previews/skin-templates/
  current.json                 唯一当前入口，成功后整体切换
  builds/<buildId>/
    source.json                此次源文件的逐字节快照
    catalog.json               身份、统计、使用方索引、逻辑坐标与图片引用
    model-projection.json      模型几何输入候选，仅离线数据
    overview.md                自动生成的分板尺寸表、编号图与使用方索引
    *.clean.png                透明、无说明文字的标准图
    *.review.png               相同部件坐标的编号核对图
    build-record.json          程序记录输入/工具/输出摘要与实际运行证据
  .staging/<buildId>/           失败或尚未完成的候选，不是当前产物
```

读取当前内容时先执行 status，再按 current.json 的 buildId 读取 `builds/<buildId>/`；不要扫描 builds 下全部 PNG 当作当前资产。旧版本保留以便追溯，因此删板后仍可在历史目录看到旧图。源快照保留原始 `$schema` 字符串，但当前工具使用自身固定 Schema 校验；不要把快照作为新的编辑入口。

`catalog.json` 保存逻辑坐标，实际像素裁切位置需要乘 `outputScale`。目前没有实现真实模型结果切分、九宫格皮肤交付或模型请求编译；model-projection.json 不包含生成授权，也不是直接可调用的 provider 请求。

| status 结果 | 含义 |
| --- | --- |
| current | 当前产物摘要有效，源配置和工具摘要一致 |
| stale | 上一份产物完整，但源配置或工具已改变；返回旧 buildId 及变化来源 |
| invalid-source | 上一份产物完整，但源配置无效；返回具体错误字段 |
| corrupt | 当前入口、文件结构或摘要损坏；不可视为可用输出 |
| missing | 尚无当前入口 |

除 current 外，status 退出码均为 1。validate 的 valid-draft 只代表模板合同有效，build 的 built 只代表离线派生产物完整。

构建先校验源、写入候选、完成所有渲染与像素检查，再写构建记录并重命名到独立版本目录，最后以同卷重命名替换 current.json。失败不会改写旧版本。记录覆盖工具源码、Schema、manifest、lockfile 摘要与运行时版本；核对字体由本机提供，跨机器的 review PNG 字节不保证一致。进程中断恢复与断电后的文件系统持久性不是同一保证，本工具未提供断电事务或存储修复。

一个输出目录同一时间只允许一个构建，以 `.build.lock` 实现本地文件互斥。异常终止可能留下该文件；确认没有构建进程后，只删除该输出目录的 `.build.lock` 再重建。不要手改 current.json 或 build-record.json 来“修复成功”。失败候选不自动删除；历史清理和增量重建尚未实现，当前每次重建整套确定性模板。

## 验证与版本迁移

```powershell
npm test
$env:UI_CHAIN_TEST_BROWSER = 'chrome'
npm run test:render
```

默认浏览器测试选择 Playwright Chromium；环境变量只允许换到已安装 Chrome/Edge。测试使用临时配置与程序图形，在仓库忽略的 `.tmp/ui-chain-tests/` 下保留证据；不连接模型或私有服务。故障测试明确使用替身，正式 CLI 无替身开关。浏览器渲染使用软件 WebGL。

从旧 0.1 草案到 0.2 的本次转换已显式完成：保留原几何/身份，增加本地 `$schema`、revision、声明的 consumerTypes 和成对状态 stateGroups。旧 JSON 和旧脚本已保存到 [历史源目录](../archive/v0.7-template-source/README.md)。其他 0.1 文件应先复制到新的创作配置，补齐上述字段并校验；目前不支持静默迁移或通用迁移 CLI，旧接受资产也不会被自动修改。

# PanelSpec 0.2：把资源接到面板

0.2 在原有设置面板结构上增加显式资源选择。当前支持面板九宫格背景和静态行图标，
编译后仍使用现有 UI Component 工作台的 Image、Slider 和 Switch；没有 MUIP 运行时依赖。
0.1 的合同及生成方式保持不变，不允许携带 `assets`。

## 精确选材

在 0.2 Spec 中，`assets` 必须完整包含以下三项：

```json
{
  "library": {
    "id": "modern-mint-assets",
    "sha256": "c6078f0763c270b31784ad487b8c59bd682e13126a0384ffaa20bf4112a39ee7"
  },
  "panelSurface": "game-ui/panel-surface@1.0.0",
  "rowIcons": [
    { "rowId": "audio-enabled-row", "asset": "game-ui/mute@1.0.0" }
  ]
}
```

上述摘要来自当前示例库，不能用作任意资源库的摘要。`library.id` 与 `sha256` 必须匹配所传
通用库 `asset-library.json`；资源身份必须是精确的 `namespace/id@major.minor.patch`。
编译器不选择最新版，也不在库或资源不匹配时替换素材。增量导入生成新库后，须显式更新
Spec 中的库 ID/摘要；只有主动选用新资源版本时才改变相应完整键。

`panelSurface` 可以是 `null`，否则必须选择带有效 `slice` 的 `shape` 或 `layout-primitive`。
`rowIcons` 为 0–128 项，每项绑定一个已存在且不重复的稳定 `rowId`，资源角色必须是 `icon`。
至少选择一个背景或一个行图标。格式见 [0.2 schema](../schemas/panel-spec-v0.2.schema.json)。

## 检索、编译与预览

在本 Harness 目录运行。以下基库是迁移精选资源后追加自有素材的示例；准备方法见
[通用资源导入](asset-import.md)。Sharp 无法直接解析时，在资源命令和首次编译后追加
`--sharp-module <已安装的模块目录>`，程序不会安装依赖。

```sh
node scripts/assets.mjs verify --library output/generic-library-migrated-v1
node scripts/assets.mjs search --library output/generic-library-migrated-v1 --query 静音
node scripts/assets.mjs search --library output/generic-library-migrated-v1 --query 面板 --role shape
node scripts/assets.mjs resolve --library output/generic-library-migrated-v1 --key game-ui/mute@1.0.0
node scripts/cli.mjs compile examples/audio-settings-assets.panel.json --catalog examples/modern-mint-light.catalog.json --assets output/generic-library-migrated-v1 --output output/audio-settings-assets-final
node scripts/cli.mjs inspect output/audio-settings-assets-final/panel.bundle.json
```

输出目录必须尚不存在；重复运行请换新的目录。示例提供音量与静音开关：静音的初值为 true，
仅是验收夹具，音量状态独立保留。`component.bundle.json` 可直接导入已经启动的 Pixi 工作台。
浏览器验收客户端只连接现有工作台构建，不启动新源码服务器；执行命令示例：

```sh
node scripts/check-browser.mjs --bundle output/audio-settings-assets-final/panel.bundle.json --url http://127.0.0.1:4173/ --output test-results/my-assets-panel
```

端口应指向实际已运行的工作台。编译成功不等于浏览器或人工视觉验收通过，实际结果另见
[任务证据](tasks.md)。
当前示例已完成 13 项浏览器检查，包含 3 张内嵌 PNG 与 11 个 Image 节点，并完成独立的离线 CLI 恢复。
临时验收预览进程已关闭；这些结果不表示人工视觉确认或原生引擎验收。

## 图片怎样进入组件包

首次编译通过 Sharp 适配器复验完整资源库，再解析精确引用。最终 PanelBundle 0.2 保存
`assetClosure`，只记录本面板实际选择的身份、角色、尺寸、切片与摘要；对应 PNG 内嵌在
组件包中，按内容去重。所选 PNG 文件总字节限制为 **1 MiB**，这不是 JSON/Base64 封装后的包体积限制。
未选素材、SVG 源文件和完整资源库不随面板打包。

背景根据源九宫格拆成最多 9 个带 `region` 的 Image，零面积边带会跳过；角部保留边距尺寸，
边带和中心拉伸。这使用普通 Image 裁片，并未新增原生九宫格组件。目标面板必须大于固定切片边距。
行图标放入 28×28 槽位，以 `contain` 保持比例，底部使用主题强调色徽章；布局不足时编译失败。
图片像素本身不染色，图标也不随开关状态变化。图标表达设置用途，不代替控件交互或业务状态。

`inspect` 和 `restore` 从包内 PNG 恢复资源，检查摘要与记录并重新编译，不读取原资源目录，
也不需要 Sharp。例如该资源面板的状态文件应包含 `volume` 与 `muted`，然后执行：

```sh
node scripts/cli.mjs restore output/audio-settings-assets-final/panel.bundle.json --state my-audio-state.json --output output/audio-settings-assets-restored
```

## Agent 规划与局部修改

`intake --assets <资源库目录>` 会验证通用库并把有限资源候选写入 context 0.2；可用
`--asset-style` 精确过滤风格。Agent 使用 proposal 0.2，从对应槽位候选填写 PanelSpec 0.2
中的库引用和精确 key，并分别提供 `assets`、所选 `asset:surface`、每个 `asset:row:<rowId>` 的依据。
完整入口和示例见 [资源检索规划](asset-planning.md)。

`check-plan` 只检查内嵌候选依据及选择约束，报告标记 `REQUIRES_BUILD_VERIFICATION`。
`build-plan` 完整验证实际库，并重新检索、比较整个候选快照后编译；另附程序生成的
`asset-build-verification.json`。原规划报告保留其离线检查范围，不代表语义或视觉确认。
未传 `--assets` 的旧 context 0.1/proposal 0.1 流程仍支持手动填写 PanelSpec 0.2 和整体
`assets` 决策；它没有新增候选约束，编译时仍须提供匹配的资源库。

```sh
node scripts/cli.mjs build-plan output/my-request/planning-context.json --proposal output/my-request/proposal.json --assets output/generic-library-migrated-v1 --output output/my-assets-plan
node scripts/cli.mjs patch output/my-assets-plan/panel.spec.json --patch output/my-patch.json --catalog examples/modern-mint-light.catalog.json --assets output/generic-library-migrated-v1 --output output/my-assets-plan-edited
```

这两条命令同样接受 `--sharp-module`。规划上下文须使用与提案主题相符的目录；例如在 `intake`
时传入 `--catalog examples/modern-mint-light.catalog.json`，`build-plan` 使用该上下文的目录快照。

`remove-row` 同时移除该行的图标引用。若这导致 0.2 不再有任何资源选择，整批补丁会失败；
须显式重写 Spec，选择其他资源，或改用不带 `assets` 的 0.1。补丁尚不支持直接修改资源选择。
动态图片、图片染色、任意控件皮肤及 Cocos/Godot/UE 原生导出仍未实现。
静态 PNG 和面板切片可经 [Unity UGUI 适配器](unity-export.md) 进入 Prefab/unitypackage。

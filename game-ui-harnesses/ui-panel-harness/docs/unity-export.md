# Unity UGUI 导出适配器 0.1.2

同一份已经验证的 PanelBundle 可导出 Unity 导入工具包，保留原来的 PanelSpec 0.1–0.5、
稳定 ID、当前值与创作初值。Unity 编辑器用自己的 API 创建真实 UGUI 层级和 Prefab，
再按需生成 `.unitypackage`。其他引擎仍需各自适配器；这不是将 Pixi 的画布截图放进 Unity。

0.1.2 新增只读确定进度条：原生 Image.Type.Filled 和静默 SetProgress，见 [加载条合同](panel-progress.md)。
共享 Runtime 能读取 0.1.0 / 0.1.1 Prefab 文档；既有 managed identity 的跨 Runtime 版本迁移尚未实现，
安装预检仍拒绝不同共享脚本版本/摘要混装，不会静默覆盖旧项目。

## 两阶段输出

工作台中先打开或生成面板，再点击“下载 Unity 工具包”，得到 `<面板ID>.unity-kit.zip`。
它在浏览器内验证、打包和下载，不需要导出服务；静态 file 页面离线可用。
ZIP 使用固定时间戳、不压缩，最多 64 MiB，解压后的内容与 CLI 工具包相同。
生成文件的逻辑由两种入口共用，C# 源码与 `.meta` GUID 保持一致。

点击开始后暂时锁定预览和修改，捕获本次试玩状态；导出不会更改面板、规划上下文或撤销历史。
初值与当前值分别保留，无法精确表达的 Slider 明确拒绝，原面板继续可用。

从本 Harness 运行：

```sh
node scripts/cli.mjs export-unity output/my-settings/panel.bundle.json --output output/my-unity-kit
```

命令不启动 Unity、不安装依赖、不调用模型。它先重编译并完整验证源包，再生成新目录：

- `panel.unity.json`：Unity 目标数据，包含扁平节点、坐标、业务字段、控件绑定及图片摘要。
- `panel.bundle.json`：保留原始通用包，未将其中的 Pixi 能力或验证字段改写为 Unity 已通过。
- `unity-runtime.json`：共享脚本版本与精确源码指纹，Unity 写入前会复验。
- `textures/`：只解出该面板实际引用、已验证的 PNG。
- `Assets/PanelHarness/`：独立 Runtime 和 Editor C#；稳定脚本 GUID。
- `export-manifest.json`：文件字节数和 SHA-256，Unity 验证状态仍为 `NOT_RUN`。

工作台也可继续导出通用 PanelBundle，用于重新打开或其他适配器。
导入工具包本身不等于已生成 Prefab。具体某个包的 Unity 验收记录另存，见 [任务证据](tasks.md)。

## 在 Unity 中创建 Prefab

已验证环境是 Unity 6000.3.7f1、UGUI 2.0；其他 Unity 版本需另外验收。
将工具包内的 `Assets/PanelHarness` 复制进项目一次，
保留 `.meta`。不要同时复制多个版本的同一适配器或覆盖自己已经修改的脚本。
导入源 `panel.unity.json`、`unity-runtime.json` 与相邻 `textures/` 保持在一起，可以位于项目外。

在自有 Editor 集成代码中调用：

```csharp
using GameUi.PanelHarness.Editor;
using UnityEditor;
using UnityEngine;

// sourcePath 是 panel.unity.json 的绝对路径。
Font font = AssetDatabase.LoadAssetAtPath<Font>("Assets/Fonts/MyChineseFont.otf");
// 先创建 Assets/PanelHarness/Panels；本次面板目录必须尚不存在。
// 此例源 PanelSpec.id 为 audio-settings，目录必须与 ID 一致。
string prefab = PanelPrefabBuilder.Build(sourcePath, "Assets/PanelHarness/Panels/audio-settings", font);
// packagePath 是尚不存在的 .unitypackage 绝对路径。
PanelPrefabBuilder.ExportPackage(prefab, packagePath);
```

字体必须是项目 `Assets` 下已导入的持久 `.ttf/.otf` Font，并覆盖面板所用字符。导入工具包不捆绑字体；
生成时将字体及导入设置复制到该面板的 `Fonts` 目录，按源文件摘要命名，不修改源字体。
原生 `.unitypackage` 包含复制后的字体和图片依赖。UGUI Text 使用所选字体，
不依赖 MUIP 或 TextMeshPro，也不自动下载字体。已有游戏工程不由 CLI 自动修改。

输出文件夹必须是 `Assets` 下的新目录，其父目录已存在。导入器在写入前检查结构、坐标、
引用和全部 PNG 摘要，拒绝已有目录、越界和链接；失败后的局部输出保留诊断，不自动清理。
构建使用 PreviewScene，不替换当前场景、不改变当前选择；没有自动添加菜单项。

原生包只使用一个根目录；适配器脚本由各面板共享：

```text
Assets/PanelHarness/
  Runtime/                     共享脚本
  Panels/<panelId>/
    <rootNodeId>.prefab
    panel-identity.json        程序维护的面板身份与修订记录
    Fonts/<sha256>.otf        也可为 .ttf
    Textures/<sha256>.png
    Sprites/sprite-<sha256>.asset
```

`ExportPackage` 要求 Prefab 位于适配器根目录的 `Panels` 下，并拒绝根目录之外的依赖，
避免把宿主的 `Assets/Fonts` 等路径带入包。验收发布程序还会解压检查实际包中的资产路径，
要求全部属于同一根目录与本次面板；包不包含 Editor 构建脚本、测试工程或测试场景。
导入工具包中的 `Editor` 脚本只供 Unity 生成 Prefab 使用。

滑条、开关、选择、按钮和滚动使用原生 `Slider/Toggle/Dropdown/Button/ScrollRect`，
并使用原生 Canvas、RectTransform、Text、Image 和 RectMask2D。
附加脚本中，`PanelController` 连接通用状态与事件，`PanelRoundedGraphic` 是自定义
UGUI Graphic，负责程序化圆角与边框，`PanelScrollReveal` 负责控件聚焦时滚动显示。
`PanelDocument` 与 `PanelControlView` 是数据类型。当前交付是原生 UGUI 配合适配脚本。

Unity 通过 [PrefabUtility.SaveAsPrefabAsset](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/PrefabUtility.SaveAsPrefabAsset.html)
保存原生层级，通过 [AssetDatabase.ExportPackage](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/AssetDatabase.ExportPackage.html)
生成原生包。适配器不手写 Unity Prefab YAML。

## 命名、多面板与更新

同一项目共享一套 `Runtime`，脚本名称固定，命名空间为 `GameUi.PanelHarness`。
各导出包仍携带这套脚本，路径与 `.meta` GUID 相同；不能把 Runtime 分别复制到各面板目录。
面板使用稳定英文 ID，例如 `audio-settings`、`pause-menu`，中文标题单独保存。
同一面板修改标题或内容保持原 ID；不同面板用不同 ID。当前 ID 为 1–64 个字符，
首字母英文，后续允许英文字母、数字、下划线和连字符；Unity 导出拒绝 Windows 保留名。
Prefab 为 `<panelId>.canvas.prefab`；修订号与内容摘要分别记录，文件名不承担身份判断。

Builder 生成 `panel-identity.json`，包含 ID、源/旧版本摘要、递增修订号、适配器版本、
共享脚本指纹、Prefab GUID 和文件摘要。不要手改该记录或仅重命名文件来创建另一面板。
首次 `Build` 为 revision 1；显式更新为 revision 2、3……：

```csharp
// previousSourceSha256 来自上一次已接收交付的 installation.panelSha256。
string updated = PanelPrefabBuilder.Update(sourcePath, prefab, font, previousSourceSha256);
PanelPrefabBuilder.ExportPackage(updated, newPackagePath);
```

更新复用原 Prefab 路径、GUID 和仍存在的 GameObject/组件本地标识。
辅助子对象使用完整父名称前缀，保持层级内名字唯一；保存后逐项复验本地标识。
Unity 的覆盖保存会按名称匹配对象，唯一命名是引用保持的前提，见
[SaveAsPrefabAsset](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/PrefabUtility.SaveAsPrefabAsset.html)。
旧摘要、ID、脚本版本/指纹不匹配，或 Prefab 在本地被修改时，拒绝更新。
保存或引用验证失败时恢复原 Prefab、meta 与身份记录；新增资源可能留作诊断，不自动清理。
已删除控件的引用无法保留。场景中的覆盖不反向写进源面板。

未变的字体、PNG 和 Sprite 在同一面板内复用；Sprite 名称按图片与裁切区域计算摘要，
避免插入图片时序号变化。相同字体字节复用现有导入设置；不同字节创建新字体。
不同面板之间的图片和字体仍各存一份，本轮没有实现跨面板资源去重。

导入 `.unitypackage` 前，在 Harness 目录运行只读预检：

```sh
node scripts/check-unity-install.mjs --delivery output/my-native-delivery --project <UnityProject>
node scripts/check-unity-install.mjs --delivery output/my-native-update --project <UnityProject> --expected-panel-sha <旧源摘要>
```

返回 `NEW_PANEL`、`UPDATE_PANEL` 或 `ALREADY_INSTALLED`，写入数和模型调用数均为 0。
预检复验实际包及 GUID，拒绝共享脚本变更、同 ID 另建 Prefab、旧基准不匹配、
本地 Prefab/资源修改和 meta 冲突。**Unity 自带 Import Package 对话框不会自动执行此预检。**
全量包也可新装到空项目；更新既有面板需要匹配已安装基准。0.1.0 旧试用包没有身份记录，
不能自动作为更新基准，也不会由 Harness 自动覆盖或迁移；新基准在新目录/隔离工程建立。
0.1.1 Runtime 仍能读取旧 0.1.0 文档，旧试用面板的运行状态合同保持兼容。

CLI 验收可以复用上一份原生验收结果作为基准，在新隔离工程恢复原始资产和 meta 后更新：

```sh
node scripts/check-unity-export.mjs --unity <Unity.exe> --font <ChineseFont.otf> --kit output/updated-kit --baseline test-results/previous-native --output test-results/updated-native --render
```

程序先复验原验收、包内身份、全部摘要和共享脚本，再创建隔离工程；更新包中的 Prefab
GUID 继承基准。不会在普通新建导出时凭相同 ID 随意生成 GUID 来替代更新流程。

## 运行时接入

把 Prefab 实例放进自有场景。宿主应提供一个 EventSystem 和匹配项目输入设置的 InputModule；
生成器不会往现有场景插入第二个 EventSystem。根对象上的 `PanelController` 提供：

```csharp
using GameUi.PanelHarness;

panel.EventRaised += message => {
    // message.Name 保持 Spec 的事件名；这里由宿主决定如何响应。
    // message.FieldId / ValueType / NumberValue / BooleanValue / StringValue
    // message.RowId / Action / StateJson / State
};

bool changed = panel.SetNumber("volume", 35); // 静默修改，不发宿主事件
string stateJson = panel.GetStateJson();       // 原业务对象，例如 {"volume":35,...}
PanelStateValue[] snapshot = panel.GetState();
bool restored = panel.SetState(snapshot);      // 完整快照先验证，失败不部分应用
```

`SetBoolean`、`SetChoice` 保留布尔含义和枚举 ID；方法返回 `false` 时读取 `LastError`。
按钮只发宿主事件，或恢复 `reset-initial` 明确列出的字段。它不会自行设置游戏音量、暂停游戏、
保存存档或切换界面。当前值与初值分别保存，禁用控件不能通过 UI 回调改变业务状态。
OnEnable/OnDisable 管理自己的监听器；不清除宿主监听器、不通过 Update 轮询。

## 支持范围与差异

| 通用结构 | Unity 表达 |
| --- | --- |
| 固定坐标与容器布局 | RectTransform；复用已编译的声明坐标 |
| 纵向滚动正文 | ScrollRect、RectMask2D、Content；聚焦控件时露出 |
| 滑条 / 开关 / 选择 / 按钮 | Slider / Toggle / Dropdown / Button |
| 标题、读数、只读文字 | UGUI Text；读数随业务值更新 |
| 程序化底色、圆角、边框 | 可裁切的 PanelRoundedGraphic |
| PNG 图标与面板九宫格 | 持久 Texture/Sprite；九片区域保留边界与方向 |

Unity 控件的原生操作反馈、字体度量和栅格化会与 Pixi 有差别，不承诺逐像素一致。
Toggle 使用原生勾选表现；Dropdown 使用原生弹层行为。CanvasScaler 缩放声明的逻辑画布，
不会重新计算网格列数。滚动位置不属于导出业务状态；只读文字没有新增宿主动态绑定。

Unity Slider 以整数步数作为 UI 值，双精度业务值留在控制器中。为避免 float 精度损失，
最多支持 1,000,000 个步长；导出前逐步验证 `min + tick * step` 能通过源合同的回算容差。
不满足时明确拒绝，不取整、截断或悄悄修改原 Spec。

## 隔离验收

以下脚本只在本 Harness 的新目录下创建测试工程，不启动或修改现有游戏工程。
提供本机 Unity.exe 和用于测试的字体；内置包必须在本机可用，不下载注册表依赖：

```sh
node scripts/write-unity-fixture.mjs --output output/my-native-fixture
node scripts/cli.mjs export-unity output/my-native-fixture/panel.bundle.json --output output/my-native-kit
node scripts/check-unity-export.mjs --unity <Unity.exe> --font <ChineseFont.otf> --kit output/my-native-kit --output test-results/my-native-check --render
```

程序化综合样本覆盖控件、只读文字、PNG 切片、滚动、禁用控件、当前值与选择性重置，
不是自然语言模型生成记录。测试 Prefab 和测试包可能包含指定的测试字体，交付时须选用
实际宿主字体。Node 回归与 Unity Play Mode 的报告分开，不把编译成功当成视觉或交互通过。

验收前重新验证源 PanelBundle 并重放 Unity 目标数据，防止只修改目标文件及清单摘要后蒙混通过。
原生检查使用 Play Mode、UGUI 回调和 EventSystem 事件派发，覆盖状态、动作与监听器生命周期；
渲染检查还验证实际字形网格和滑块尺寸。这些检查不代表真人鼠标拖动或用户视觉批准。

成功后用程序发布可交付文件：

```sh
node scripts/publish-unity-export.mjs --validation test-results/my-native-check --output output/my-native-delivery
```

发布器要求两份原生报告均通过，再校验包、Prefab、截图及源文件摘要；任何失败都不创建交付目录。
交付目录包含 `.unitypackage`、原始 PanelBundle、可选原生截图、两份经过字段筛选的报告和
`delivery.json`。Prefab 通过包携带完整依赖，不单独复制成可能丢失引用的文件。
机器日志和隔离测试工程不进入交付；用户视觉验收保持 `NOT_RUN`。

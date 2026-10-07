# 多面板宿主接入

真实业务可通过 [明确绑定表与游戏端口](game-binding.md) 接入；新参考应用验证 Web 音频总线、
角色提交和本地资源加载。统一回归现已包含这份业务演示。

`createPanelHost` 管理独立面板实例，由 `mount` 适配函数提供渲染和销毁。
同一来源包可以挂载多次；宿主实例 ID 必须不同，面板内部字段、节点和事件 ID 保持原样。
每个实例独立拥有当前值、输入框、渲染器和资源。玩家事件携带 `instanceId` 与来源 `panelId`。
音量、存档、场景切换和加载任务仍由游戏实现。

## Pixi

```js
import { createPanelHost } from './src/panel-host.mjs';
import { pixiPanelCore, mountPixiPanelInstance } from './src/pixi-panel-instance.mjs';
const panels = createPanelHost({ core: pixiPanelCore, mount: mountPixiPanelInstance,
  onEvent({ instanceId, panelId, event }) { game.receive(instanceId, panelId, event); },
  onError({ instanceId, code }) { game.showPanelError(instanceId, code); },
});
const first = await panels.add('loading-a', verifiedBundle, { container: firstElement });
const second = await panels.add('loading-b', verifiedBundle, { container: secondElement });
first.setProgress('progress', 60); // 实际字段 ID 来自包；宿主更新不产生玩家事件。
first.close();                    // 保留当前值，释放渲染、输入和订阅。
await first.open();               // 按保留值重新编译、挂载。
const exported = await first.exportBundle(); // 分别保存默认值和当前值。
second.destroy();
panels.destroy();
```

容器须为空且只由对应实例拥有。`add` 重放来源包校验后自动打开。
重复 `open` 不重复挂载；正在打开时共享同一任务。关闭/销毁取消挂载，迟到结果会清理。
关闭状态可静默 `setState`；销毁后须重新 `add`，使用源包当前值。
非法值不会改变状态；渲染写入失败释放对应实例，其他实例继续运行。
订阅收到独立事件快照，回调异常通过 `onError` 报告，不阻断其他订阅或清理。
小屏同时缩放画布和原生编辑器，不修改组件 Harness。当前是工作区源代码接入，
需要已有 Vite/组件依赖，尚非独立发布的 npm 包。

## Unity UGUI

现有导出包继续共享 5 个 Runtime 脚本，面板各自有 Prefab 和资产目录。
可选 `HostRuntime/PanelInstanceHost.cs` 是一个共享宿主所有者，版本单独为 0.1.0，
不改变原 Runtime 0.1.4 的身份/GUID，不替代 Slider、Toggle、Dropdown、InputField、Button、Image 等原生 UGUI。

```csharp
using GameUi.PanelHarness.Hosting;
var first = new PanelInstanceHost("role-main", rolePrefab, parent);
var second = new PanelInstanceHost("role-copy", rolePrefab, parent);
first.EventRaised += (instanceId, ev) => HandleGameEvent(instanceId, ev);
first.Controller.SetText("roleName", "主角甲"); // 使用实际导出字段 ID。
first.Close(); // 清除属于本实例的 EventSystem 选中项，停用输入，再关闭。
first.Open();
first.Dispose();
second.Dispose();
```

游戏提供 EventSystem 和输入模块；游戏所有者销毁时调用 `Dispose` 并释放自己持有的引用。
Dispose 幂等，解绑回调，使用正常帧末 Destroy。关闭/重开保留状态，新所有者使用 Prefab 当前值。
Unity 业务订阅自行处理 C# 事件异常；应通过宿主生命周期方法关闭，直接 SetActive(false) 不能保证选中项清理。

```sh
node scripts/export-host-sdk.mjs --output output/<fresh-host-sdk>
```

将导出 `Assets/PanelHarness/HostRuntime` 一次性合并进游戏项目，保留 `.meta`；后续面板不重复生成该脚本。
可加 `--native-evidence <passed-validation>`，核对已通过原生证据和 SDK 字节才标记原生 PASS，默认为 NOT_RUN。

## 统一回归

```sh
node scripts/check-host-integration.mjs --workbench <built-studio> --bundles <COM01-COM03-directory> --output output/<fresh-regression>
```

复用保存的真实生成包，执行本地夹具测试、五实例 Pixi 生命周期及 Studio 四组组合导入/编辑/撤销/导出，模型调用 0。
默认原生栏 NOT_RUN。追加 `--unity <Unity.exe> --font <font> --kit <COM04-kit> --companions <companions.json>`
可在新隔离工程实际运行原生验收；输入形如 `{"deliveries":["../COM01-delivery","../COM02-delivery","../COM03-delivery"]}`。
来源须为通过发布校验的面板包；核对共享 Runtime、包摘要、GUID 与文件内容。四 Prefab 加角色副本共五实例。
也可加 `--native-evidence <previous-validation>` 核对复用近期原生证据、发布门禁和当前测试/SDK 摘要，
明确记录 `verified-previous-isolated-run`；两种原生模式不能同时使用。
所有产物使用新目录；任一阶段失败即 FAIL，无自动重试、不放宽门禁。
计数验证监听器、定时器、编辑器、渲染资源的所有权和增长，不代表 GPU 堆/Unity 内存分析。其他引擎宿主尚未实现。

# Unity 游戏业务绑定 SDK 0.1.0

Unity 面板继续使用原生 UGUI Slider、Toggle、InputField、Button 和 Image。
业务绑定属于游戏侧共享 SDK，不加入每次面板导出的 Runtime 依赖。默认面板 Runtime 为 0.1.5 / 五个脚本。

## 安装与目录

先导入通过安装预检的原生面板包，再将 SDK 的 Assets/PanelHarness 下对应目录复制到项目一次，保留 .meta：

- HostRuntime/PanelInstanceHost.cs：已有宿主 SDK 时复用同一文件。
- GameRuntime/PanelGameBinding.cs、MemoryPanelGamePort.cs：两个共享业务脚本。
- GameExamples/PanelGameExamplePorts.cs：可选的音频、内存角色和本地纹理加载参考端口；需要 Unity 内置 AudioModule。

全部位于 Assets/PanelHarness，新的面板包继续复用这些脚本。
本 SDK 为文件目录交付，不是 .unitypackage，不是已经发布的不可变生产版本。
不用示例端口时，可不复制 GameExamples。SDK 不自动安装包或修改项目设置。

## 接入现有游戏

游戏端实现 IPanelGamePort：GetSnapshot、Subscribe、Update、ExecuteAsync。
快照/更新只含 double、bool、string；数字显式用 double。Update 应完整校验后原子提交，命令提交前检查取消信号。
接口调用、订阅通知和 UI 更新均在 Unity 主线程；工作线程需由游戏调度回主线程。
MemoryPanelGamePort 提供严格快照复制、监听隔离与取消后禁止迟到写入的参考实现，没有数据库或存档。

```csharp
using GameUi.PanelHarness;
using GameUi.PanelHarness.Hosting;
using GameUi.PanelHarness.GameBinding;
using UnityEngine;

// prefab/document/routes 来自同一份已经验证的导出；gamePort 由游戏提供。
PanelDocument document = JsonUtility.FromJson<PanelDocument>(documentJson);
PanelGameBindingDocument routes = JsonUtility.FromJson<PanelGameBindingDocument>(bindingJson);
var host = new PanelInstanceHost("settings-main", prefab, parent);
var binding = new PanelGameBinding(host, document, routes, gamePort);
binding.Error += code => ShowBusinessError(code);

host.Close(); // 保留订阅与任务，游戏进度继续同步；重新 Open 后显示当前值。
host.Open();
binding.Dispose(); // 先解绑并取消该实例的任务。
host.Dispose();    // 再销毁原生视图。
// 游戏端口的生命由游戏拥有；例如场景结束时单独 Dispose。
```

PanelGameBinding 以 panelId、panelSha256 和字段/行 ID 校验输入，不按标签猜业务。
文档和路由是已验证导出的输入；C# 不从任意 JSON 重建整个 PanelBundle 的资源与编译证明。
接入时 two-way/from-game 从游戏快照静默恢复，to-game 保留面板当前草稿。
进度只允许 from-game；reset-initial 只回写按钮声明的映射字段。
submit 保留原始字符串，必填校验失败不提交；drop 拒绝重复未完成提交，replace 取消旧任务。
失败以稳定错误码通知，没有自动重试。游戏的外部副作用需要业务自身处理，取消不能撤销已经落库的数据。

## 共用格式转换

Web 和 Unity 使用同一 GameBinding 0.1 路由定义。Unity JsonUtility 不支持 payload 字典，
createUnityGameBinding(commonBinding, verifiedPanelBundle) 将它确定性转换为 {key, fieldId} 数组，
保留 sourceBindingSha256，仍绑定同一个源面板摘要。不同版本的面板必须重新校验路由。
SDK Examples/Bindings 是验收原生包对应的固定示例；Examples/Documents 为匹配的验证文档，不能混配别的生成结果。

## 参考端口与验证

Audio(musicSource, effectsSource) 更新游戏提供的两个 AudioSource 的 volume/mute；不创建音源、不播放、不销毁游戏的 AudioSource。
Character() 只在内存中提交角色，支持异步拒绝与取消；“已存在”是固定拒绝样本。
Loading(resources) 实际校验 PNG SHA-256、Texture2D.LoadImage 解码、释放纹理，并按已完成字节更新进度；不是网络下载实现。

隔离 Unity 6000.3.7f1 / UGUI 2.0 Play Mode 已验收五实例、21 项业务检查、10 轮销毁重建；
没有进入真实游戏工程，没有模型调用。使用接入方的存档、音频混音器与 Addressables 等能力时，实现或替换端口即可。
端口生命周期与 UI 分开；关闭不是销毁。优先先 Dispose 绑定再 Dispose 宿主，最后由业务所有者释放自己的端口。

生成与复验命令（输出必须是新目录）：

```sh
node scripts/check-unity-coexistence.mjs --unity <installed-Unity.exe> --font <test-font> --kit <verified-main-kit> --companions <verified-deliveries.json> --output test-results/<fresh-native-check> --delivery output/<fresh-main-delivery> --host-test true --game-test true
node scripts/export-unity-game-sdk.mjs --native-evidence test-results/<passed-native-check> --output output/<fresh-sdk>
```

验收输入明确使用已有设置/角色/加载三个包和两个副本；任意新需求需由调用方提供明确业务绑定，不自动推测真实业务接口。

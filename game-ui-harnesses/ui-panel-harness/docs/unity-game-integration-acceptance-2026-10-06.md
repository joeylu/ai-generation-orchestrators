# Unity 业务绑定验收 · 2026-10-06

业务绑定适配已在隔离 Unity 6000.3.7f1 / 原生 UGUI 2.0 Play Mode 运行。
源码位于 adapters/unity/GameRuntime，参考业务端口位于 GameExamples；原面板 Runtime 0.1.4 五个脚本与包身份保持一致。

| 范围 | 结果 | 程序证据 |
| --- | --- | --- |
| 全量本地回归 | 628 PASS；新增 3 项格式转换和 1 项音频模块边界检查 | output/unity-game-integration-accepted-v1/unit.log |
| Pixi 宿主/Studio 组合/Web 业务 | 68 PASS（12 + 39 + 17） | output/unity-game-integration-accepted-v1/host-integration.json |
| Unity 原生业务绑定 | 21 PASS，五实例、10 轮销毁重挂 | test-results/ugi4/unity-game-smoke.json |
| 原生几何/控件/宿主/渲染 | 49 PASS，宿主原有 20 轮开关 | test-results/ugi4/unity-validation.json |
| 四包共存、发布与安装预检 | 8 PASS，共享 Runtime 五个脚本 | test-results/ugi4/coexistence-report.json |
| 共享 SDK 导出 | COMPLETE，17 文件摘要绑定；3 核心共享脚本 + 1 可选示例 | output/unity-game-sdk-v1/unity-game-sdk.json |

统一回归重新运行了本地与浏览器检查，并按当前源码、测试源码、测试输入的摘要复核 ugi4 的原生结果，
没有再启动 Unity，也没有把原生业务与主验收的检查数去重后冒充总用例数。
完整汇总 output/unity-game-integration-accepted-v1/host-integration.json 为 PASS，modelCalls 0。

## 业务检查

验收直接操作 Prefab 的原生 Slider、Toggle、InputField，并通过 UGUI SubmitHandler 激活 Button。
设置路由按 ID 对接游戏提供的两个 AudioSource 的 volume/mute；不创建音源，不播放音频。
角色原始 Unicode 跨页提交保留空格/反斜线/引号，必填失败不启动任务，重复未完成提交只执行一次。
固定业务拒绝保留草稿与旧记录，修正后明确提交可成功；取消保留草稿。
加载实际核对两张 PNG 的 SHA-256 并解码，按已完成字节更新进度。
关闭仍可完成加载并重新显示 100%；替换与销毁取消旧任务，重挂不自动重启。
迟到回写被取消上下文拒绝，十轮重挂订阅数保持稳定；最终释放所有视图、绑定与业务端口。

所有路由以来源面板摘要与字段/行 ID 绑定。C# 使用已验证的原生导出文档，
JavaScript 负责从通用 GameBinding 校验并转换 payload 字典为 JsonUtility 数组，保留通用绑定摘要。
关闭、绑定销毁、视图销毁与游戏数据的生命周期有独立所有者；无需给每个面板增加一份新脚本。

## 范围与保留证据

这是本地参考业务闭环，不是生产存档、联网角色服务、下载吞吐或完整听感测试。
只运行 Harness 内新建工程，没有进入或修改真实 Unity 游戏项目；没有调用模型或资源生成服务。
SDK 作为目录交付，全部 Unity 文件在 Assets/PanelHarness 中；没有产出新的业务 SDK .unitypackage 或不可变发布标签。

ugi1 在资源访问路径准备阶段失败，未启动 Unity；修正为 componentBundle.resources。
ugi2 被沙箱许可检查挡住，未编译；ugi3 在正常权限下定位到隔离工程缺少内置 AudioModule。
补齐仅业务验收需要的已安装模块后，ugi4 全部通过。旧失败报告保留，新目录复验不改写旧证据。
默认面板验收依赖保持原样，新增本地回归保证 AudioModule 只在音频业务验收中启用。

使用方式见 [Unity 业务绑定 SDK](unity-game-binding.md)。
完整跨引擎回归入口 scripts/check-host-integration.mjs 可复核该原生证据与当前源码摘要；
原生业务源码、测试源码或测试输入改变时，旧 PASS 不能复用。

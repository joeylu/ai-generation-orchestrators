# 多面板接入验收 · 2026-10-06

复用已有 COM01/02/03 模型生成包及 COM04 程序组合包，新模型调用 0。
全部修改位于本 Harness，4188 Studio 和其他链路保持当前版本，真实游戏 Unity 项目未写入。

| 覆盖 | 结果 | 证据 |
| --- | --- | --- |
| 本地夹具与核心测试 | 602 PASS，其中宿主 11 项 | `output/host-integration-accepted-v1/unit.log` |
| 5 个 Pixi 实例同时运行 | 12 PASS，桌面与移动 | `output/host-integration-accepted-v1/browser/host-browser.json` |
| Studio 四组组合交互 | 39 PASS，0 模型请求 | `output/host-integration-accepted-v1/composite/composite-browser.json` |
| 原生 UGUI 宿主与生命周期 | 48 PASS，其中新增宿主 7 项 | `test-results/hni3/unity-validation.json` |
| 四包共存、严格发布/安装 | 7 PASS，共享 5 个 Runtime 脚本 | `test-results/hni3/coexistence-report.json` |

Pixi 同时挂载设置、角色、加载 A/B 和角色副本。滑块/开关更新模拟游戏值，加载包各自接受静默更新；
重复表单各自输入，跨页提交只路由一次。关闭正在编辑的实例移除输入框，重开保留值，重挂使用源包当前值。
导出加载当前值 45 与默认值 25 分开保存。20 轮全部关闭/打开每次保留状态、一次提交回调。
打开计数：全局监听器 64、定时器 5、输入框 5、画布 5；关闭：14/0/0/0。宿主与基础环境保留的
14 个监听器在循环中不增长；没有以这些计数声称 GPU 内存完全回收。
1440×1080 与 390×844 无横向溢出，移动端再实际操作滑块/输入，无应用/控制台错误、无远程请求。
当前浏览器插件不可用，使用现有 Edge/Playwright，代表截图已查看。

Unity 6000.3.7f1 / UGUI 2.0 实际进入隔离工程 PlayMode，四 Prefab 生成五宿主实例。
原生控件回调、静默 setters、重复输入、EventSystem 选中项、跨页提交、20 轮开关和销毁解绑通过。
21 次提交每次只到对应实例一次，销毁后的旧 UnityEvent 不再产生业务回调。
这是 EventSystem/UGUI 派发测试，不代表真人鼠标、软键盘或完整 IME 测试。
可选宿主 SDK 仅 1 个共享脚本，原生成 Runtime 身份仍为 0.1.4、5 个脚本。

原失败保留在 test-results：host-browser-v1/v2 重开旧值文档 hydration 失败，修为按当前值编译；
host-browser-v3 窄屏 INVALID_ZOOM，修为合法底层缩放加外层缩放；hni1 测试克隆 (Clone) 后缀，
恢复测试声明名称；hni2 直接 SetActive(false) 未释放选中输入，共享宿主先清理自己拥有的焦点。
独立成功浏览器报告为 host-browser-v4。统一命令再次执行浏览器与 602 项测试，核对复用 hni3 原生证据，
明确为 verified-previous-isolated-run，不声称第二次 Unity 启动。
总报告 `output/host-integration-accepted-v1/host-integration.json`，演示 `.../demo/index.html`。
本轮不改变模型生成成功率，模拟业务尚未接入真实游戏。API、SDK 与命令见 [接入合同](panel-host.md)。

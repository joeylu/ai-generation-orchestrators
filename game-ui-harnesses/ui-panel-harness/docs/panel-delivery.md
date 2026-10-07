# Studio 面板交付包

预览区的「下载交付包」保存点击时的面板、试玩值、创作默认值、PNG 和接线说明。
导出锁定交互，不调用模型、不修改方案、不增加撤销记录。导出校验失败时不下载半成品。

解压 `<panelId>.panel-delivery.zip` 后：

| 文件 | 用途 |
| --- | --- |
| `pixi/index.html` | 离线打开，直接试玩 |
| `pixi/panel-runtime.js` | 可在自己的 Web 游戏中加载的 Pixi 适配器 |
| `pixi/panel.bundle.json` | 回到 Studio，从「面板操作 → 打开面板」继续使用 |
| `panel.spec.json` | 引擎无关的布局、字段、默认值和动作 |
| `integration-contract.json` | 字段 ID、当前值、范围、输入约束、提交/重置范围与事件 |
| `game-binding.template.json` | 绑定当前面板摘要的空业务路由表 |
| `unity/` | Unity 6 / UGUI 2.0 导入工具包，含源面板、图片和适配脚本 |
| `delivery-manifest.json` | 所有文件的字节数和 SHA-256 |

业务路由由游戏显式填写。标题或“确认”按钮的名称不会自动选择真实业务接口。
Web 使用 `PanelDelivery.createPixiPanelHost` 挂载，以不同实例 ID 和独立空容器隔离多个面板；
使用 `attachPanelGameBinding` 连接自己的端口。详见 [业务绑定](game-binding.md) 和 [多面板宿主](panel-host.md)。
绑定先销毁，视图随后销毁；游戏负责端口的生命周期。

Unity 工具包需要在编辑器中创建 Prefab，ZIP 下载本身没有执行原生验证。
游戏接入层从「面板操作 → 下载共享接入 SDK」单独下载：HostRuntime、GameRuntime、可选示例脚本
和稳定 `.meta` 安装一次；生成面板各自使用 `Assets/PanelHarness/Panels/<panelId>/`，
共用 `Assets/PanelHarness/Runtime/`。多个 ZIP 里的 Runtime 内容和 GUID 相同，导入时复用相同路径。
需要升级时先比较源摘要，已有本地改动不能直接覆盖。原生包安装预检见 [Unity 导出](unity-export.md)。

普通新需求自动产生新的 `panel-<UUID>`；已有面板修改后保持 ID，内容摘要发生变化。
同一个面板的新下载文件名相同，用面板摘要区分版本；新的业务绑定必须对应导出的面板摘要。
当前值保存在 PanelBundle，初值保存在 PanelSpec；恢复默认使用初值。

也可在此 Harness 内确定性打包已验证的面板：

```sh
node scripts/export-panel-delivery.mjs --bundle <panel.bundle.json> --output output/<fresh-delivery>
node scripts/check-delivery-workbench-browser.mjs --workbench output/<studio-build> --output output/<fresh-check>
```

目录必须不存在。浏览器与 CLI 使用同一字节生产器，内嵌 JSON 排序、HTML 换行和 ZIP 时间固定。
SHA-256 用于一致性校验，不能证明作者身份。所有下载清单保留原生 `NOT_RUN`；另行验证的报告
只证明其对应输入。SDK 和交付包目前是工作区开发产物，尚非已发布的不可变版本。

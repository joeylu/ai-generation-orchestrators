# Studio 交付闭环验收 · 2026-10-06

本轮实现 [交付流程](panel-delivery.md)，工作目录限于此 Harness。没有写真实游戏工程、
修改相邻 Harness、生成媒体或调用模型。Studio 左侧两组需求操作保持不变，预览区增加下载入口。

最新静态构建为 `output/panel-studio-delivery-v3/`，本地服务使用端口 4189。
生成与修改入口的能力检测确认 gpt-6-luna / xhigh 可用；未因此调用模型。

统一验收 `output/studio-delivery-integration-accepted-v2/host-integration.json` 为 PASS：

| 检查 | 结果 |
| --- | --- |
| 本地测试 | 636 项通过 |
| Pixi 五实例宿主 | 12 项通过，20 轮关闭/重开 |
| Studio 组合面板 | 39 项通过 |
| 浏览器业务端口 | 17 项通过，10 轮重建、两项资源解码 |
| Studio 完整下载闭环 | 17 项通过 |
| Studio 可见生成/修改与失败保留 | 22 项通过 |
| 既有 Unity 原生/共存/业务证据 | 按源码摘要复验 ugi4，49 + 8 + 21 项通过 |

浏览器检查合计 107 项。生成/修改测试从可见输入和按钮经过真实本地传输，注入明确 fixture
适配器；不把这些结果当作新增真实模型成功样本。下载检查验证真实 ZIP，逐文件复验 SHA-256，
并和同一生产器的 CLI 字节比较；重导入保留原始默认值和试玩值、多个新需求分配不同面板 ID。
SDK 脚本和 `.meta` 与源码逐字节一致，不进入各面板 GameRuntime 子目录。
加载面板还覆盖真实 PNG 闭包、离线解码与手机视口，原有组合验收覆盖分栏/Tabs/滚动等。

独立下载验收为 `output/studio-delivery-browser-check-v6/delivery-browser-report.json`。
其设置、角色、加载三个包已实际解压和离线运行。实际命令行执行
`scripts/export-panel-delivery.mjs` 得到 `output/studio-delivery-cli-accepted-v1/`，
加载面板 ZIP 与上述浏览器下载摘要完全相同。

原生复验使用同一构建的实际下载输入：
`output/studio-delivery-browser-check-v5/form-delivery/unity/`，面板 SHA-256 为
`78109b1ed3ccc7c6d657608be560041ff51922d54bae1aae41cb1a023389ba1f`。
`test-results/sd1/` 在 Unity 6000.3.7f1 / UGUI 2.0 中通过 37 项导入、原生交互、Play Mode
和渲染检查。确定性发布程序生成 `output/studio-delivery-unity-accepted-v1/`，含真实 Prefab 的
`.unitypackage`、原生截图、源面板及报告；人工视觉确认仍为 NOT_RUN。
这是一个具体表单输入的原生结果，不能用来给任意新下载包标记原生 PASS。

保留的失败记录：首轮 fixture 缺少 provenance 假设字段和键盘焦点假设错误，已修正测试输入；
导出初次发现 JSON 属性顺序和换行差异，已在 HTML 中改为规范 JSON 与固定换行，并添加
往返字节回归。原生首次在较长的隔离测试目录下出现字体路径 265 字符的 Windows Mono 读取失败，
保留 `test-results/studio-delivery-native-v1/`，使用短目录 sd1 复验同一个包后通过。没有删除失败证据
或更改原生脚本绕过检查；较深的目标工程目录仍需考虑该实际路径限制。

所有浏览器下载清单仍记录原生 NOT_RUN，业务路由模板为空，由游戏显式配置。
共享 Runtime 0.1.4、宿主/游戏 SDK 0.1.0 保持既有源摘要与 GUID。
此轮是本地工作区交付，尚未创建生产标签或发布。

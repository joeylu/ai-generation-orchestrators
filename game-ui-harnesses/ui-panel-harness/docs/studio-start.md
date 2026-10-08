# Studio 日常启动

在 `ui-panel-harness` 目录运行：

```sh
npm run studio
```

程序依次检查同仓库的锁定依赖、构建当前源码、启动本机 Studio。
默认地址固定为 `http://127.0.0.1:4951/`，不自动选择其他端口。
保持终端运行，按 Ctrl+C 停止；再次执行同一命令即可重启。
不自动安装依赖、修改系统设置或调用模型。

每次构建保存到新的 `output/studio-builds/build-<uuid>`，旧构建不覆盖。
模型请求结果位于 `output/studio-runs`，启动不会创建或补发模型请求。
这些本地产物仍受 Git 忽略规则约束，不进入源码发布。

## 固定地址与存档

使用同一浏览器、协议、主机和端口，重启及升级后仍读取原来的本机存档：
需求草稿、修改草稿、当前面板、试玩值、已用修改轮次及有限历史版本。
现有 `ui-panel-studio.workspace.v1` 存储键与格式保持兼容，不执行存档迁移或清空。
详情与容量限制见 [本机保存](studio-storage.md)。

升级源码后先停止原启动进程，再运行同一命令。
页首显示版本与构建标识，标识覆盖实际 HTML、样式、内嵌目录和运行脚本。
新版页面在打开、返回窗口或点击生成/修改时，只读核对当前服务版本。
检测到服务已更新会暂停该页面的模型入口，并提供「保存并刷新」。
保存失败时不会刷新，面板和未保存文字留在当前页面，供用户备份。
没有持续轮询或自动模型重试。早于此功能的旧页面需要手动刷新一次。

以前使用其他端口的存档仍属于原地址，不会自动合并；单个面板可通过导出/打开转移。
PanelBundle 不携带 Studio 轮次和完整草稿，不能用它冒充完整工作区迁移。

## 常见启动问题

| 情况 | 处理 |
| --- | --- |
| 固定端口被占用 | 使用已打开的 Studio；需要更新时停止旧启动进程再运行。程序不结束其他进程，也不自动换地址 |
| 缺少依赖或版本不匹配 | 运行 `npm run doctor`，按 [使用说明](start-here.md)准备相邻组件 Harness 的锁定依赖 |
| 构建或输入校验失败 | 按终端错误代码检查目录、资源库和参数；旧构建与浏览器存档保留 |
| 未发现 Codex CLI | 文件导入、试玩和导出仍可用；生成/修改需要本机已安装并登录 CLI |

本机路径通过显式参数传入，不写入通用面板文件：

```sh
npm run studio -- --help
npm run studio -- --assets <verified-library> --sharp-module <installed-module>
npm run studio -- --codex <absolute-executable>
npm run studio -- --port 5123
```

显式更换端口会得到独立的本机存档，请长期使用选定地址。
可选 `--catalog <catalog.json>` 切换目录；默认采用 `examples/modern-navigation.catalog.json`。
资源目录与相对目录参数相对于 Harness 根目录解析。
网络环境由当前启动进程继承，不读取或修改全局代理配置。

## 离线验收

```sh
node --test tests/studio-launcher.test.mjs tests/studio-build-info.test.mjs tests/workbench-server.test.mjs tests/workbench-storage.test.mjs
node scripts/check-studio-start-browser.mjs --output output/my-studio-start-review
```

浏览器检查使用当前源码的真实构建和隔离浏览器，以程序表单及升级目录夹具验证固定地址重启、
草稿/轮次恢复、旧页刷新提示、保存失败保护和导出。不会调用模型或改动日常 Studio 的存档。

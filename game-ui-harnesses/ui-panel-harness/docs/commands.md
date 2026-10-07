# 命令索引

在 `ui-panel-harness` 目录运行。新输出目录必须不存在。
现有脚本路径全部保留；此索引按用途区分入口，不移动冻结计划引用的文件。

## 日常入口

| 脚本 | 用途 |
| --- | --- |
| `check-workspace.mjs` | 只读依赖预检；也可用 `npm run doctor` |
| `cli.mjs` | PanelSpec 校验、规划上下文、编译、Bundle 校验；子命令见其 usage |
| `build-workbench.mjs`、`serve-workbench.mjs` | 构建 Studio，提供本机生成与修改入口 |
| `build-preview.mjs` | 已有 Bundle 的独立静态预览 |
| `textures.mjs`、`assets.mjs` | 纹理入库、重绘、筛选与自有资源库管理 |
| `compose-panels.mjs` | 已有面板的确定性组合 |
| `export-panel-delivery.mjs` | 已有 Bundle 的 Web/Unity 交付包 |
| `check-unity-export.mjs`、`check-unity-install.mjs` | Unity 导出包与安装冲突检查 |
| `publish-unity-export.mjs` | 核验 Unity 已生成的原生包并发布本地交付；不是 GitHub/网站部署 |
| `export-host-sdk.mjs`、`export-game-sdk.mjs`、`export-unity-game-sdk.mjs` | 可选宿主/业务 SDK 导出 |

启动命令和参数示例见 [使用与启动](start-here.md)。构建和启动不调用模型；
用户在本机 Studio 点击生成/修改时，才按对应单次授权规则提交请求。

## 无模型回归与浏览器检查

- `node --test tests/*.test.mjs`：所有本地回归，使用夹具、替身或保存结果。
- `check-asset-png.mjs`：真实 PNG 的离线解码检查。
- `check-codex-runtime.mjs`：只读 CLI 登录可见性预检，不调用模型。
- `check-*-browser.mjs`：相应构建的浏览器验收；浏览器程序可以自动化，但不调用模型。
- `write-*-fixture.mjs`、`write-*-fixtures.mjs`、`write-real-input-suites.mjs`：确定性夹具/请求集生成。
- `check-edit-boundaries.mjs`、`check-host-integration.mjs`、`check-unity-coexistence.mjs`：专项离线检查。
- `build-*-demo.mjs`、`build-*-preview.mjs`、`build-*-composition.mjs`：演示与验收构建。
- `build-delivery-runtime.mjs`：供其他构建器复用的打包函数，不是交付验证命令。
- `scripts/lib/workspace-tools.mjs`：共享工具解析，不直接运行。

`check-simple-workbench-browser.mjs` 与 `check-delivery-workbench-browser.mjs`
保留 0.1.0 主题的历史夹具，应使用 `examples/modern-mint-forms.catalog.json`
构建的 Studio（该目录包含设置、进度、Tabs 和输入框配方）。
不要把只含设置控件的旧目录或 0.4.0 新主题直接套到这些历史夹具。

## 真实模型验收与历史脚本

`prepare-*.mjs` 冻结输入和摘要，不能提交模型请求。
`run-*.mjs` 是真实模型调用入口，必须按各自 usage、冻结计划及新授权执行；
不要把它们加入普通测试命令，也不要因修复或传输失败自动重跑。
实际模型调用的授权要求见 [Codex 接入](codex-planner.md)。

`*-contract.mjs`、`*-driver.mjs`、`*-evidence.mjs`、`*-fixtures.mjs`
等模块是评测内部实现；按对应主命令或测试调用，不把文件存在当作新的独立能力。
旧的 ordinal、quote、input-stress、edit-chain 等入口仍服务于历史记录复验。
每份报告保持原来的 PASS/FAIL 与来源，不拼接不同批次结果。

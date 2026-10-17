# Panel Slicer · 面板自适应工具

这是本工具唯一的维护与 AI 接入首页。输入单张 Panel PNG 和目标尺寸，自动设置九宫格参数，复用 Pixi 渲染并产出透明 PNG；可选择后台调用或本地可视化编辑。当前仍使用所在 Harness 的锁定依赖，尚未作为独立软件包发布。

## 其他 AI 从这里调用

先遵循仓库 `AGENTS.md`，再阅读 [后台接入约定](docs/integration.md)。在 `ui-chain-harness` 目录运行：

```powershell
node tools/panel-slicer/cli/render.mjs --input panel.png --width 640 --height 220 --output result.png
node tools/panel-slicer/cli/render.mjs --input panel.png --config size.json --output result.png
```

尺寸配置：`{"width":640,"height":220,"resolution":1}`。成功输出 PNG 和一行结果 JSON；仅退出码 0 且 `status=succeeded` 时消费产物。失败包含明确错误码，已有文件不覆盖。输入须是单张面板，当前不自动拆图集。Chrome 与项目依赖须已安装，无需启动预览服务。

Node 调用入口：

```js
import { renderPanelPng } from './tools/panel-slicer/src/node.mjs';
const result = await renderPanelPng({
  input: 'panel.png', output: 'result.png', width: 640, height: 220,
});
```

浏览器调用入口为 [`src/browser.mjs`](src/browser.mjs)，与 Node 文件/进程依赖分开。界面操作、背景包与限制见 [使用与维护](docs/maintenance.md)。

## 本地预览与检查

仍从 Harness 目录运行：

```powershell
npm run panel-slicer:test
npm run panel-slicer:check
npm run panel-slicer:preview -- --port 4178
```

直接调用入口为 `node tools/panel-slicer/cli/preview.mjs`，依次选择 `check`、`status` 或 `serve` 子命令。静态预览仅监听本机；页面仍为 `/slice.html` 和 `/slice-runtime.html`。独立构建产物与来源记录仍在 Harness 的 `previews/slicing/`，由确定性构建程序发布。

## 目录与维护边界

```text
panel-slicer/
  README.md             人与 AI 的统一入口
  cli/render.mjs        PNG 后台命令
  cli/preview.mjs       独立预览/验收入口
  src/node.mjs          Node API
  src/browser.mjs       浏览器 API
  src/                  自动分析、几何、原图、背景包、Pixi 渲染与导出
  web/                  本地编辑界面及工程皮肤数据适配
  fixtures/             程序示例，不包含用户美术素材
  tests/                算法、后台调用、兼容入口与浏览器验收
  docs/                 接入约定与维护说明
```

几何、自动分析和 `SlicedBackground` 只在此目录维护一份；画布与皮肤工具通过导入复用。可视化工作台使用 Harness 的真实 Panel / PixiUI / Layout 运行时。共用 Schema 仍位于 Harness `schemas/`，依赖仍由 Harness `package.json` 与 lockfile 管理；原生布局消费示例仍在 `examples/sliced-panel/`。这些是明确共享边界，移动本目录不能单独部署运行。

旧 `scripts/panel-render.mjs`、`src/slicing/*.mjs`、`src/runtime/sliced-background.mjs` 及原测试/文档路径保留薄兼容入口；不得在旧入口再添加第二份实现。原 `slicing:*` 命令继续可用，新调用统一从此首页进入。后台结果 JSON 与保存的配置/背景包格式未因目录迁移改变。

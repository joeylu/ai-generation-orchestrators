# Panel Slicer 后台接入

已实现本地 CLI 与 Node 函数：输入**单张** Panel PNG 和目标逻辑尺寸，自动分析并输出透明 PNG。没有预览页面操作、监听端口、网络请求、模型调用或媒体生成服务；不依赖画布构建/current。内部采用 Playwright 无头 Chrome、软件 WebGL 和现有 Pixi `SlicedBackground` / `exportBackgroundPng`。

## 给其他 AI / 编排链路的调用约定

本文件是 Panel Slicer 后台工具的接入入口。先遵循仓库的 `AGENTS.md`，再按本文件调用；工具源码入口为 [`cli/render.mjs`](../cli/render.mjs)，Node API 为 [`src/node.mjs`](../src/node.mjs)。当前可调用能力是单张 Panel PNG 的确定性处理，整个 UI 三段生成链路的状态另见 [Harness README](../../../README.md)。

1. 确认输入是单个面板 PNG、目标逻辑宽高、输出分辨率和一个尚不存在的输出路径。宽高与最终 PNG 像素尺寸的关系是 `像素宽高 = 逻辑宽高 × resolution`。
2. 确认项目锁定依赖与本地浏览器已安装，Node.js 版本满足本项目 `package.json`。运行 `node tools/panel-slicer/cli/render.mjs --help` 可核对 CLI 参数；调用本工具不需要先启动或重建预览。
3. 推荐通过 CLI 调用，进程参数使用数组传入；脚本、输入、配置和输出可使用绝对路径，避免调用方工作目录不同造成定位错误。配置文件与命令行尺寸参数二选一。
4. 读取进程退出码和 stdout 的 JSON。仅当退出码为 0、`kind` 为 `ui_panel_png_result`、`version` 为 `1.0` 且 `status` 为 `succeeded` 时消费产物；需要跨链路传递时保留返回的输出路径、尺寸、SHA-256 与 `document`。
5. 收到 `slice.auto-unsupported` 或 `slice.distortion` 时，把失败原因交回上游素材/尺寸选择步骤。同样输入和尺寸直接重试不会解决这类失败；调用方不得伪造成功或改参数绕过适用规则。
6. `slice.output-exists`（并发发布冲突可能返回文件系统的 `EEXIST`）表示输出路径已占用。核对已有产物，或使用新的输出路径；浏览器缺失、文件权限等错误按环境问题处理。本工具不会覆盖旧结果或自动安装依赖。

CLI 默认每次处理一个请求，stdout 是一行结果 JSON，失败退出码为 1。调用方应为整个子进程设置合适的超时，例如 120 秒；内部浏览器启动和渲染各有超时。PNG 属于当前目标尺寸的成品，后续需要再拉伸时保留返回参数或原始背景包，避免把成品 PNG 当成原素材反复处理。

## 命令行

在 Harness 目录运行（也可从任意工作目录使用脚本绝对路径）：

```powershell
node tools/panel-slicer/cli/render.mjs --input panel.png --width 640 --height 220 --output result.png
node tools/panel-slicer/cli/render.mjs --input panel.png --config size.json --output result.png
```

`size.json` 是独立的尺寸配置，不是编辑器切线配置或背景包：

```json
{"width":640,"height":220,"resolution":1}
```

宽高须为 24–4096 的整数；resolution 可为 1、2、4，默认为 1，最终每边不得超过 4096。配置不接受未知字段，不能同时传尺寸参数与 `--config`。路径按调用方工作目录解析。输入上限 32 MiB；原图字节不变。合集图片须先拆为单个素材，该入口不执行图集分割。

默认使用机器已安装的 Chrome。`--browser chromium` 可选择已安装的 Playwright Chromium；不会自动下载浏览器。需安装本项目锁定的依赖，包括用于后台构建渲染适配器的 esbuild。此入口使用已有纯算法和 Pixi 核心，不加载编辑器、完整组件注册表、工程皮肤或用户字体。

## 调用结果

成功：退出码 0，stdout 一行 JSON，包含 `kind=ui_panel_png_result`、`version=1.0`、`status=succeeded`、输出路径、实际像素宽高、字节数、SHA-256 以及最终 SliceDocument（原图摘要、自动切线、倍率和尺寸规则）。调用方应检查退出码与 status，而不是检查是否有 PNG 文件。

失败：退出码 1，stdout 一行 JSON，`status=failed`，`error.code` 和 `error.message` 提供原因。不支持的素材为 `slice.auto-unsupported`，过度拉伸为 `slice.distortion`，无效尺寸为 `slice.options`，已有输出为 `slice.output-exists`。文件系统和浏览器错误也会失败，不静默降级或改用其他渲染算法。

输出先编码并验证 PNG 尺寸，再写同目录临时文件，通过硬链接执行原子、禁止覆盖的发布。目标已存在（包括并发写入）时失败，保留原文件；目标文件系统必须支持硬链接。失败不会以半成品替换目标 PNG。渲染超时后关闭浏览器。当前每次调用单独创建浏览器，适合初版接入，不是批处理常驻服务。

## Node 调用

```js
import { renderPanelPng } from './tools/panel-slicer/src/node.mjs';

const result = await renderPanelPng({
  input: 'panel.png', output: 'result.png',
  width: 640, height: 220, resolution: 1,
});
// result 与 CLI 成功 JSON 相同；失败抛出带 code 的错误。
```

自动参数由原始素材和本次目标尺寸共同决定。若要多个尺寸保持同一倍率，应使用已有背景包/文档消费方式；当前后台入口不接受手动切线覆盖或通过改变参数绕过尺寸规则。规则通过只意味着技术检查通过，不代表美术验收。

验证：`node --test tools/panel-slicer/tests/panel-render.test.mjs` 覆盖独立工作目录、JSON 输入、透明/半透明像素、成品尺寸、摘要、已有文件保护和失败不产出。

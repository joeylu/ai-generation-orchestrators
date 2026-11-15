# 原生来源的真 Alpha 诊断

`continuous-alpha-fixed-surrounds-v1` 是独立的零图片调用诊断入口。透明原 PNG 可以在
Alpha=0 的像素下保留高饱和 RGB；某些原图预览器会错误地把它显示成彩色背景、光晕
或孔洞填色。对透明来源作这类语义判断之前，先检查本入口的真实连续 Alpha 合成图。

## 使用

在 Harness 目录运行，优先绑定已经存在的公有工作流结果：

```sh
npm run source:alpha-review -- --workflow LOCAL_WORKFLOW --plan PLAN_SHA256 --out NEW_DIRECTORY
```

这会通过公有 `getGenerationResult` 重放读取准确 plan/raw/QA 身份，不更改计划、
原 PNG、QA、事件或终态。失败来源也可以诊断；原有失败不会因此变成技术通过。
输出必须位于工作流以外的全新目录，不能覆盖上一次诊断。

也可显式读取一张本地 PNG：

```sh
npm run source:alpha-review -- --png LOCAL_PNG --out NEW_DIRECTORY
```

此模式的报告明确为 `explicit-png-unbound`，不证明该文件属于某个计划或 QA。
这些路径只用于本地 CLI；没有新增 Studio/HTTP 路由、外部服务或图片适配器。

## 输出与原始身份

- `white.png`：固定白色背景。
- `dark.png`：固定深灰 RGB(32,36,42) 背景。
- `checker.png`：原点固定、16px 方格，灰度 232/176。
- `source-alpha-review.json`：无主机路径的封印报告，包含原 PNG、解码 RGBA、Alpha
  通道及各诊断图的 SHA-256、尺寸、Alpha 直方图和 Alpha≥1/≥8 包络；绑定工作流时
  另包含原 plan/result/QA 指纹与原技术状态。

三张诊断图均在原生尺寸逐像素合成、不缩放、不裁切，输出 Alpha=255。每个 RGB
通道采用 `round((source*alpha + background*(255-alpha))/255)`，保留全部连续 Alpha
的贡献。Alpha=0 的隐藏 RGB 不可见；Alpha=1..254 的真实颜色仍参与混合，不能把
真实水色、背景或软边当作隐藏 RGB 删除。没有 Alpha=255 像素也不代表来源没有实体。

原 PNG 的全部字节、RGBA、Alpha 和原 QA 保持。诊断图是另存的不透明观察材料，
不能重新提交为透明来源，也不构成清 Alpha、去背景、调色、修补轮廓或原图替代。
报告不授予技术改判、来源接受或最终美术接受，也不授权生成、重试或后续批次。

## 范围

使用现有检查器支持的非隔行 8-bit RGB/RGBA PNG，每边不超过 4096、输入不超过
16MiB；不下载模型、不联网、不调用图片生成。无结果的未知尝试不能借此恢复成结果。
原生合成图用于辨认真实 Alpha 内容，不代替最终 Studio 的缩放过滤、接缝、图层遮挡、
镜头覆盖与整体美术审阅。

纯程序入口为包导出 `./source-alpha-review` 的 `createSourceAlphaReview(raw, options)`。
它返回固定诊断文件 Map 和报告；可选 `options.generationResult` 绑定已经取得的封印
结果身份，不接受自定义背景、遮罩或绘画指令。

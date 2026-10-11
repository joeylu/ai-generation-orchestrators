# UI Reference Harness 0.7.2

发布标签：`ui-reference-harness-v0.7.2`。修复 Codex 原生生图工具的严格参数兼容问题。

## 修复范围

0.7.1 图片 Hook 固定注入 `transparent_background: false`，部分原生工具的参数合同不接受
该字段，导致工具校验失败并且不产图。现在仅传冻结 `prompt` 和存在时的有序本地参考文件，
不注入透明度选项，也不透传模型自行补充的参数。

冻结提示词仍要求完整不透明 PNG，核心继续逐像素检查 alpha=255，非不透明输出按
`GENERATED_NOT_OPAQUE` 拒绝。单次调用限制、图片指纹、结束后停止及禁止自动重试均保留。
0.7.1 的已完成结果、风格预览和修改额度继续可读取、人工复核、复用和交付。

## 安装和升级

固定本标签、完整提交、`ui-reference-harness-v0.7.2-source.zip` 的字节数与 SHA-256、
release-manifest.json 的 SHA-256 和 runtimeSha256，逐项验证 sourceFiles，保持原始字节与
三个兄弟 Harness 的目录关系。可选本地 Studio 使用配套同根目录的 studio ZIP。
Node.js 要求 >= 22.18.0，推荐 24。

Hook 源码摘要会改变。消费方须检查新 Hook 并按既有审核机制更新可信记录；不得跳过 Hook
信任检查、修改安装包或放开全局权限。先核对在途请求，保留旧运行时、工作区、原生 session、
原图和旧 ZIP；历史失败／未知尝试不重投，新的真实调用需要新的单次摘要决定。
旧 DAG 保留检查；使用新运行时创建新 DAG 时复用已接受图及锚点，历史修改额度继续计数。

本版没有新增服务或前端 API，保留 0.7.1 的 UX 和宿主可见性合同。
具体接入边界见 [宿主说明](host-integration.md#072-原生生图参数兼容)。

## 验证边界

发布附件的 offline-regression.json 记录严格工具参数替身、零／有参考图、旧结果兼容、
不透明 PNG 拒绝、单次调用和完整解压回归；测试仅用合成夹具及提供商替身。
发布过程不调用真实生图工具；这些检查不代表 Docker 环境真实生图或人工验收已通过。

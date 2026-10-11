# UI Layer 0.1.0a5

固定标签为 `ui-layers-v0.1.0-alpha.5`，CLI 版本为 `0.1.0a5`。
这是宿主集成源码预览，图层合同继续使用 `ui_layer_composition_v1`。

## 安装与升级

下载本版 Release 的五个附件，验证摘要后解压到新的版本目录。
查看器 ZIP 从源码根目录展开；旧任务继续使用原版本和原运行目录。

```sh
sha256sum -c SHA256SUMS
tar -xzf ui-layers-v0.1.0-alpha.5-source.tar.gz
cd ui-layers-v0.1.0-alpha.5
unzip ../ui-layers-v0.1.0-alpha.5-viewer.zip
python -m pip install -r game-ui-harnesses/ui-layer-harness/requirements.txt
python game-ui-harnesses/ui-layer-harness/ui_layer.py --version
```

精确提交、源码及查看器摘要和离线回归范围见 `release-manifest.json`、
`offline-regression.json`、`SHA256SUMS`。附件仅使用固定提交的公开源码及构建产物，
不包含用户参考图、生成结果、登录凭证、会话或私有宿主配置。

## 正式接入

使用 `ui_layer.py host-run` 及 `host-*` 交换协议。
`host_delivery.py` 的持久化状态机串起 fresh M1 → 独立 M2 → 生图 →
确定性切分、归位、回拼、对比及打包 → 一次独立整图复审。
旧 `run/resume/status` 保留原 DAG；同一作业不能混用两条控制入口。

新快速 warning 配置建议显式包含以下字段，其余必需字段见
[HOST-DELIVERY.md](HOST-DELIVERY.md)：

```json
{
  "planningMode": "fresh-host-m1-independent-review",
  "generationMode": "sheets",
  "generationGroupingPolicy": "compact-controls-context-grid-v5",
  "visualReviewMode": "warning",
  "bodyReviewPolicy": "final-composite-first-v1",
  "materialReviewPolicy": "final-composite-once-v1",
  "maximumConcurrentImageCalls": 3,
  "maximumMaterialReviews": 1
}
```

宿主必须识别新的 `composite_review` 模型阶段，按准确数据包、schema 和证明格式接收答复。
原图、最终回拼和素材总览一次送审；逐生图请求复审和主体观察均为 0 次。
完整配置中的 `maximumBodyCalls` 仍须是 1–128 的正数预算字段；本策略不会使用该预算。
显式 `per-request-v1` 和历史协议继续保留。旧适配器应先更新阶段处理，再启用新策略。
详见[接入流程](HOST-INTEGRATION.md)。

生图支持最多三路持续补位。每次收到原始 PNG 后，串行调用
`host-receive --refill-images`，立即派发返回的下一份已预留请求；也可通过
`host_image_dispatch.run_images` 接入明确提供的异步工具适配器。
所有同一作业的 CLI 状态写入仍需串行。失败停止新增派发，保留已返回原始证据；
未知接受状态和终态失败不自动重投。

可选 Codex CLI 适配器调用已登录账号中的原生 `image_gen`，通过本地冻结参数转发工具
传递提示词和参考图，收集原始 PNG；不通过 API key SDK 调用 API Platform。
验证使用的 CLI 为 `0.162.0-alpha.17.2`；原生工具支持 `transparent_background` 布尔值，
背景为 false，透明前景为 true。宿主仍负责调用协调，桌面会话及账号凭证不会随包进入容器。

## 本版变化

- v13 提示词只编辑给定参考：背景直接去 UI，前景移除外来元素并保留所属主体；
  删除背景人物污染，保留独立插画自身画面。
- 每张 sheet 的裁片合为一张输入板，保留原像素。v5 逐格文字删除优先于 KEEP，
  明确删除普通中文、其他语言标签、数字和文字效果，精确 `preserveText` 例外除外。
- sheets v5 检查素材尺寸比例并采用均衡网格，M2 前核算所有合板的原分辨率输入容量。
- 切线检测副本忽略 alpha 0/1 杂点；渲染素材保留全部非零原始 RGBA，包含 alpha=1 外发光。
  原始合板与裁片另存。不确定切分明确列为未解决并排除回拼，不伪造独立素材交付。
- 一次整图复审检查实际残留文字和布局风格，视觉差异只报 warning，无自动补图。
- 纯验证和输入板构建在单次操作内按当前字节及目录清单复用；最终包校验和实时状态继续完整检查。
- 修复 CLI schema 中 enum/const 缺少类型及 PNG 检验顺序问题；没有内部行线时允许显式空数组。

## 验证范围

一次从原参考图开始的新 CLI 验证完成 M1 1 次、独立 M2 1 次、生图 3 次（峰值并行 3）、
最终整图复审 1 次，交付 4 项素材、回拼、对比和 ZIP；未复用旧计划或素材，未进行技术续跑。
其复审发现按钮文字残留。修复后的 v5 提示词另以 1 次 sheet 生图和 1 次整图复审
验证去除了两个中文按钮标签，复用的背景和面板保持字节及坐标一致；按钮边框、高光差异保留为风格 warning。
后一次是明确授权的有限修订，不冒充从原图整链验证。

这些是真实的有限样本验证，不保证任意复杂图一次达到完整视觉一致。
本次没有 Linux/Docker 部署验收，也没有新增 Docker 服务或部署脚本。
快速 warning 终态仍为 `diagnostic_complete_pending_visual_acceptance`；
服务应展示回拼、对比、素材包、warnings 及未解决素材，不能把包校验或执行完成显示为严格视觉通过。
普通文字数字继续留空；技术完整性错误继续阻断。

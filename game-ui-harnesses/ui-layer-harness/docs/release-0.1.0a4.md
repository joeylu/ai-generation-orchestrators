# UI Layer 0.1.0a4

固定标签为 `ui-layers-v0.1.0-alpha.4`，CLI 版本为 `0.1.0a4`。
这是宿主集成源码预览，图层合同仍为 `ui_layer_composition_v1`。

## 安装

从对应 GitHub Release 下载源码、离线查看器、回归记录、发布记录及 `SHA256SUMS`。
先验证摘要，再解压到新版本目录；查看器 ZIP 从源码根目录展开。

```sh
sha256sum -c SHA256SUMS
tar -xzf ui-layers-v0.1.0-alpha.4-source.tar.gz
cd ui-layers-v0.1.0-alpha.4
unzip ../ui-layers-v0.1.0-alpha.4-viewer.zip
python -m pip install -r game-ui-harnesses/ui-layer-harness/requirements.txt
python game-ui-harnesses/ui-layer-harness/ui_layer.py --version
```

源码和查看器都来自固定提交的公开源码，不包含用户样本、生成结果或私有运行配置。
精确提交、文件摘要和离线验证范围见发布附件 `release-manifest.json`、`offline-regression.json`。

## 接入与变化

新服务使用 `host-run` 和 `host-*` 交换协议，见[宿主接入流程](HOST-INTEGRATION.md)。
外层由持久化状态机串起 M1、独立 M2、生图、独立素材复审、归位与打包，底层复用既有确定性原语。
旧 `run/resume/status` DAG 入口继续保留；不能混用两条入口管理同一个作业。
宿主负责真实模型／生图工具及回执；并发外部调用时，同一作业的状态写入必须串行。

本版包括三路生图和三路素材复审、内联复审数据包、兼容卡片的 sheets v3 分组、
v10 归属提示词、从 M1 自动声明和检查布局、内部行线／色带测量及确定性候选归位。
普通文字数字继续留空，视觉差异保留 warning；技术完整性错误仍会停止。
重复文字片段按原序保留为独立出现项，不修补原始模型答复。
统一缩放的插画卡片可声明内部目标用于生成和复测，不因此获得内部拉伸许可。
M1 布局和请求容量检查提前到准备 M2 之前。

完整新配置建议显式设置以下片段，必需字段和预算见 [HOST-DELIVERY.md](HOST-DELIVERY.md)：

```json
{
  "planningMode": "fresh-host-m1-independent-review",
  "generationMode": "sheets",
  "generationGroupingPolicy": "compact-controls-context-grid-v3",
  "visualReviewMode": "warning",
  "bodyReviewPolicy": "final-composite-first-v1",
  "maximumConcurrentImageCalls": 3,
  "maximumConcurrentMaterialReviews": 3
}
```

## 已知限制

复杂竖版样本经历两次生图前失败后，以已复核快照启动独立交付续跑；
实际生图 7 次、独立复审 5 次，26 项素材中 11 项独立切分仍未验证。
诊断回拼存在截断、图形重复和背景／布局偏差，因此不宣称一次跑通、完整一致或视觉验收通过。
该样本及私有证据不进入发布附件。

默认快速 warning 终态仍为 `diagnostic_complete_pending_visual_acceptance`，
调用方应展示诊断结果、未解决素材和 warnings，不能把包校验通过显示为严格视觉通过。
独立素材交付是否完成须读取状态字段；主体观察默认 0 次。

没有新增真实生图发布测试或 Linux/Docker 部署验收；外部 Docker 服务由消费端实现。
旧任务保留旧运行时、授权、答复及失败记录，不可原地升级续跑。
所有新增计算仍须绑定不可变摘要；未知接受状态和终态失败不自动重发。

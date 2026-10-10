# UI Layer 0.1.0a3

固定标签为 `ui-layers-v0.1.0-alpha.3`，CLI 版本为 `0.1.0a3`。
这是可供外部服务集成验证的源码预览，图层合同仍为 `ui_layer_composition_v1`。

## 外部服务安装

从对应 GitHub Release 下载源码归档、离线查看器附件和 `SHA256SUMS`，先验证摘要，再展开到新的版本目录。
源码归档保留仓库目录关系；查看器附件从该根目录展开到
`game-ui-harnesses/ui-component-harness/dist-layers/`。该附件由本标签的公开源码构建，无须在服务镜像内构建 Node 前端。

```sh
sha256sum -c SHA256SUMS
tar -xzf ui-layers-v0.1.0-alpha.3-source.tar.gz
cd ui-layers-v0.1.0-alpha.3
unzip ../ui-layers-v0.1.0-alpha.3-viewer.zip
python -m pip install -r game-ui-harnesses/ui-layer-harness/requirements.txt
python game-ui-harnesses/ui-layer-harness/ui_layer.py --version
```

入口仍为 `game-ui-harnesses/ui-layer-harness/ui_layer.py`，宿主继续负责模型、生图工具调用和真实回执。
本发布不改动外部 Docker 服务，不增加 Dockerfile、网络服务或部署流程。

## 新作业配置

在既有完整 `host-run` 配置中加入以下字段；这是配置片段，不是完整可执行任务：

```json
{
  "generationMode": "sheets",
  "generationGroupingPolicy": "compact-controls-context-grid-v1",
  "visualReviewMode": "warning",
  "bodyReviewPolicy": "final-composite-first-v1"
}
```

`generationGroupingPolicy` 是显式选择。省略它会保留原分组规则，不会自动获得本轮六素材分组。
紧凑策略仅支持 sheets/context-crops；最多六个兼容简单控件合板，保留所有独立素材身份，
不通过降低计划分辨率凑数。背景和不兼容大面板仍可单独请求。
超出五张参考附件的 context 请求会使用确定性源像素参考合板，宿主应直接使用程序返回的冻结参数，
不要自行重组附件或提示词。

素材复审按生成请求计数，一张 sheet 一次。新 warning 作业默认不创建逐素材主体观察任务，
回拼使用明确标记为未观察的 alpha 几何代理。需要逐前景主体观察时，在新配置中使用
`bodyReviewPolicy=every-reviewed-foreground-v1`。

默认快速 warning 终态为 `diagnostic_complete_pending_visual_acceptance`。
宿主应提供诊断回拼、原图对照、候选素材包和 warning 报告供验收；不得将该状态显示为严格视觉通过，
也不得只接受 `complete_pending_visual_acceptance` 而丢弃诊断交付。
`FullAutomationExecutionCompleted`、`FullReferenceToDeliveryExecutionCompleted` 和
`independentMaterialDeliveryComplete` 在诊断终态保持 false。
技术完整性错误、无效证据和不确定传输仍会停止，未知接受状态不会自动重发。

## 升级与验证范围

已冻结的计划、授权、回执和失败状态继续绑定原运行时，不能在原目录换版本续跑。
升级只用于新的作业；原始 PNG 的跨作业复用须走显式、校验过的来源绑定。
业务文字数字按图形素材合同留空。

本地验证覆盖离线 Python 回归、图层导入合同、查看器构建和发布归档烟测；最终检查数量记录在发布附件中。
没有新增真实生图测试或外部 Docker 部署验收。
本轮设置页样本为 19 个素材、6 张有效生成 PNG；素材完整性可交付，
但底板尺寸、分隔线、滑条连续性和颜色仍有偏差。串行素材复审也仍是耗时来源。
该样本不作为完整一致或无人介入稳定产出的验收证据。

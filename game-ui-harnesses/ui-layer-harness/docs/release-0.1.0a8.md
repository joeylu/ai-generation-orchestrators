# UI Layer 0.1.0a8

标签：`ui-layers-v0.1.0-alpha.8`；CLI：`0.1.0a8`。
基线为 alpha.7 (`7177233f02575c7b0731cde3fffcabe4a203bb56`)，包含
`fbb5acf3` 的基准/计时修订和 `29cc37b4` 的极淡辉光切分。

## 改动

固定基准新增不可变 `complex-v2.json`，保留 v1，增加海洋远征成功规划和失败整图
复审的证据样本。计数包含 `planning_repair`、`planning_rereview`；失败任务仍检查
调用预算与引用一致性。已验证诊断包可以独立计量，失败状态不会被提升为成功。
基准同时衡量首次完成、素材完整性、几何和各类调用次数。

调度器可用 `capture_timings=True` 返回排队、适配器等待、回执处理和补位间隔。
它默认关闭，不新增持久化状态、模型调用或传输重试。合板失败诊断公开候选搜索
窗口、透明行和外缘像素统计。详见 [基准和计时](BENCHMARK-AND-TIMING.md)。

新增显式 `sheetSeamPolicy=faint-glow-preserving-seam-v3`：优先透明切缝，否则仅允许
在原搜索窗口内选择相邻完整行/列 alpha 均小于 8 的唯一最优切线。保留全部原始
RGBA 裁片及像素重建证明；极淡辉光切分记录 `SHEET_FAINT_GLOW_SPLIT` warning。
不删除或提高阈值清理 alpha 2～7，不把轮廓测量当成语义完整性或人工验收。
较强连接、外缘裁断、非空备用格、缺失轮廓和歧义仍不会获准切分。

新策略只适用于 warning、prepared-sheet 诊断及一次最终整图复审的正式 host-run。
独立素材复审不能选择它。默认仍为 v2，历史配置与快照按原版本执行。配置和契约
共同绑定实际候选，最终复审看到实际新合成结果。接入见
[HOST-INTEGRATION](HOST-INTEGRATION.md#recommended-new-diagnostic-configuration)。

## 验证边界

发布附件 `offline-regression.json` 记录精确提交、离线测试、独立安装烟雾检查、
固定基准以及 CI 的实际范围；远端 CI 状态绑定对应提交和运行链接。

源码修订已做 165 项相关离线回归，新增 12 项切分测试；六个固定样本无新增倒退，
两例可重放样本的 ZIP、图层和预览字节一致。已有海洋合板的只读像素验证可切出
四张 crew，切线最大 alpha 为 7、2、2，裁片能逐像素拼回原图。完整发布检查由
附件单独记录，定向测试不冒充全套回归。

**alpha.8 新增真实模型验收：未执行。** 没有为本次发布新增规划、生图、逐素材、
body 或整图模型调用。alpha.7 的历史证据是另一范围：规划修复和独立复审成功、
26 张原始图已收到，正式 host-run 的首次整图复审连接失败；后来单独授权的补充
复审成功，但不提升原失败任务。原交付仍为 60/64，alpha.8 的离线派生裁片不把旧
任务改成 64/64 的正式交付。用户样本、会话、授权和原始回执不进入发布附件。

## 安装和升级

下载本 Release 的五个附件，先校验 `SHA256SUMS`：

```sh
sha256sum -c SHA256SUMS
tar -xzf ui-layers-v0.1.0-alpha.8-source.tar.gz
cd ui-layers-v0.1.0-alpha.8
unzip ../ui-layers-v0.1.0-alpha.8-viewer.zip
python -m pip install -r game-ui-harnesses/ui-layer-harness/requirements.txt
python game-ui-harnesses/ui-layer-harness/ui_layer.py --version
```

从 alpha.6/alpha.7 升级均安装到新版本目录，只对新任务使用新版。保留每个旧任务
完整目录和原运行版本，不改授权、回执、失败状态、快照或交付清单。
生产消费者按附件 SHA-256 使用不可变标签，不维护第二份复制源码。

## Docker 消费端和中断恢复

本版相对 alpha.7 没有新增 stage、授权或模型预算。启用极淡辉光切分只增加上述
配置值；继续使用官方 host-run、v13、sheets、最多三路持续补位、board v6 纹理
来源绑定、原生 transparent_background 和一次最终 composite_review，默认
逐素材和 body 模型调用均为零。视觉差异保留 warning，技术完整性错误终止任务。

alpha.6 消费端升级须识别 alpha.7 已引入的 `planning_repair`、`planning_rereview`，
显式启用时预留最多两次额外规划调用；普通正常路径仍是 M1/M2。stage、授权、
预算与回执格式见 [PLANNING-REPAIR](PLANNING-REPAIR.md)。本次未操作 Docker。

恢复仅检查既有 reservation，或推进已经收妥、验证通过且 checkpoint 完整的结果。
超时、未知结果、中断 receive/advance 继续遵守 no automatic resubmission；
`INTERRUPTED_TRANSACTION_NO_RESUBMIT` 保留部分证据，新的尝试需要新目录和新的
用户决定。新切分策略不会恢复历史失败任务，也不触发生图补提。

已有样本的主要墙钟成本在外部生图等待，包含排队和传输，不能视为纯推理耗时。
本版修正切分误拒绝并增强测量，不声称已经缩短模型或生图等待；后续应在正常新
任务中收集调度统计，再据此选择优化。

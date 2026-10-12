# UI Layer 0.1.0a7

标签：`ui-layers-v0.1.0-alpha.7`；CLI：`0.1.0a7`。
规划修复基线为 alpha.6 (`dab0c2c334d130543b1f82b1794d895b3cfe9ca2`)。
同时包含前一提交 `5a657193` 的离线基准、阶段计时及确定性处理开销优化。

## 新行为

官方 `host-run` 对新 fresh M1 任务执行通用程序预检，区分技术阻断和视觉提示。
明确归属的小幅越界可在保守条件内派生父框并集；不缩对象、不猜归属、不覆盖回答。
未解决的规划错误仅在显式配置和预授权下进入一次模型修复及一次独立复审。
默认正常路径仍只调用 M1/M2，启用修复显式预留最多两次额外规划调用。
修复后的实际候选用于预览、容量核算、复审、冻结、归位及后续生图。

配置、stage、授权、模型预算、回执格式和 Docker 消费端接入见
[规划修复协议](PLANNING-REPAIR.md)，正式循环见 [HOST-INTEGRATION](HOST-INTEGRATION.md)。
本仓库没有执行 Docker 命令、检查或修改 Docker 服务。

继续保留 v13 编辑提示词、sheets、最多三路持续补位、board v6 的已审纹理绑定、
原生 transparent_background 和一次最终 composite_review；默认逐素材与 body 模型调用为零。
视觉差异仍为 warning，技术完整性错误停止，人工视觉验收标记保持真实。

## 验证范围

分阶段离线结果及精确计数由发布附件 `offline-regression.json` 记录：

- 对准确 alpha.6 标签的离线失败复现，与新增通用修复回归分别记录。
- 新用例覆盖四方向越界、共享素材、错误引用、非法坐标、重复 ID、无效约束、
  安全与拒绝归一化、失败/重复阻断、预算限制、中断恢复及篡改。
- 现有官方链路、amendment/merge 历史快照、纹理/合板与整图复审继续离线回归。
- 发布归档按已提交公开源码构建，在独立解压目录执行版本、命令及修复/历史兼容检查。

**真实模型验收：未执行。** 未调用真实规划模型、修复模型或生图；
alpha.5 故障背景未被描述成 alpha.6/alpha.7 的真实模型复现。
CI 状态以该发布提交对应的实际 Actions 结果为准，附件与 Release 页面分别提供绑定证据。
有限离线通过不能证明任意参考图的视觉正确性；诊断交付仍待人工验收。

## 安装与历史兼容

下载本 Release 的五个附件，先校验 `SHA256SUMS`：

```sh
sha256sum -c SHA256SUMS
tar -xzf ui-layers-v0.1.0-alpha.7-source.tar.gz
cd ui-layers-v0.1.0-alpha.7
unzip ../ui-layers-v0.1.0-alpha.7-viewer.zip
python -m pip install -r game-ui-harnesses/ui-layer-harness/requirements.txt
python game-ui-harnesses/ui-layer-harness/ui_layer.py --version
```

源提交、源代码/查看器 SHA-256、离线阶段和 CI 证据绑定在
`release-manifest.json`、`offline-regression.json` 和 `SHA256SUMS`。
附件只含公开已提交源码、查看器和去私有路径的测试摘要；不包含任务样本、会话或授权。

从 alpha.6 升级时安装到新版本目录，仅为新任务选择新代码；保留旧版本和每个旧任务完整目录。
历史失败任务不可继续为新版本重试，不改旧授权、回执、清单或指纹。
旧 amendment/merge 快照继续按原协议检查，不能冒充新增独立复审。

重启后可检查 pending reservation 或推进已收妥且 checkpoint 完整的回答；不得重复派发。
中断 receive/advance 事务仍以 `INTERRUPTED_TRANSACTION_NO_RESUBMIT` 终止并保存部分证据。
超时或结果未知使用 `host-fail`，保留迟到结果，新的尝试需新目录和新的决定。

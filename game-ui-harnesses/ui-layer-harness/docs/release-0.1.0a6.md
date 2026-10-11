# UI Layer 0.1.0a6

固定标签：`ui-layers-v0.1.0-alpha.6`；CLI：`0.1.0a6`。
这是兼容修复及协议维护的源码预览，继续使用 `ui_layer_composition_v1`。

## 对宿主及 Docker 服务的影响

发布本身不部署或修改外部服务。已经固定版本和摘要安装的 Docker 服务继续使用原版本。
从 alpha.5 升级不需要修改 `host-*` 命令、必需配置字段、回执格式或素材包解析。
新作业保持 sheets、v13、最多三路持续补位和一次最终整图复审；
逐生图请求复审及主体模型调用仍为 0 次。视觉差异仍为 warning，技术完整性错误仍停止。

升级时更新服务的源码标签及 SHA-256，安装到新的版本目录，并对新作业启用。
旧作业保留原安装与完整运行目录；本版包含 alpha.5 之后的运行时兼容修复，
不能在执行中的旧目录替换代码或改写其运行时指纹。当前任务不能混用 `host-*` 与兼容 DAG 控制入口。
本仓库没有检查外部 Docker 服务的实际版本固定方式，也没有执行 Docker 部署验收。

下载 Release 五个附件，先校验 `SHA256SUMS`：

```sh
sha256sum -c SHA256SUMS
tar -xzf ui-layers-v0.1.0-alpha.6-source.tar.gz
cd ui-layers-v0.1.0-alpha.6
unzip ../ui-layers-v0.1.0-alpha.6-viewer.zip
python -m pip install -r game-ui-harnesses/ui-layer-harness/requirements.txt
python game-ui-harnesses/ui-layer-harness/ui_layer.py --version
```

查看器和 Python 依赖不变。源提交、源码/查看器摘要与验证范围在
`release-manifest.json`、`offline-regression.json` 和 `SHA256SUMS` 中绑定。
附件只取已提交公开源码及查看器构建产物，不含样本、会话、凭据或宿主私有配置。

## 本版变化

- 旧显式 amendment/merge 快照可按原合同检查；普通快照缺报告和插入未绑定纹理信息仍拒绝。
- 已独立审查的原图视觉纹理可自动进入合板输入，使用 board v6 确定性整数坐标映射。
  保留原审查及来源摘要，不追加审查；篡改映射、任意提示词覆盖和未审变体仍拒绝。
- 文档统一正式 `host-run` 入口和当前 v13 默认值，区分自动参考板、旧协议及可选修订工具。
- 11 份测试改为复用模块，发现次数从 1,333 降到 1,207，全部唯一测试 ID 保留。
- 修正 Windows 临时目录 8.3 短路径与规范长路径混用的测试根目录。
  在真实短路径环境复现旧失败，再检查全部 15 项已观察到的 Windows 失败；
  路径逃逸检查仍要求抛错，没有放宽运行时路径安全规则。

正式链路的规划、提示词、归位与打包行为保持上一轮成功样本对应的运行时实现。
新增内容不触发生成或自动重试。历史契约继续保留，审计见 [PROTOCOL-AUDIT](PROTOCOL-AUDIT.md)，
宿主循环见 [HOST-INTEGRATION](HOST-INTEGRATION.md)。

## 验证边界

离线证据包括前轮完整 UI 用例覆盖及失败后新源重验、此次 194 项定向 UI 回归、
28 项仓库检查（1 项平台跳过）、真实 Windows 短路径回归和发布归档烟雾检查。
各阶段、源码指纹和 CI 状态分别记录，不冒充一次全套单次通过。
本版没有新增真实生图；alpha.5 的有限样本验证保持原有范围。
快速 warning 终态仍待人工视觉验收，不保证任意复杂参考图自动还原。

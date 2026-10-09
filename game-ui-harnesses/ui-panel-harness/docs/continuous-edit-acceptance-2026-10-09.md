# 同一面板连续编辑：本地验收与单次真实复验准备

后续用户已授权并完成1次真实复验，结果通过、授权已消费，见[真实结果与边界](continuous-edit-real-results-2026-10-09.md)。下文保留本地验收及授权前准备事实；冻结文件与预演状态不回填。

## 已完成的本地验证

基础包原样取自既有真实声音编辑结果 `output/asset-usage-real-accepted-v1/E01/pixi/panel.bundle.json`，Bundle摘要 `524f399fe237d043992e407cd5ec12174a082b8059b904a19a15c2c3e176569e`。主音量/音乐创作默认50/40，保存试玩35/19，静音默认关闭但试玩开启；包含三个嵌入图标。本次不重绘或升级其旧主题，不作为Apple美术的新验收。

在同一个隔离Studio会话中用人工编写的响应执行：

1. 标题改为“音频偏好”，音乐默认30，其他不变。
2. 输入“把音量改成40”后先给出澄清；填写“主音量创作默认40，当前试玩值保留”不自动提交，再点击才修改。
3. 主音量先要求80，明确改口为45，同时音乐默认25。
4. 选中恢复按钮，仅改为“恢复声音”。

4次成功修改均使用上一版本的Spec和摘要；3个图标及其嵌入字节、布局、控件坐标、动作/绑定和试玩35/19/开启保持。重复第4步在本地提示已满足，不提交接口。第1步的过期方案不能应用到第4步。

逐次撤销恢复各自前一Spec，已用轮次仍为4/10。最终面板实际导出、重导入与刷新保留4轮及试玩值，会话撤销历史按既有设计清空。实际下载ZIP的32份文件通过独立CRC和摘要校验；file URL离线打开保留图标与试玩，恢复默认使用最终45/25/关闭，事件仍为panel.row3。无图库模型严格往返通过。

证据：

- `output/continuous-edit-browser-v2/browser-report.json`：13组PASS，5次程序编辑替身（含1次澄清），模型调用0、重试0、错误/外部/意外请求0。
- `output/continuous-edit-regression-v1.txt`：65/65对应回归PASS，涵盖模型事务、编辑预算、澄清、已满足提示及输入夹具。没有重复执行1383项全量回归。
- `output/continuous-edit-browser-v2/final.panel-delivery.zip`：ZIP摘要 `6aeb850120babc2b0f2a26b265fa7889108417c4f01ae2de4b718b65661c2a11`；最终Bundle摘要 `51be233dd275b3536787a23267346f04d6b22819e9e26f017fed7a7bf5919e99`。
- 桌面、390px和离线截图已查看；代码语法及diff空白检查通过。

首轮本地检查在记录NEEDS_INPUT结果时错误读取不存在的requestCheck.status，原 `output/continuous-edit-browser-v1/browser-report.json` FAIL保留。仅修正验收脚本使用可空记录后以新目录复核，没有改模型输出、生产规则或基础面板。

## 尚未验证的语义边界

改口与补充回答仍属于公共明确属性语法的未核对范围，requestCheck为NOT_CHECKED，semanticReview为NOT_RUN。程序响应能沿链正确应用，不证明真实模型一定正确理解纠正关系。这13组不能记成4次真实模型成功，也不增加原40个真实场景通过数。

本轮只新增本地验收脚本和文档；生产源码、4951服务与用户浏览器存档均未改动。原始真实包字节保持，没有推送GitHub或接入游戏。Unity只检查导出源包一致性，原生仍未验收。

## 单次真实编辑准备记录

计划：`output/continuous-edit-real-plan-v1/plan.json`。

SHA-256：`d4a2a0c777bed676a60fc475fbab71c089b9f9099f2c6789d2b293199acf8750`。

> 标题改为“音频偏好”。主音量默认值改为80，不对，主音量默认值改为45，以这次纠正为准。音乐默认值改为25。其他保持不变。

只使用Codex CLI / gpt-6-luna / xhigh，在上述既有真实编辑结果上追加1次真实编辑；生成0、自动重试0。只允许标题和两个创作默认值变化，主音量最终必须是45，不能留下被纠正的80；完整保持其他Spec、目录、布局、动作/绑定、图标及其字节和试玩35/19/开启。

这是旧真实编辑结果的下一步单次编辑，不是完整4步真实连续链，也不模拟用户旧会话历史。新隔离会话成功计1/10；后续若还需要真实步骤，必须根据实际结果重新冻结并授权。失败、结果不明、澄清、无修改或任一验收失败立即停止，不补调或修补模型方案。

准备证据：7项本地预检、6组预演浏览器检查及1份实际ZIP离线/无图库往返通过；22份输入与283份源码/协议/提示/锁定依赖冻结并复核。负例证明协议可接受的过时80、漏改音乐及额外按钮改名会被独立精确预期拒绝。错误授权摘要在登录与派发前拒绝，无派发标记、real-call目录或真实结果。

只读CLI登录检查保留受限环境NOT_CONFIRMED及宿主VISIBLE两份记录；没有检查网络或模型可用性，没有修改配置。当前模型调用0，授权状态REQUIRED_NOT_GRANTED。预演入口为 `output/continuous-edit-real-plan-v1/rehearsal-v1/index.html`，明确标注人工编写方案。

授权后run-once.mjs先核对完整冻结摘要，独占创建派发标记，只调用一次editWithCodex；保存运输程序提供的原草稿、方案、报告和回执，经独立精确检查后另存结果。build-review.mjs只重放保存结果，不调用模型。准备状态及历史证据不改写。

## 重现本地连续链

```sh
node scripts/check-continuous-edit-browser.mjs --workbench output/daily-studio-acceptance-v1/candidate-build --base output/asset-usage-real-accepted-v1/E01/pixi/panel.bundle.json --output output/my-continuous-edit-check
```

只启动本轮临时隔离服务，注入人工响应，不触碰日常4951；指定新的输出目录。基础包与构建依赖本机既有产物，不是无本地产物依赖的公开回归套件。

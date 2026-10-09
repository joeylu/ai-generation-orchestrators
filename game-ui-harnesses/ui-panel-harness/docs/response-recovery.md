# 响应读取失败后的保留与恢复

日常Studio已更新到 `babc6c317f10d4480b5826ece7ec66542387d27f9a0af1b41ff703f6babddf8d`；现有页面按更新提示刷新后生效。本轮补齐响应读取阶段断线的错误处理，以及损坏/过大返回内容的用户提示。

## 修复的具体问题

原客户端只在等待HTTP响应头时捕获网络TypeError。响应头已经到达、正文读到一半再断线时，原异常会直接穿过，未统一为连接中断；损坏JSON和超过大小上限的返回内容也可能显示技术错误码。

现在同一个单次请求的响应正文读取也纳入网络错误处理。断线统一显示连接中断；损坏内容提示“不完整或格式无法读取”；超过上限提示“返回内容过大”。提示明确结果未应用、原面板和试玩值保留、没有自动重新提交。取消/超时异常保持原类型，特定格式与大小拒绝码保持；没有增加请求、重试、超时机制或改变成功方案处理。

原面板、图标、试玩值、撤销历史及已用轮次继续受原事务规则保护。失败后仍可导出原结果、刷新恢复；只有用户新的手动点击才发起下一次请求。网络中断不证明服务或上游任务已经停止，也不证明该次计算没有发生；需要真实调用时仍按冻结计划和单次授权处理，不能自动补发。

## 2026-10-09 验证与证据

| 项目 | 实际结果 |
| --- | --- |
| 失败复现 | output/response-recovery-before-v1.txt：10项新增检查中4项正文读取网络故障失败，6项通过；原日志保留，这是程序回归而非模型失败 |
| 对应回归 | output/response-recovery-regression-v1.txt：89/89通过；包含10项新增检查及客户端、模型事务、服务、轮次和存储回归 |
| 正文错误边界 | 生成/编辑两条客户端路径均覆盖首块前及部分正文后TypeError、AbortError/TimeoutError、截断JSON和大小限制；一次调用、不重试，读取锁释放 |
| 原生HTTP断流 | 本机测试代理使用已有Studio服务提供页面，编辑响应实际发送200响应头及32字节正文后断开连接；只观察客户端自己的读取，得到32字节、未完成、TypeError；没有替换fetch结果或读取实现 |
| 页面检查 | output/response-recovery-browser-v2/browser-report.json：10组PASS，错误/外部/非预期请求0；已知断流网络报错单独记录，未当作页面成功异常忽略；此前v1通过报告保留 |
| 故障与后续编辑 | 3次明确注入的本机传输故障：断流、损坏JSON、过大内容；均保持原面板、试玩35/19/开启和0/10。第4次请求由用户操作替身手动点击触发，唯一程序编辑响应只改标题，记1/10；撤销不退轮次 |
| 原有素材与导出 | 复用已有真实声音结果f4fcaaff8c9149d3dfee0e09ddabe38e5637f51902098ad3fa9509f932af98d2；失败后的实际JSON下载与刷新保留全包；成功修改后的3个图标闭包与嵌入字节、动作/绑定及试玩值保持 |
| 日常更新 | output/response-recovery-daily-v1：20组更新前预演及20组实际4951检查；正常启动脚本、服务字节与候选构建一致，已有范围提示/同名选择/已满足提示和隔离存档恢复通过 |
| 实际ZIP | 日常检查下载1份29文件ZIP，CRC、逐文件摘要、Pixi/Unity源包一致、离线打开及无图库重导入通过；没有宣称Unity原生导入 |
| 历史来源 | 最近真实计划22份输入、11份原产物及3份更早真实包字节保持，真实上下文原样重算通过；未改写原草稿、方案、回执或历史报告 |

页面故障脚本的4次POST全在本机测试代理内受显式场景控制；3次故障不进入编辑适配器，1次进入明确注入的程序编辑器。真实模型调用0、自动模型重试0，不将其记为真实模型成功率。日常入口验收则拒绝所有POST，模型请求0。

最终汇总为 `output/response-recovery-daily-v1/acceptance.json`；`browser-followup-v2.json`补充记录最后一次更严格的图标字节检查与已知网络错误观察，不覆盖原v1报告。已查看桌面及390px提示截图，窄屏无水平溢出。本轮没有新的美术验收，截图使用历史真实结果的原样式。

本轮只改两份生产源码：客户端响应读取错误范围与Studio提示。既有公共协议、PanelSpec、编译器、导出、存储格式、最多10轮规则及其他Harness保持。原真实计划冻结源码相对当前有三份历史差异（还包含上一轮的属性范围提示），冻结仅作历史证据，所有既有真实调用授权已消费，不可复用。

更新前核对4951的原监听归属、正常启动命令、72a060构建及空闲状态，预演通过后仅替换该Studio，继续固定地址；最终active:false。所有页面与存档操作发生在隔离浏览器，没有访问或修改用户当前窗口及localStorage。未安装依赖、接入游戏或推送GitHub。真实提供方网络故障、Unity原生和游戏绑定未验收。

重现时使用新的输出目录；页面脚本固定读取上述既有真实声音包，不运行Codex：

```sh
node --test tests/workbench-response-recovery.test.mjs tests/workbench-codex-client.test.mjs tests/workbench-model.test.mjs tests/workbench-edit-budget.test.mjs tests/workbench-server.test.mjs tests/workbench-storage.test.mjs
node scripts/build-workbench.mjs --catalog examples/modern-menu.catalog.json --assets builtin --output output/my-response-recovery-studio
node scripts/check-response-recovery-browser.mjs --workbench output/my-response-recovery-studio --output output/my-response-recovery-browser
```

# 新版 Studio 与全16两轮验收计划

本页保留准备时的状态。用户随后批准并完成32次真实调用，原批次总体FAIL；结果与修复版4193入口见[执行记录](ordinal-stability-results-2026-10-06.md)。

状态：**LOCAL_PREPARATION_PASS_REAL_NOT_RUN**。新版本地 Studio 为 `http://127.0.0.1:4192/`，
入口8项检查通过；两轮真实生成均尚未运行，模型调用0。旧4191服务保留，其他Harness和真实Unity游戏工程未修改。

## 已完成的入口检查

新版使用 Context/Intent 0.7，通过既有真实画质 Bundle 验证导入、预览、滑条键盘操作、恢复默认，
以及需求/修改输入和按钮就绪。390×844检查页面横向溢出，未将它算作触摸或移动端视觉验收。
浏览器阻止所有非GET请求和外部HTTP请求；没有点击生成或修改，计算请求0。

启动程序核对前次181份已验收源码，并以同一启动环境检查CLI登录可见性。
仅继承系统现有代理到进程临时变量，未修改全局代理、登录状态或CLI配置。
本轮预检不提交模型请求，因此新的真实连接状况仍未验证。

入口检查首版因测试选择器错误而停止，修正测试后第二版8项PASS，首版记录保留；未修改生产运行时。
准备审计首版假定零调用的runs目录必定存在；服务按需建目录，因此读取报ENOENT。
审计改为允许目录不存在或为空，未创建虚构运行记录，随后通过。

## 冻结的真实验收范围

根计划摘要：`bdfd27b901fa4a613bcc5051e1d5721c1935c5d6e7f4b60df8fe00bfd5c47954`。
模型为 `gpt-6-luna / xhigh`；两轮各16条，**最多32次**。每条每轮仅一次，失败不自动重试，
剩余额度不分配给修复、额外探测或其他输入。每轮以最多4个独立请求有限并发完成；第一轮任一验收门禁失败，停止第二轮。

| 用例 | 面板 |
| --- | --- |
| eval-audio | 声音设置 |
| eval-graphics | 画质设置、双列分组 |
| eval-controls | 控制设置、小数滑条 |
| eval-accessibility | 无障碍设置、中文数值 |
| eval-notifications | 通知设置 |
| eval-language | 多语言原文下拉 |
| eval-main-menu | 主菜单、禁用继续按钮 |
| eval-pause | 暂停菜单 |
| eval-confirm | 删除确认 |
| eval-save | 存档管理、禁用保存按钮 |
| eval-character | 角色信息、双列分组 |
| eval-quest | 任务详情 |
| eval-inventory | 背包筛选、“仅收藏” |
| eval-shop | 商店筛选、口头更正默认值 |
| eval-room | 房间准备 |
| eval-advanced | 高级设置、长面板滚动 |

两轮使用相同的完整请求和独立业务断言，子计划分别冻结，真实结果不得跨轮或从旧样本替换。
新cohort继承原16类输入，仅角色输入改为明确引用标题“角色信息”；原歧义输入与失败记录保留。
此范围不包含所有可能的用户输入，也不新增连续修改链或原生引擎验收。

每轮依次检查全部16份真实返回的协议、业务语义、编译、离线Pixi交互与状态；
然后用同轮16份合格来源构建单列全组合、双列全组合、三设置横排、声音双实例和五来源组合，检查交互与隔离。
最后每份导出完整Pixi/Unity交付ZIP，独立校验CRC、文件SHA、大小和源Bundle一致性。
本轮计划不把ZIP字节一致性等同于逐份解包后的浏览器运行，也不把Unity导入工具包等同于原生导入通过。
浏览器、组合和交付检查均不额外调用模型。

## 准备证据与执行门禁

已核对207份源码、32份原生Intent 0.7响应schema、资源与构建摘要；
程序生成的16份期望规格及5种组合编译/结构验证通过。它们是夹具，不能算真实模型成功。
宿主环境预检通过，错误摘要在调用前被拒绝；根与两份子计划消费记录均不存在，真实运行目录尚未创建。

执行由[准备程序](../scripts/prepare-ordinal-stability.mjs)和[批次运行器](../scripts/run-ordinal-stability.mjs)负责，
运行器验证摘要、源码、schema、上下文和构建，然后做同环境登录/代理预检，再写一次性消费记录。
真实结果与失败状态由程序生成；Agent不手改报告，不重试可能已受理的请求。

- [冻结根计划](../output/ordinal-stability-plan-v1/ordinal-stability-plan.json)
- [完整16条请求与期望](../output/ordinal-stability-plan-v1/suite.json)
- [程序期望与组合夹具验证](../output/ordinal-stability-plan-v1/fixture-validation.json)
- [宿主预检与错误摘要拒绝报告](../output/ordinal-stability-preflight-v1/preflight-report.json)
- [新版Studio启动证据](../output/panel-studio-ordinal-live-v1/launch.json)
- [新版Studio入口8项检查](../output/panel-studio-ordinal-live-browser-v2/browser-report.json)
- [独立准备审计](../output/ordinal-stability-preparation-accepted-v1/acceptance.json)

原16类同轮13/16、总体FAIL与全16组合NOT_RUN保持；前次三真实样本3/3及109项检查只覆盖那三份来源。
新两轮只有实际全部通过后才能记录OBSERVED_TWO_ROUND_PASS；目前仍为PREPARED。
新原生Unity运行、Cocos/Godot/UE和人工视觉验收均NOT_RUN。

[仓库AGENTS.md](../../../AGENTS.md)要求：“A generation attempt requires one fresh, single-use authorization bound to an immutable plan digest.”
前次三次授权已经消费。本次批准完成新版入口启用和准备工作；新的32次计划需用户确认上述具体摘要与数量后执行。

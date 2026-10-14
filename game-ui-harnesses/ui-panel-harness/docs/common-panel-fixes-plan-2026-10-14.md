# 通用面板继续修复与37条真实复测计划

状态：用户已授权，37次真实复测已完成，授权已消费。37份交付通过318项浏览器检查，原23条失败口令本轮均能生成；原始失败记录继续保留。另有3处内容／流程问题经过独立离线修正，不能计成模型原始输出已正确。详见[本轮结果与验收](common-panel-fixes-results-2026-10-14.md)。不得再次执行下面的历史真实调用命令。

## 已完成的修复

- 新增独立目录 `modern-tab-headings`，主题版本0.23.0/0.23.1，标题策略concise-v4/visible-v4，编译器0.34.0。旧目录、主题与0.33编译行为保留；本轮没有切换日常Studio或覆盖既有发布。
- 自动模式隐藏页签内部单一内容组的标题、与页签重复的标题、纯按钮操作组标题，保留有区分作用的多个内容组。明确显示模式保留全部分组标题，语义标题字段与控件名称不删除。原装备G21与背包G59的重复标题已经在回放中消除。
- 当前原生schema区分普通内容区与纯按钮区；进一步按emit/reset-initial/submit拆分按钮参数约束：普通动作的两个目标列表为空；重置与提交要求对应列表非空，另一列表为空。返回后的实际目标类型、去重、业务及校验门仍照常检查。没有改写无效模型输出或自动重试。
- 诊断保留更多公开固定错误代码及允许的字段路径，包括控件尺寸、文字换行、页签、图片、弹窗等验证错误；未知路径、原始消息和被丢弃的值不进入诊断。旧失败没有可恢复的原生意图，不能从夹具复现推断这23项的真实失败原因。
- 新提示约束详情默认只读，普通大厅不自行扩展为多人房间；配合前一轮“自然按钮名、无宿主实现说明、未知原因保持中性”的要求。用户的每条原始短口令均保持不变。内容提示是否改善实际输出仍待真实模型验证。

## 离线证据

41份已保存真实方案分别采用自动精简与明确显示，共82份确定性重放，736项浏览器检查通过。所有页签的初始按钮可见性、主标题居中、交互、状态、重开、离线刷新与实际ZIP下载均检查；状态、动作、绑定、资源和非几何业务字段保持。按精简策略标题实际变化为G21、G59，其余模式变化由明确显示规则决定。

原23项失败原样保留；82份重放不是82次真实模型复测。Unity导出文档有离线验证，但本轮没有进入Unity原生引擎。

本地证据：

- `output/tab-heading-replay-v1`：版本化重放交付与来源指纹。
- `output/tab-heading-browser-v1/browser-report.json`：82份、736项、PASS。
- `output/tab-heading-review-v1/index.html`：此前版本／自动精简／明确显示的三栏实际截图，默认筛选标题变化；126张图片路径和筛选检查通过。
- `output/common-panel-fixes-contract-v1.log`：约束、诊断、标题和传输替身定向检查。
- `output/common-panel-fixes-batch-driver-v1.log`：旧64条和新37条完整驱动替身测试通过，模型调用0，发送提示及记录逐项一致。
- `output/common-panel-fixes-full-regression-v1.log`：1910/1910完整离线回归通过。

## 已执行的冻结计划

计划 `output/common-panel-fixes-plan-v1/input-adaptability-plan.json`，摘要：

`fea352a19cbe57d0e1b3647b118e1abebd247bcd7e13b3859f8eecc1d14b5ecd`

预览 `output/common-panel-fixes-plan-review-v1/index.html` 展示37条原始短口令、每条实际将发送的完整提示和评价依据，不展示程序夹具为模型结果。只读预检验证源码指纹、目录、schema、上下文、提示及登录状态，状态PREFLIGHT_PASS、claim未消费、模型调用0；预检不证明远程模型可用或远程schema已经接受。

| 选择依据 | 数量 | 案例 |
| --- | ---: | --- |
| 原始校验失败 | 23 | G03、G06、G17、G22、G27、G29、G30、G31、G33、G34、G35、G36、G38、G42、G47、G48、G49、G52、G54、G55、G57、G63、G64 |
| 尺寸与页签标题回归 | 8 | G02、G18、G21、G26、G41、G43、G44、G59 |
| 内容观察回归 | 5 | G09、G13、G20、G25、G45 |
| 明确设置要求回归 | 1 | G62 |

统一gpt-6-luna/xhigh，默认mint-light@0.23.0，编译器0.34.0，不注入skill摘录。37条独立调用上限，每条一次，串行，无自动重试；连接或回执不确定时停止剩余案例。本轮为新的独立复测计划，旧输出与失败继续保留。内容质量、澄清必要性和重复输入稳定性不由技术PASS认证。

根 `AGENTS.md` 要求：`A generation attempt requires one fresh, single-use authorization bound to an immutable plan digest.` 用户已对以上摘要授权，单次授权现已消费。以下仅记录本轮采用的历史命令，不能复跑真实模型调用。

```powershell
node scripts/input-adaptability.mjs run --prepared output/common-panel-fixes-plan-v1 --approve-plan fea352a19cbe57d0e1b3647b118e1abebd247bcd7e13b3859f8eecc1d14b5ecd --output output/common-panel-fixes-real-v1
node scripts/check-input-adaptability-browser.mjs --run output/common-panel-fixes-real-v1 --output output/common-panel-fixes-browser-v1
node scripts/summarize-input-adaptability.mjs --prepared output/common-panel-fixes-plan-v1 --run output/common-panel-fixes-real-v1 --browser output/common-panel-fixes-browser-v1 --output output/common-panel-fixes-audit-v1
node scripts/review-common-panel-fixes.mjs --prepared output/common-panel-fixes-plan-v1 --run output/common-panel-fixes-real-v1 --browser output/common-panel-fixes-browser-v1 --audit output/common-panel-fixes-audit-v1 --output output/common-panel-fixes-review-v2
```

本轮已经先完成原始审计，再保存批准时的提示源码副本并追加后续提示约束。新增约束不属于上述37次实测条件，真实模型效果尚未复验；没有新冻结计划与新授权时不再调用模型。

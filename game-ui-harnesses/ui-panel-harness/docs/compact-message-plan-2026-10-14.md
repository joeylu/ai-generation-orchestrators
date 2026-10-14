# 紧凑确认框：离线对照与真实复验计划

状态：用户批准的8次真实复验已完成，8份原始交付、0失败、0澄清、0未运行、0自动重试；73项浏览器、两类专项各8/8及390像素窄屏8/8通过，完整性审计PASS，详见[真实结果](compact-message-results-2026-10-14.md)。4份模型原始退出框均实际选用0.36紧凑排版，短问句及按钮组居中，预览高度292。授权已消费，不得再次运行生成命令；此前1960项离线回归、8份82项离线浏览器及压力证据独立保留，不算作模型复验。

## 排版规则与版本边界

上一轮[真实模型结果](panel-copy-fix-results-2026-10-14.md)已消除冗余行标签，但普通控件行高与靠右的按钮页脚仍带来较大留白。新增可选目录 `examples/modern-compact-message.catalog.json`，显式message.text@0.2.0增加messageLayout: compact-centered-v1、minHeight:24，采用编译器0.36.0。message.text@0.1.0继续0.35.0；普通行保持0.34.0。

规则只适用于单个普通消息分组：消息在前、无显示标签的动作在后，没有Tabs或图标。普通数据字段、多组、图标等组合继续既有排版，不依赖“确认”“提示”等词猜测用途。

- 正文使用实际换行高度，保留完整文字、非空语义label及明确段落。
- 不超过2个渲染行且无明确缩进／换行的短正文，根据Pixi实际字形宽度居中；长正文、段落、空行和缩进保持左对齐。Unity文档导出采用对应Text对齐方式，未执行Unity原生引擎。
- 按钮组按总宽度居中；过宽时按原顺序纵向居中，不截字、不修改动作、事件或按钮样式。明确按钮尺寸和固定框尺寸保留。
- 4份离线退出框额外明确采用“实际面板高度＋64画布边距”的派生预览尺寸；属于单独离线变体，原始Spec和交付保持不变。
- 旧0.35包逐份重新编译后的SHA-256与历史原包完全一致。新规则显式启用，日常Studio／SDK默认和既有发布未切换。

## 离线证据

程序从上一轮经审计的8份原始交付创建独立变体。4份只采用新消息配方及明确的预览高度调整，4份角色包完整保持；动作、绑定、保存状态和素材闭包均核对。新导出经过编译、运行时载入、Unity文档／交付结构、ZIP字节与摘要校验，不手改原始尝试日志、回执或交付。

4份短消息的实际字形中心误差均为0，按钮组中心误差均为0，正文到按钮间距37像素；完整问句和两个选择保留。退出每个选择分别从初始状态指针点击，角色页实际切换选择并发出一次事件；窄屏同样通过。原生截图绑定派生bundle摘要，截图前保存状态一致、事件为空。

压力样本明确标记为程序夹具：长中文、英文长词换行、段落及空行、普通金币标签、固定400高框、300宽按钮纵向布局、窄版两行问句、明确缩进，共8项。大画布用于边界验证，不作为默认设计效果，不当作真实模型成功。

原生前后对照页 `output/compact-message-review-v1/index.html` 在1600×1100和390×844检查通过：12张卡、16张图片、16个本地链接、2类筛选正常，无水平溢出及控制台错误。原生4份紧凑画布已查看，压力样本也保留独立图片和试玩。

Browser插件／browser skill在会话不可用，按frontend-testing-debugging后备路径使用已有本地Playwright／Edge，拦截外部网络，没有安装依赖。流程为原始／派生页载入保存状态→分别点击退出选择或切换角色→核对事件与文字→导出重开及刷新；页面身份、非空内容、错误覆盖层、控制台、截图和操作均核对。

本机记录：`output/compact-message-variants-v2`、最终 `output/compact-message-browser-v3`、`output/compact-message-stress-v2`、`output/compact-message-stress-browser-v1`、`output/compact-message-long-native-v1`、`output/compact-message-targeted-v4.log`、`output/compact-message-full-regression-v3.log`。对照页绑定的浏览器v2短正文检查通过，后续v3加入长正文适用边界；4份派生画布未变化。原批源字节在 `output/compact-message-source-snapshot-v1` 按16项明确清单保存，全部核对原批准SHA-256；历史审计是改动前的结论，不用改动后源文件冒充旧源指纹PASS。

失败记录保留：针对性v1有测试父节点定位和按钮样式字段设置错误。首次压力导出缺少夹具assumptions字段，v1输出保留，最终v2完整导出。主批浏览器v1因可选evidence为undefined无法保存规范JSON；修正、加入序列化回归后v2完成全部验收，没有改写v1。完整回归v1被默认沙箱拒绝本机回环测试端口；允许本机测试端口后v2的1959项全部通过。随后修正验收探针对正确左对齐长正文的错误排除，新增偏移拒绝回归，最终12项针对性、1960项完整回归及原生边界检查通过，模型运输均为替身。

## 下一轮真实复验

8条继续沿用上一轮短口令，不追加用户布局或控件清单：

| 用途 | 前三次原文 | 第四次改写 | 案例 |
| --- | --- | --- | --- |
| 角色选择回归 | 做个角色选择面板 | 弄个选角色界面 | S05、S13、S21、S29 |
| 紧凑退出确认 | 做个退出游戏确认框 | 做个退出确认弹窗 | S08、S16、S24、S32 |

三次同原文与一次改写是预先声明的独立样本，不是失败后的重试；不同ID和上下文摘要意味着完整提示不逐字相同。实际完整提示可在计划预览 `output/compact-message-plan-review-v2/index.html` 查看，不将驱动夹具发送给模型。

最终冻结计划 `output/compact-message-plan-v2/input-adaptability-plan.json`，摘要：

`93588bf8d888ddf335dc21facb8cc2a83c2b7e7e7b5c76b2598dd3c831456e38`

冻结439项源文件、全部案例上下文、schema和实际提示；批准前PREFLIGHT_PASS、claim UNCONSUMED、真实调用0，执行时已创建独立消费记录。模型gpt-6-luna／xhigh，串行最多8次，每项一次、自动重试0；不注入skill，不提供角色美术或图片库。

普通交付及原操作专项仍需通过，再要求文案专项中的原生紧凑布局观察：明确新配方与支持范围、适用短问句实际字形居中、长正文及段落保持声明的左边缘、按钮组居中、文字到动作间距有界。无交付、澄清、未运行均保留，不从分母删除。角色占位仍只做中性静态预览。确定完成的独立校验失败保留并继续；传输或回执不确定立即停止剩余项，不补发。有限样本不证明所有游戏口令可靠。

先前未批准的plan-v1在修正长正文验收探针前冻结，仅保留准备记录，未创建消费记录或调用模型；它已被v2替代，旧摘要不得执行。最终计划页在1600×1100和390×844通过，8张卡、2类筛选、无模型结果图片、无水平溢出。

## 新授权

根[AGENTS.md](../../../AGENTS.md)规定：`A generation attempt requires one fresh, single-use authorization bound to an immutable plan digest.` 用户已明确批准以上最终摘要，本次消费记录已创建。不得再次运行生成命令；传输不确定时同样不能补发。

以下为本次命令记录，生成命令已消费，不得再次执行；后续命令只读取原始交付：

```powershell
node scripts/input-adaptability.mjs run --prepared output/compact-message-plan-v2 --approve-plan 93588bf8d888ddf335dc21facb8cc2a83c2b7e7e7b5c76b2598dd3c831456e38 --output output/compact-message-real-v1
node scripts/check-input-adaptability-browser.mjs --run output/compact-message-real-v1 --output output/compact-message-real-browser-v1
node scripts/summarize-input-adaptability.mjs --prepared output/compact-message-plan-v2 --run output/compact-message-real-v1 --browser output/compact-message-real-browser-v1 --output output/compact-message-real-audit-v1
node scripts/review-common-game-panels.mjs --prepared output/compact-message-plan-v2 --run output/compact-message-real-v1 --browser output/compact-message-real-browser-v1 --output output/compact-message-real-review-v1
```

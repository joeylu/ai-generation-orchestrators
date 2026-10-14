# 角色占位与退出确认：8次专项真实复验计划

状态：用户已批准，8次真实调用已完成，授权已消费。8份原始交付、0失败、0澄清、0自动重试；72项浏览器检查及专项8/8通过，另有两类内容审阅问题。详见[本轮结果](panel-stability-fix-results-2026-10-14.md)。以下记录批准前冻结条件，生成命令不得再次运行。上一轮原失败、原交付和5份离线修正保持原记录。

## 输入与范围

| 用途 | 前三轮原口令 | 第四轮改写 | 历史案例ID |
| --- | --- | --- | --- |
| 角色选择 | 做个角色选择面板 | 弄个选角色界面 | S05、S13、S21、S29 |
| 退出确认 | 做个退出游戏确认框 | 做个退出确认弹窗 | S08、S16、S24、S32 |

按角色／退出交错执行，每个案例独立调用一次，最多8次。每种用途的三个重复是预先声明的样本，不是失败后补发。保留上一轮案例ID、短口令和开放需求的评价数据，用户输入不追加控件、尺寸或布局细节。重复原文相同，案例ID和上下文摘要不同，不声称完整提示逐字相同。

来源是[上一轮32次真实测试](panel-stability-results-2026-10-14.md)：1次角色占位标签无法放入128像素图片槽，4份退出确认的初始指针点击受浮动Dialog遮挡。5份后续离线修正通过不等于新提示已被真实模型验证。

## 冻结条件

计划 `output/panel-stability-fix-plan-v1/input-adaptability-plan.json`，摘要：

`20810fdd77f126e988111a0afd2adea73e9f65e2826ff053b2ad274586cac5fa`

预览 `output/panel-stability-fix-plan-review-v1/index.html`，展示8条原文、真实完整提示及专项验收状态，尚无模型结果图片。

- 模型gpt-6-luna、xhigh，串行，最多8次，每项一次，自动重试0。
- 编译器0.34.0、modern-mint-light@0.23.0，当前草稿提示，不注入skill摘录。
- 当前提示引导确认问题使用Text和两个普通Button；说明Dialog只有一个关闭操作，modal:false仍可能视觉遮挡外部按钮。
- 未提供角色美术时保留标注占位，默认图片宽度fill以容纳标签。用户明确要求固定尺寸仍优先。
- 不提供用户美术或测试图片库，不调用图片、视频生成，不连接真实游戏业务服务。
- 冻结431项源码及相关目录文件，另冻结每项请求、上下文、schema和提示指纹。批准前预检PREFLIGHT_PASS、claim为UNCONSUMED；本轮已生成单次分发claim，授权现已消费。
- 已完成的独立语义／校验失败保留，可以继续原计划下一项；传输或回执不确定时停止剩余项，不自动补发。

## 验收

技术状态、专项验收、澄清和人工内容审阅分别记录。无交付的失败、澄清或未运行项计入专项未通过，不能从分母中消失；澄清必要性仍单独审阅。

角色页需要有效交付、浏览器检查通过、可用的选择控件。若选用Image，其未提供美术的source必须为空，标签宽高必须先通过编译器测量。图片不是必选控件，不固定模型的选项文案或唯一布局；检查不认证角色美术完整或选择后的游戏逻辑完成。

退出页需要至少两个独立事件的普通选择按钮。每个按钮都从重新加载后的初始保存状态独立用指针点击，核对可见、启用、可达，且只产生目标事件一次。缺少选择、事件重复、遮挡、额外事件或未测到流程均不通过；不在检查中关闭Dialog后冒充初始可操作，也不修补原输出。

浏览器报告保留常规status和独立focusedAcceptance；本计划的汇总审计须同时满足专项PASS，不能只凭ZIP导出与常规PASS认定修复。文案、用途、示例诚实性、视觉质量和澄清必要性仍需审阅。三个重复只是有限抽样，不证明所有输入可靠。

## 离线验证

- 28项针对性回归通过，验证8条案例沿用原文、重复提示仅绑定字段不同、无测试图片库、完整替身批次一次性调用与错误摘要／重复分发拒绝。
- 1936/1936完整离线回归通过；测试没有调用真实模型。
- 8份程序替身交付通过72项浏览器检查，专项8/8通过，错误0。其kind明确为OFFLINE_BATCH_DRIVER_NOT_MODEL_RESULTS，不能当成模型成功。
- 旧S08原交付的实际初始点击被专项判失败；离线修正S08与原S13占位选择分别通过相应有限检查。产物指纹、实际事件和保存状态记录在离线报告中，不是新模型生成结果。
- 预览在1440×1000及390×844通过：8张卡、2类筛选、完整提示可展开、摘要可见、无水平溢出、模型结果图片0。

本机证据：`output/panel-stability-fix-targeted-v1.log`、`output/panel-stability-fix-regression-v1.log`、`output/panel-stability-fix-offline-v2/offline-report.json`、`output/panel-stability-fix-fixture-browser-v2/browser-report.json`。v1浏览器预演受沙箱启动限制而未执行，失败日志保留；v2只放开本地浏览器启动，继续拦截外部网络，未增加模型调用。

## 后续执行

根[AGENTS.md](../../../AGENTS.md)要求：`A generation attempt requires one fresh, single-use authorization bound to an immutable plan digest.` 用户已批准以上摘要，8次真实执行已完成，授权已消费。

以下保留原一次性执行及验收命令，不得再次分发生成：

```powershell
node scripts/input-adaptability.mjs run --prepared output/panel-stability-fix-plan-v1 --approve-plan 20810fdd77f126e988111a0afd2adea73e9f65e2826ff053b2ad274586cac5fa --output output/panel-stability-fix-real-v1
node scripts/check-input-adaptability-browser.mjs --run output/panel-stability-fix-real-v1 --output output/panel-stability-fix-browser-v1
node scripts/summarize-input-adaptability.mjs --prepared output/panel-stability-fix-plan-v1 --run output/panel-stability-fix-real-v1 --browser output/panel-stability-fix-browser-v1 --output output/panel-stability-fix-audit-v1
node scripts/review-common-game-panels.mjs --prepared output/panel-stability-fix-plan-v1 --run output/panel-stability-fix-real-v1 --browser output/panel-stability-fix-browser-v1 --output output/panel-stability-fix-review-v1
```

保留原始模型输出再审阅，不自动把离线补丁算成复验通过。日常Studio／SDK默认及既有发布仍未切换，本计划不包括Unity原生引擎验证。

# 正文标签与静态角色占位：离线修复及真实复验计划

状态：用户批准的8次真实复验已完成，8份原始交付、0失败、0澄清、0未运行、0自动重试；74项浏览器、两类专项各8/8及390像素窄屏8/8通过，完整性审计PASS，详见[真实结果](panel-copy-fix-results-2026-10-14.md)。授权已消费，生成命令不得再次执行。先前1947项离线回归与8份80项离线浏览器证据仍独立保留，不当作模型结果。

## 规则与实现

普通Text行要求非空语义label，不能靠输出空字符串、空格或删除正文隐藏“确认提示”。新增可选目录 `examples/modern-message-copy.catalog.json`，保留既有主题和普通Text配方，并添加 `message.text@0.1.0`：`labelDisplay: hidden`。

该配方只在纯Text／Button消息分组中隐藏行标签的显示，保留Spec中的非空label和完整正文；不猜测“提示”等标签词，不隐藏其他行标签。普通字段继续用 `settings.text`。明确的只读标签／内容字面配对在原生解释边界不能选择隐藏配方，其他自然语言表达仍需要模型理解和审阅；这不是完整语言语义判断器。

选中message.text的PanelSpec 0.16、heading-v4采用编译器0.35.0，其他原布局继续0.34.0。Pixi、预览、Studio渲染及Unity文档导出识别新版本；正文换行会在运行时核对无标签排版的真实坐标，篡改坐标仍拒绝。`attachPanelSession`增加可选第六个catalog参数，标准适配器传入已验证目录；旧接口调用保持兼容。

角色图片仍是静态占位。未提供美术、未支持动态关联时，提示引导使用不包含当前选择名字的中性占位文字，保留用户明确文案，不伪称动态立绘已实现。单占位图片与选择名字匹配的探针仅给出有界审阅警告；多图角色卡、过短名字或其他表达不能由它全面判定。

## 明确离线修正

来源为[上一轮8次真实复验](panel-stability-fix-results-2026-10-14.md)。4份退出框只修改正文行配方，标签、问句、按钮和事件仍保留；S21用公开set-row-label补丁将角色占位改为“角色立绘占位”。其余3份样本保留原Spec、目录、状态及bundle摘要。

8份独立离线交付均由程序验证、导出并核对ZIP字节与校验和。所有保存字段、按钮动作、绑定和素材闭包保持一致；原模型日志、回执、失败／成功状态及交付均未修改。

- 10项针对性回归通过：原故障复现、只隐藏显式配方标签、完整正文及段落保留、普通数据标签可见、旧bundle回放、原生明确标签保护、命名占位警告与公开补丁、运行时换行坐标正确及篡改拒绝。
- 最终完整离线回归1947/1947通过，包含旧64／37／32／8及新8条完整替身驱动；未调用真实模型。
- 8份离线交付的80项常规浏览器检查、初始选择专项8/8、正文／占位专项8/8通过，errors为空。
- 实际选择岩卫后，S21仍显示中性“角色立绘占位”，不再错误显示风语；保存选择与事件正常。
- 前后对照页1600×1100及390×844通过，5份变化、10张原生图片、13个本地链接及2类筛选正常，无水平溢出。新的计划页8张卡、无模型结果图片、无水平溢出。

Browser插件／browser skill在此会话不可用；使用已有本地Playwright／Edge，拦截外部网络，未安装新依赖。原始页→载入保存状态→分别点击退出选择／切换角色→核对事件与文案。页面身份、非空内容、无错误覆盖层、控制台、截图和关键操作均核对。

第一份离线浏览器报告有2份加载失败，定位为换行校验仍假定存在标签带；修正运行时并新增篡改回归后重新导出到v2，8份全部通过。v1失败记录保留，没有更改其状态。开发期间针对性测试设置错误及旧可选目录调用兼容失败也保留日志，最终回归通过后才冻结新计划。

本机证据：`output/panel-copy-reviewed-variants-v2`、`output/panel-copy-reviewed-browser-v2`、`output/panel-copy-core-targeted-v5.log`、`output/panel-copy-full-regression-v3.log`、`output/panel-copy-review-v1/index.html`。后者是明确离线前后对照，新增模型0；不能当作真实复验结果。

历史源字节分别保存在 `output/panel-copy-source-snapshot-v1`、`output/panel-copy-audit-source-snapshot-v1`、`output/panel-copy-state-source-snapshot-v1`，每项核对上一轮批准计划中的SHA-256。历史审计是修改前的结果，不用改变后的源码重新冒充其源指纹PASS。

## 下一轮真实输入

| 用途 | 前三轮原口令 | 第四轮改写 | 案例 |
| --- | --- | --- | --- |
| 角色选择 | 做个角色选择面板 | 弄个选角色界面 | S05、S13、S21、S29 |
| 退出确认 | 做个退出游戏确认框 | 做个退出确认弹窗 | S08、S16、S24、S32 |

8条均保持原用户短口令，不追加布局、控件、主题或尺寸。3次重复与1条改写是预先声明的独立样本，不是失败后重试；每个案例有独立ID，完整提示中的绑定摘要不同，不能称为完整提示逐字相同。

计划 `output/panel-copy-plan-v1/input-adaptability-plan.json`，摘要：

`4e3419e8a82b46b362ec0c4ec3a78d76e827935182703dd6f5e61bd5ae353311`

预览 `output/panel-copy-plan-review-v1/index.html`，展示全部原文与实际完整提示。冻结435项源文件及所有案例上下文、schema和提示；批准前PREFLIGHT_PASS、claim UNCONSUMED，执行时创建独立消费记录。

- 模型gpt-6-luna、xhigh，串行，最多8次，每项一次，自动重试0。
- 当前新目录、草稿优先；消息正文使用0.35配方，其他支持行继续0.34；不注入skill，不提供图片库或用户美术。
- 确定完成的独立校验失败保留并继续下一项；传输或回执不确定时立即停止剩余项，不补发。
- 无交付、未运行和澄清不从专项分母消失，澄清必要性单独审阅。原初始按钮／占位尺寸判据继续保留，再要求正文隐藏显示标签与中性静态占位判据通过。名字匹配启发式命中要求审阅，不能冒充完整语义正确。
- 不执行真实游戏服务或Unity原生引擎；有限样本不能证明所有游戏输入可靠。日常Studio／SDK默认及既有发布尚未切换。

## 授权与执行

根[AGENTS.md](../../../AGENTS.md)要求：`A generation attempt requires one fresh, single-use authorization bound to an immutable plan digest.` 用户已明确批准以上新摘要。本计划授权已消费，生成命令不得再次执行；传输不确定时同样不能补发。

首次启动的自动审批审核超时，进程没有启动；再次预检仍为UNCONSUMED、真实调用0。依据工具允许仅重试一次启动，随后进程启动并创建消费记录。这是进程启动重试，不是provider请求重试。

以下为本次执行命令记录，其中生成命令已消费，不得再次运行；其他命令只读取产物：

```powershell
node scripts/input-adaptability.mjs run --prepared output/panel-copy-plan-v1 --approve-plan 4e3419e8a82b46b362ec0c4ec3a78d76e827935182703dd6f5e61bd5ae353311 --output output/panel-copy-real-v1
node scripts/check-input-adaptability-browser.mjs --run output/panel-copy-real-v1 --output output/panel-copy-browser-v1
node scripts/summarize-input-adaptability.mjs --prepared output/panel-copy-plan-v1 --run output/panel-copy-real-v1 --browser output/panel-copy-browser-v1 --output output/panel-copy-audit-v1
node scripts/review-common-game-panels.mjs --prepared output/panel-copy-plan-v1 --run output/panel-copy-real-v1 --browser output/panel-copy-browser-v1 --output output/panel-copy-real-review-v1
```

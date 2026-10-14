# 32条简短口令重复与改写测试计划

状态：用户已批准，本轮32次真实调用已完成，授权已消费。31份原始交付、1次编译失败、0澄清、0自动重试；另发现4份退出确认的初始操作遮挡。详见[本轮结果与离线修正](panel-stability-results-2026-10-14.md)。下列条件记录生成时的冻结状态，不得再次运行历史真实命令。

## 范围与输入

8类面板，每类同一句短口令独立生成3次，再测1条口语改写，最多32次。按第一轮8类、第二轮8类、第三轮8类、最后8条改写交错执行。每个案例有独立ID和单独一次调用；它们是预先声明的重复样本，不是失败后重试。

| 面板 | 前三轮原文 | 第四轮口语改写 |
| --- | --- | --- |
| 设置 | 帮我做个设置面板 | 设置页来一个 |
| 暂停 | 做个暂停面板 | 弄个暂停菜单 |
| 背包 | 做个背包面板 | 整个背包页 |
| 大厅 | 做个游戏大厅 | 游戏大厅来一个 |
| 角色选择 | 做个角色选择面板 | 弄个选角色界面 |
| 邮件详情 | 做个邮件详情面板 | 做个邮件阅读页 |
| 登录 | 做个游戏登录面板 | 弄个登录页 |
| 退出确认 | 做个退出游戏确认框 | 做个退出确认弹窗 |

所有用户输入不超过20字，没有追加主题、控件清单、尺寸或详细布局。重复样本保持自然语言文字一致，但案例ID、请求摘要、上下文摘要以及schema中的对应绑定不同；不能称为完整提示逐字相同。离线检查已验证，除此之外各组前三次提示保持一致。

## 冻结条件

计划 `output/panel-stability-plan-v2/input-adaptability-plan.json`，摘要：

`56c0c71b17fdbf0919d4334eadef2834511b180fe369aec602279e565b4df5f0`

预览 `output/panel-stability-plan-review-v2/index.html`，逐条展示原文、真实会发送的完整提示与评价依据，不展示程序夹具为模型生成结果。

- 模型gpt-6-luna、xhigh，串行；每个冻结案例一次，最多32次，自动重试0。
- 主题mint-light@0.23.0、编译器0.34.0、草稿优先；不注入skill摘录。
- 使用37条复测之后的提示修正，包含表单submit、确认／取消、文案与操作一致、单游戏大厅等约束；此次新增凭据输入默认空且必填、没有角色美术时使用占位的引导。效果等待本轮真实测试。
- 不提供用户角色图片，也不注入公共测试纹理库；不会调用图片或视频生成。不能根据占位认定美术已经完成。
- 冻结429项源码、目录、schema、上下文与提示指纹；预检PREFLIGHT_PASS，claim为UNCONSUMED。
- 任一调用连接或回执不确定时停止剩余项，不补发。已完成的独立校验失败如实记录，可以继续下一个原计划案例。

## 验收与归因

技术交付、澄清、校验失败、未运行和内容／功能观察分别记录。生成成功仍不等于用途正确，不把离线补丁或替身交付混入真实统计。

已知缺陷观察会标记：登录绕过表单或遗漏输入、凭据默认非空、模态层阻挡确认按钮、确认／取消共用事件、邮件正文指向不存在的附件操作、大厅疑似多游戏目录、测试纹理用作角色美术。结构确定的错误与文案启发式提示分别标记，启发式可能误报或漏报；没有命中只表示未发现这些已知问题。未识别出常规表单或确认结构时要求人工审阅，不擅自判定唯一布局。

实际交付进入离线浏览器，记录所有页签初始状态、标题和按钮裁切、下载校验、控件事件、状态重开与刷新。登录如存在可识别的输入表单，进一步测试空输入、部分必填项、空格与有效输入，并核对提交字段；退出各按钮分别从重新加载后的初始确认状态测试，检查目标事件确实发出。原始交付不在检查中修补。

按每类的三个重复样本和一条改写分别汇总生成结果、已知问题及实际流程观察；样例数据或布局不同不自动判错。用途、无冗余标题、示例诚实性、文案适合度和澄清必要性仍需审阅。3次重复仅是初步抽样，不推断所有口令的可靠性，不强求独立输出逐像素一致。

## 离线验证

- 32条新批次及旧64／37条完整驱动均使用不可执行的程序替身验证。发送提示与冻结文件逐项一致，每个案例仅一次；同一已消费的替身计划拒绝再次分发。真实模型调用0。
- 8份允许移植的公开Spec回归夹具识别5种原始问题，并区分3份离线修正版；夹具不含provider、凭据或私有运行状态。
- 新浏览器探针在保存的真实旧样本和修正版上执行4组：识别空输入登录和受阻退出两个问题，2份修正版无这些问题，控制台错误0。此为旧产物离线检查，新增模型调用0。
- 最终完整离线回归1922/1922通过；没有连接真实模型服务。
- 32份程序替身交付通过316项离线浏览器检查，包含4组登录和4组退出的实际流程观察。这验证验收程序可运行，不代表模型生成成功。
- 预览页1440×1000与390×844检查通过：32张案例卡、8类筛选、完整提示展开、摘要可见，无水平溢出；页面不展示任何模型结果图片。

本机证据：`output/panel-stability-driver-v1.log`、`output/panel-stability-flow-driver-v1/flow-driver.json`、`output/panel-stability-full-regression-v1.log`、`output/panel-stability-plan-browser-v2/plan-browser.json`。32份替身浏览器预演单独存于 `output/panel-stability-fixture-browser-v1`，其结果不代表模型测试。

第一份计划v1摘要为 `7bbc5a0ec0e19d3f3278bdc6c9c5903942f3df192ba6ba90d011a1fb2c4839a0`，真实调用0、未消费。其预览在窄屏上摘要文本溢出；修正预览生成器CSS后，保留v1、重新冻结本页所列v2。两份计划的32条请求、schema、上下文、提示和案例文件指纹相同，源码差异仅为预览生成器的摘要换行样式。当前只应批准v2；v1不能用于执行。

## 后续执行

根 `AGENTS.md` 要求：`A generation attempt requires one fresh, single-use authorization bound to an immutable plan digest.` 用户已批准本计划，32次调用已执行且单次授权已消费；以下仅是历史执行命令，不得复跑。旧37次授权同样不能复用。

```powershell
node scripts/input-adaptability.mjs run --prepared output/panel-stability-plan-v2 --approve-plan 56c0c71b17fdbf0919d4334eadef2834511b180fe369aec602279e565b4df5f0 --output output/panel-stability-real-v1
node scripts/check-input-adaptability-browser.mjs --run output/panel-stability-real-v1 --output output/panel-stability-browser-v1
node scripts/summarize-input-adaptability.mjs --prepared output/panel-stability-plan-v2 --run output/panel-stability-real-v1 --browser output/panel-stability-browser-v1 --output output/panel-stability-audit-v1
node scripts/review-common-game-panels.mjs --prepared output/panel-stability-plan-v2 --run output/panel-stability-real-v1 --browser output/panel-stability-browser-v1 --output output/panel-stability-review-v1
```

本轮已先完成全批原始审计，再保存被修改源码的批准时指纹副本、补充提示并生成明确的离线修正版；修正与原始结果分别记录。日常Studio／SDK默认和既有发布未更新。浏览器仅验证本地UI和宿主事件，不执行真实认证、购买或退出游戏；Unity原生引擎本轮不在验收范围。

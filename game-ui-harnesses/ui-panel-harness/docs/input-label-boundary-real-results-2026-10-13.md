# 名称边界修复后的真实模型测试

2026-10-13，用户批准计划后执行8次真实`gpt-6-luna / xhigh`调用，每项一次，自动重试0，未执行0。直接生成正确7项，错误澄清1项，整批FAIL。不能把NEEDS_INPUT一概算作合理澄清或修复成功。

冻结计划SHA-256：`a6d1abd4854a9eac9b8c2455ccdbcdcd5d036d7432fecab08f360d317bd45ec3`，授权已消费。冻结源码、计划、生产回执及实际ZIP摘要核对通过。

| 案例 | 真实结果 |
| --- | --- |
| R01 原G10原文 | 直接生成正确，角色名与验证纹理正确 |
| R02 明确引号名称 | 直接生成正确，角色名单与验证纹理图片完整保留 |
| R03 玩家名口语变体 | NEEDS_INPUT，但澄清原因错误，业务FAIL |
| R04 字面Dialog/List | 直接生成正确，无错误组件要求 |
| R05 明确取消List | 直接生成正确，仅保留CheckBox |
| R06 全16种组件 | 直接生成正确，实际交互通过 |
| R07 64项列表 | 直接生成正确，默认尺寸及末项滚动通过 |
| R08 高1024弹窗 | 直接生成正确，打开关闭及焦点恢复通过 |

R03模型原生输出就已经是panel:null、unresolved:q0：

> 当前可用的 input 行字段无法表达“必填、最少2、最多12”校验。是否允许省略这些校验并生成面板？

这不是名称边界校验产生的问题。冻结的`R03.schema.json`中，input行明确提供`required`、`minLength`、`maxLength`，程序也支持这些属性。模型错误判断已支持的能力，不应要求用户省略已有需求。没有自动回答、删减需求或追加调用。

因此本轮既没有产生错误名称交付，也没有真实触发名称边界拦截；拦截证据仍是此前针对原始错误意图的确定性重放。本轮不能证明该口语请求已经能稳定直接生成。

## 实际交付验收

7份成功交付，47项浏览器检查全部通过，页面错误0。覆盖实际ZIP下载摘要、初始状态、各组件键盘交互、列表末项揭示、模态弹窗焦点、宿主状态、重新打开及离线重载。本批未执行Unity原生验收。

首次离线浏览器在沙箱内启动Edge时退出，尚未检查任何面板，记录保留在`output/input-label-boundary-real-browser-v1`。同一脚本和交付包在沙箱外完成检查，记录为v2；这不是模型重试。

- 完整审计（本地生成产物：`../output/input-label-boundary-real-audit-v1/index.html`，不随源码提交）：整体FAIL，业务7/8、浏览器PASS，原始证据未改写。
- 7份实际交付与下载（本地生成产物：`../output/input-label-boundary-real-browser-v2/index.html`，不随源码提交）：47项检查通过，报告为同目录`browser-report.json`。
- 真实结果：`output/input-label-boundary-real-v1/input-adaptability-report.json`。
- 冻结计划：`output/input-label-boundary-real-plan-v1/input-adaptability-plan.json`。

当前判断：16种组件生成与交付链路通过本批对照，但模型对输入校验能力的理解仍有错误。SDK保持未发布候选。后续应检查能力提示与原生schema的表达一致性，并将该错误澄清纳入固定评测；新的真实调用需另行冻结和授权。本报告不修改源码行为或历史成绩。

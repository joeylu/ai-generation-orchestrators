# 选中控件时的范围冲突提示

选中“恢复默认”后输入`这个按钮文字改为“仅恢复声音”，标题改为“设置”，其他不变。`，不能只改按钮就让用户以为整句完成。Studio现在在提交前检查明确的范围冲突，指出原文中超出范围的要求，提示取消选择或调整描述；保留原文、选择、面板、试玩值和轮次，不调用编辑接口，不产生模型方案或成功记录。

后续[日常Studio更新已完成](daily-studio-scope-update-2026-10-09.md)，当时72a060构建的20组实际服务检查及ZIP离线/存档恢复通过，模型0；当前已进入[响应读取故障更新](response-recovery.md)的babc6c构建，范围提示保持。以下首次实施记录保留。

取消选择仅清理目标与提示，不自动提交。用户再次点击“修改面板”才处理完整请求。如果原文使用“这个按钮”，取消选择后仍须明确目标，原有澄清规则继续生效。

## 本地检查的范围

`selectedEditScopeConflicts`仅服务于Studio的EditContext 0.14 / explicit-properties-v4提交前提示。从原文、当前Spec和目录重新计算，不信任缓存的requestChecks。它复用已有完整子句语法，分别带选择与不带选择检查，再按selected-row-v1能力排除所选行及其绑定字段允许的操作；没有新增自然语言解析协议或改写原文。

能够识别的明确范围冲突包括标题、标题字号、主题/指定颜色、面板几何，以及精确指向其他按钮文案、字号或绑定默认值的要求。两组同名按钮分别改名、却只选择其中一组，也会整句停在本地。具体超范围要求即使与未知描述混合也提示；不会自动取消选择、移动目标或先应用允许的部分。

未知描述、未定位名称、否定、改口、示例、重复冲突等仍沿用原处理流程。引号内的文案是字面文字，不能因含“标题”或尺寸描述而误拦截。旧上下文策略与未选择请求保持原行为；只指定所选控件的合法编辑仍可提交。

这是Studio提交前辅助，不是公共方案语义校验升级。独立程序夹具确认：原公共校验对“选中按钮改名＋改标题”的部分方案仍可返回READY_TO_APPLY，标题处于未核对状态；新Studio预检会在调用前拦截这类明确冲突。高级导出/导入及直接API调用不新增此自然语言保护，公共范围门仍独立拒绝实际越界操作。不能宣称所有混合输入、纠正语义或部分完成问题已经覆盖。

## 2026-10-09 验证

| 项目 | 结果与证据 |
| --- | --- |
| 对应回归 | output/selected-edit-scope-regression-v1.txt：128/128通过；包含10项新增范围检查与原选择、同名文案、已满足提示、澄清、状态/轮次及输入覆盖回归，未重复无关全量检查 |
| 独立构建 | output/selected-edit-scope-studio-v1：72a060551b299e29dee810150cbf177ffb7a5c18e07d927773306136acd4a6a9；沿用modern-menu和12个内置素材 |
| 实际页面 | output/selected-edit-scope-browser-v1/browser-report.json：41组PASS；15次明确注入的程序编辑响应、真实模型0；页面错误/外部/意外请求0 |
| 新页面操作 | 改名＋标题/宽度、其他控件默认值、两个精确分组目标、明确冲突夹带未知描述均不提交；重复点击保持；改描述清理提示；390px可见取消选择且无水平溢出 |
| 恢复合法操作 | 调整为所选控件请求后仅提交一次；取消选择保留完整原文、不自动提交，再次点击同时应用标题和按钮文案；其他动作/绑定与试玩35/81保持；撤销恢复原Spec，4/10已用轮次不退 |
| 历史兼容 | output/selected-edit-scope-compatibility-v2/audit.json：9份保存上下文原样重算、4份真实包严格重编译；最近真实计划22份输入、11份原产物和3份更早真实包字节保持 |
| 缺口复现 | compatibility-v2/authored-partial-reproduction.json：明确标记程序作者构造的部分方案；公共检查边界与Studio预检分别记录，模型0 |

已查看桌面及390px实际页面截图。本轮只改两份生产源码，扩展既有浏览器检查并新增一个测试文件；不修改PanelSpec、公共上下文/方案的摘要规则、编译器、样式、导出或存储格式。当前旧真实计划冻结的源码与新版本有两份生产文件差异，冻结仍为历史证据，不能当作新版本计划或复用已消费授权。

首次来源审计v1错误地预期冻结清单包含浏览器脚本；实际清单仅记录两份生产源码变化。保留v1脚本与failure.txt，v2修正审计预期后通过。没有改写模型输出、原回执或历史报告，也没有模型失败或重试。

功能首次实施时，日常4951仍运行a1881c249ab3cfc2b8fb85551b149cd0d6f4bde6ce0299fe433fab55b21abac7，当时未重启或替换该服务，未操作用户浏览器存档。新提示仅完成独立构建验证。该阶段真实模型、美术、Unity原生、游戏接入及ZIP验收未执行；未推送GitHub。后续日常更新见页首链接。

重现时使用新的输出目录：

```sh
node --test tests/selected-edit-scope.test.mjs tests/local-satisfied-edit.test.mjs tests/edit-target-choices.test.mjs tests/scoped-button-copy.test.mjs tests/point-selection.test.mjs tests/button-copy-checks.test.mjs tests/workbench-model.test.mjs tests/workbench-edit-budget.test.mjs tests/edit-clarification.test.mjs tests/input-coverage-v2.test.mjs
node scripts/build-workbench.mjs --catalog examples/modern-menu.catalog.json --assets builtin --output output/my-selected-scope-studio
node scripts/check-button-copy-browser.mjs --workbench output/my-selected-scope-studio --output output/my-selected-scope-browser
```

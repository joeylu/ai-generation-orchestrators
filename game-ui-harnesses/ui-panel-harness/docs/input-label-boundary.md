# 输入名称边界校验

针对2026-10-13真实复验R03的失败，增加确定性校验，不依赖再次提醒模型。

当Input候选名称以“单”或“多”结尾，而未加引号的原文紧接“行文字输入／行文本输入／行输入框”等描述时，该候选可能吞入了“单行／多行”的首字。原生意图转换返回NEEDS_INPUT，spec为null，明确询问两种完整名称；不自动截字，不输出部分面板。直接提交同类错误Proposal会报PLAN_LABEL_BOUNDARY。

明确引号名称、明确名称声明、正确拆分的名称以及非Input文字不受该检查影响。例如“玩家名单”作为完整名称仍保留；“订单单行输入框”的正确名称“订单”不被删除。澄清流程重复的问题不能充当用户选择，用户回答中的明确名称可以解除歧义。

这是针对已复现模式的局部校验，不是任意自然语言分类器，不覆盖所有名称错误，也不保证一次生成。现有已保存Bundle不进行名称迁移；编辑链路仍使用其原有校验，本次新增入口为生成意图与Proposal验证。

证据：新增17项边界测试通过。上一批8份真实原生意图在当前程序下确定性重放，7份业务事实保持不变，R03变为具体澄清；新增模型调用0。记录位于`output/input-label-boundary-replay-v1/replay-report.json`。随后经新授权完成[8次真实调用](input-label-boundary-real-results-2026-10-13.md)：7项直接生成正确，R03误称不支持输入校验并返回错误澄清。该次未触发名称边界拦截，不证明口语解析问题全部解决。

完整源码回归1608/1608通过、无跳过，日志为`output/input-label-boundary-regression-final.log`。新rc.5候选位于`output/input-label-boundary-sdk-v1/ai-ui-panel-harness-0.1.0-rc.5.zip`，SHA-256为`80b31608553e672ceb7cf37a8b0f16abd01486f69ef481165996efb3bcac1ece`。安装验收35项、通用浏览器17项、全组件浏览器12项通过，均不调用真实模型。仍为未发布候选。

本地Studio已更新，构建摘要为`4e2e42c1ce0446862a8bb9f420f39c814f86800537e538fcc3759009cb889ac7`；刷新现有页面后使用新构建。此记录不构成新一轮真实模型成功率证明。

复现命令（不调用模型）：

```sh
node --test tests/input-label-boundary.test.mjs
node scripts/replay-input-label-boundaries.mjs --run output/input-adaptability-repair-real-v1 --output <新目录>
```

# 简短输入小标题规则复测

状态：STOPPED_AFTER_INDETERMINATE_TRANSPORT。授权已消费，真实调用9次，5份面板、2次澄清、1次结构失败、1次连接不确定，27项未运行；自动重试0。详见[真实结果](heading-short-input-results-2026-10-14.md)。以下保留冻结时的准备说明。

用户指出“暂停操作”等小标题冗余。已修改原生schema描述与实验提示：单组、无页签、用户未要求副标题时，语义分组名复用面板主标题，由既有concise主题隐藏重复显示；有意义的多组标题及明确要求保持。没有修改已保存的真实结果，也没有更换旧编译器策略。

## 已完成的离线验证

138项通过，见 测试记录（本地生成产物：`../output/heading-verification-v1.log`，不随源码提交）。新增四项检查开始、暂停、加载、加载失败的意图到编译交付链路：采用同名语义标题后，无额外分组标题，业务内容、状态、动作一致，交付可重新验证。既有用例覆盖明确显示、多组和页签标题保留。这些是程序夹具，不是模型遵循率证明。

## 冻结真实复测

沿用上一轮12条用户输入×3组（严格精简、草稿优先、草稿优先加game-ui-design摘录），最多36次、串行、每项一次、无自动重试；连接结果不确定即停止。模型gpt-6-luna/xhigh。用户输入不追加尺寸或排版指令。

- 完整请求列表（本地生成产物：`../output/heading-short-input-plan-v1/index.html`，不随源码提交）
- 冻结计划（本地生成产物：`../output/heading-short-input-plan-v1/input-adaptability-plan.json`，不随源码提交）
- SHA-256：`a9e6604935de811f0a5e202820da54a168b08e8c522a5e814d2fe0635948c856`
- 准备时36项驱动夹具通过，只读预检PASS。

执行后分别统计直接草稿、澄清、校验失败及未运行；审查真实渲染中多出的标题，并保留完整文案。技术PASS不等于标题合理。此12条输入没有明确指定副标题的真实案例，因此明确副标题保留仅有离线证据，不能推广为模型验证通过。

本次未接入自动尺寸调整，以免混入更多变量；此前width失败仍可能发生。相较旧批次，除标题引导外也包含上一轮新增动作约束，因此这是累计修正后的复测，不是标题提示单变量因果实验。既有规则摘录固定不变，不据此直接宣布某skill优胜。

仓库根AGENTS.md要求：`A generation attempt requires one fresh, single-use authorization bound to an immutable plan digest.` 因此执行真实调用需用户批准上述新摘要；旧批次授权不复用。

批准后执行：

```powershell
node scripts/input-adaptability.mjs run --prepared output/heading-short-input-plan-v1 --approve-plan a9e6604935de811f0a5e202820da54a168b08e8c522a5e814d2fe0635948c856 --output output/heading-short-input-real-v1
```

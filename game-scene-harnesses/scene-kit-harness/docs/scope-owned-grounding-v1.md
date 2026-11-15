# 单项职责决定的承托提示

0.81.0增加显式`groundingProfile: 'scope-owned-support-v1'`。它使用新的单项scope v4
及集合v4，同时继续使用`isolated-layer-v4`意图；不是把既有v4单层职责换成新主题
模板。旧scope v1/v2/v3、默认路径和所有冻结请求保持原字节，新profile不自动改写
历史。采用它编译的新计划有独立身份，需要新的准确计算确认。

## 解决的具体冲突

旧共享观感提示向landmark/scenery/foreground建议“紧凑根脚或基座”。这类通用形状
建议会与“只画岩块和少量短枯枝”等单项职责冲突；在冰雪样本里，暗碎岩实际带出
明显倒木根拱与盘绕木基。共享句是明确提示冲突及可能诱因，不是已证明的唯一生成
原因。删除这个冲突也不保证模型永远遵守职责，实际结果仍须看图检查。

新profile只允许single-asset brief已经声明的自身承托、接点及少量局部重叠，不
额外指定根、基础、主地形或邻层形状。若brief本身需要树根或建筑局部基底，它们
仍合法；不全局禁止根系、植被或自带承托。主体与次要附件的主次边界仍应明确：
完整倒木根盘和“少量相连短枯枝”不是同一份职责。

## 入口与组合

SDK从`./generation`导出：

```js
const scope = withScopeOwnedGrounding(existingSingleScope);
const scopes = withScopeOwnedGroundingScopes(requirements, existingScopes, selectedSubjectIds);
```

首批 coherent brief 也可在 `sourceScopes` 的显式主体 override 中直接选择：

```json
{"subjectId":"foreground-left","parentRole":"foreground",
 "content":"One rock group with only brief-owned support.",
 "exclusions":["Separate ground and machinery"],
 "groundingProfile":"scope-owned-support-v1"}
```

同一个 override 可以显式声明 `sourceAppearance`。初始化会通过上述集合 helper
构建最终 scopes；deferred 参考观察覆盖门与首批冻结会重放这一准确 scope，不能
用覆盖前的旧 scope 代替。未写 `groundingProfile` 的 brief 保持原有字节行为。
`source-review --briefs` 的临时 override 只用于预览，不会写回已初始化项目；首批
要使用该 profile，应在初始化 brief 中声明，然后核对默认 source-review 的最终 scope。

只允许现有通用承托句作用的landmark、scenery、foreground角色；其他角色拒绝这个
无效选择。使用新封包格式和严格字段校验，不把新字段混入旧版本。可与原有
visualCoherence及sourceVisualGuide共存，既支持正常单输入，也支持完整参考＋固定
暗面技术例的两输入。技术例的用途、顺序和原始SHA不因新profile改变。

新主题应先由Agent/宿主明确选择该profile，再预览并冻结准确计划；旧项目继续使用
原封包，确需修订时走现有revise或未提交来源替换能力。planned但未提交的旧请求
不能把授权转给新请求，已调用的旧来源不能自动重试。冻结、接收与派生沿用公共
链路，原PNG、QA、调用和独立人工美术状态保持。

## 验证与边界

新请求应核对brief原文保留、无无条件根脚建议、准确参考及可选技术图身份、角色/
字段拒绝、初始与修订路径、重放和新授权边界。旧完整计划/请求摘要必须保持。
测试只用合成素材和替身，不生成媒体。

这只是明确提示归属的通用合同，不是自动语义分割、像素清理、图像改色或对最终
接地效果的认证。新原图仍须独立检查主次内容、完整性、明暗、尺度及实际回拼；
技术pass不替代这些判断。Studio HTTP不增加生成、路径或命令能力。

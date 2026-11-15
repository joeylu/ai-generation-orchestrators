# 显式来源内容职责

新来源可在 `sourceScopes` 的单项 override 中选择
`contentProfile: 'scope-owned-content-v1'`。它只接受显式的 `content`、`exclusions`
和 `parentRole`，不从整图、名称或材质家族自动推断物件。

此选项解决两个实际提示冲突：人工材质家族的旧远景提示会要求城市楼群，旧单体
模板又可能把明确归属于同一固定组的两侧构件解释为只取一侧。选择后，主体身份
与组内成员由明确的来源职责决定；材质家族继续约束制造接缝、材质尺度和接地。
因此可描述轨道设施、船舱或其他人工环境，而不会仅因选择人工材质就添加城市。
天空仍必须完整不透明，透明来源仍受原技术门和必需排除项约束。

```json
{
  "subjectId": "distant-structure",
  "parentRole": "far",
  "content": "One fixed distant structure with both explicitly owned arms and its open center; no independently editable neighboring fixtures.",
  "exclusions": ["Playable deck", "Near equipment", "Painted sky"],
  "contentProfile": "scope-owned-content-v1",
  "framingProfile": "complete-silhouette-v1"
}
```

只有经过职责审阅、可共享变换且遮挡相容的成员才能作为固定组。独立编辑需求仍
要求拆开；该选项不会替 Agent 判断合并是否合理，也不要求新增坐标容差。若已绑定
`referenceStructure`、画框导图或背景带合同，原有结构和画框义务照常保留，不能
用这个选项移除冻结特征或使旧失败通过。对精确特征组继续使用既有
`source-owned-feature-group-v1` 结构选项。

同一 subject 的多个实例是分别生成的请求，不能因出现复数而在一张 PNG 中画成
多个独立物件的拼盘。每次生成一个实例，并保留该实例明确拥有的附着成员；重复
实例数与固定组内部的成员数分开解释，后续编辑也分别保留。

该字段进入新 scope、准确提示、编译器标记、计划摘要和实际预约请求。原参考字节
保持，输入用途明确包含本源已声明的成员、相对安排和开口；不一面要求保留组内
关系，一面仍说参考仅供画风。材料场与天空的专用形状合同继续约束其输出。
一个材料源由多个 ground
主体汇合时，所有主体必须选择同一内容 profile，防止只采纳第一项而丢弃另一项。
未选择此字段的旧计划保持原字节；新选择必须独立冻结并取得准确计算确认。
`tests/source-content.test.mjs` 验证提示、冻结、预约、错误授权与混合材料拒绝，
全部使用合成参考，没有真实生成。

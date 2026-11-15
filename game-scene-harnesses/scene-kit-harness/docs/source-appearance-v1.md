# 单源外观职责 v1

## Reference atmosphere prompt

同一 `source-owned-appearance-v1` 合同可显式追加
`promptProfile: 'reference-atmosphere-v1'`。未选时旧请求逐字不变；新选项和
每源 rules 一并进入 source scope、计划摘要和最终预约请求，不能借用旧授权。
该选项改变指令归属，不新增图像处理、自动审美判断或 Studio 效果。

新分支以参考中**看见的表观颜色**为目标，包括照明和空气透视，而不是推回无光照
材质色。每源 rules 分别说明大面明度、色偏、局部对比、边缘/纹理强弱和渐变；
不要复制同一句“匹配本层明暗”给所有深度，也不要把留边、数量等结构要求塞入
外观规则。共享制造材质约束仅适用于来源自有内容；天空不再继承板缝/金属细节。
局部灯具发光与外界照明分开，不用禁止整图光晕的措辞排除参考已有的雾化。

冻结前的审图表至少记录：

| 项 | 要记录的判断 |
| --- | --- |
| 可见证据 | 精确参考中的范围/表面、明暗和冷暖的比较对象；遮挡后的延续标为推断 |
| 外观职责 | 自有表面绘画、独立雾来源或具体作者操作；每项有一个明确承担者 |
| 空域与实体 | 哪些开口真透明，哪些实体有受雾影响的颜色；不要用实体半透明模拟空气透视 |
| 渐变 | 方向、覆盖范围和相对强弱；不存在时明确无需添加，不预设上暗下亮 |
| 编译审阅 | 必要外观进入最终 prompt；通用清晰度/材质/排除项没有反向抵消它 |

缺少主导明暗关系的 owner、依赖尚不存在的合成效果、或提示同时要求保留雾与
去除同一雾色时，停在受影响计划冻结之前。审阅文字不是程序语义检测门。
不用固定亮度阈值、颜色数值或像素一致性替代美术判断；参考本身可以是亮前景、
暖远景或无雾。灰度/取样仅辅助比较，并注明采样范围和不确定性。

接收后先检查原生来源，再检查实际 Studio：体块职责、Alpha 技术质量与光色层次
分别判定。若原生表面已经过亮，不能把问题归给未使用的合成滤镜；若仅拼接后出错，
再检查作者 brightness/contrast/fog、覆盖顺序及背景渐变。作者效果须独立版本记录，
不冒充原生生成质量。旧来源、失败、接受记录与原图完整保留，人类美术接受另记。

离线回归：`node --test tests/source-atmosphere.test.mjs tests/source-appearance.test.mjs`。
拱廊合成用例有连续地面、独立木箱、立柱和洞后花园，不含峡谷/悬浮平台；它检验
本源暖色木箱与绿色花园的要求能进入真实冻结/预约请求，不被通用蓝雾/暗前景替换。
测试使用合成 PNG 和预约双身，不生成图片，也不证明模型最终画对了。

源码0.87.0提供添加式、显式的`source-owned-appearance-v1`。整场景的画风描述可能
同时包含“必须两组前景”“左右三条表沿”等主体和布局指令；自由观察中的depth或
lighting也可能包含这类内容。把它们原样继承进每个单体提示会与单层职责冲突。

新profile不使用词表、正则或模型猜删原句。调用者为每个新来源明确冻结外观规则：

```js
const sourceAppearance = {
  format: 'ai_scene_source_appearance_v1',
  profile: 'source-owned-appearance-v1',
  rules: [
    'Cool grey rock, broad hand-painted faces and soft upper-left illumination.',
    'Restrained atmospheric contrast at the declared rear depth.'
  ]
};
const sourceScope = withSourceAppearance(oldScope, sourceAppearance);
```

`withSourceAppearanceScopes(requirements, scopes, assignments)`支持新主题首次规划，
assignments为`{subjectId,sourceAppearance}`数组。独立scope升级为v6，scopes集合亦
为v6。外观对象是精确schema，1–16条非空且唯一规则，单条有界，不允许私有操作路径。
它不保证调用者文字本身已纯粹；不得把整景规则原样换个字段塞回。

公有CLI的`init --brief`也可从第一批来源直接启用，不需要先冻结旧来源再修订：

```js
brief.sourceScopes = [{
  subjectId: 'rear', parentRole: 'far',
  content: 'One rear eroded-rock group only.',
  exclusions: ['Neighboring foreground groups'],
  sourceAppearance
}];
```

`createLayerSourceScopes`对可选sourceAppearance精确校验并保留；出现时集合为v6，
参考接受后第一份对应source plan即使用该外观。未带字段的旧brief和计划保持原字节。

新编译分支保留scene style.name、完整参考输入、原色/笔触/光向说明、原封不动的
visualCoherence证据及其generic共享规范。它既不序列化scene style.rules，也不
逐字注入visualCoherence的lighting/brushwork/materialScale/depth自由观察；必要
的单源颜色、光、笔触、材质尺度和深度改由显式appearance.rules承载。主体、数量、
承托与边界继续由single-asset brief、grounding、background-band等独立合同负责。

compiler后缀和sourceAppearanceEvidence绑定新profile、外观digest与原scene style
digest，声明`inheritedSceneRules:false`与`inheritedSceneObservations:false`。
原style和观察记录不被修改。旧v1–v5未启用路径的完整prompt、request和plan SHA保持。

v6保留暗面技术图的第二输入、capability/导出/字节重放校验，以及scope-owned-support。
与coverage-v3组合时仍保留自然上沿Alpha门、有限三边截口、固定guide、完整native
frame量测与镜头域校准；不恢复旧包络contain，也不放宽技术QA。共用一份材质的
多个ground主体必须全部采用完全相同外观对象，否则拒绝模糊合并。

完整包边也可在每个items条目明确给sourceAppearance；其具体图像/边界合同保持，
旧未带字段的请求不迁移。任何更换prompt/输入的旧未调用方案都需新的准确计划和
独立计算决定，旧授权不转移；每个请求仍最多调用一次，失败/未知历史保留。

本功能仅修复指令职责。它不是自动语义检测或生成可靠性的证明；实际层纯度、原色、
风格、尺度、接地、包边与Studio回拼仍需独立检查，最终美术接受保持分开。

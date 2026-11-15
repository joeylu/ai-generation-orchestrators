# 单层来源职责 v4

0.56.0引入新默认来源意图`isolated-layer-v4`。它处理首批生成任务的内容边界，
不是像素分割、Alpha修剪或自动语义检测。目标仍是整体观感协调、素材可编辑，
不要求逐像素复刻参考。

0.87.0的新请求可显式添加[单源外观职责v1](source-appearance-v1.md)，升级scope为v6。
该入口隔离整场景style.rules及自由观察对单源prompt的继承，同时保留单层内容、原色、
共享规范和技术门；旧请求完整字节不变，不进行自动文字分类或保证模型服从。

## 新项目与历史项目

`initCoherentPipeline`新建`ai_scene_coherent_project_v2`，绑定`source-scopes.json`
的准确SHA；结构、画风与参考审阅仍独立。参考接受后，首批每项来源默认使用v4，
不必先失败再给前景选择特殊修订。历史`ai_scene_coherent_project_v1`仍走原默认，
低级`freezeCoherentSources`未提供sourceScopes时也保持旧行为；没有静默迁移。

沿用v27计划/请求封装，使用独立compiler、intent和闭合sourceScope配方。旧空intent、
framing-v2、isolated-foreground-v3的请求、摘要、原图和决定保持可重放。新请求
依然需要绑定准确新摘要的一次性授权，旧批次确认不能支付新请求。

## 各层内容边界

| 来源职责 | 默认父级职责 | 应画内容 | 排除重点 |
| --- | --- | --- | --- |
| material | main | 连续材质字段、完整薄表沿和实心材质体 | 场景轮廓、天空、独立平台、缺口 |
| sky | background | 满画布不透明天空/氛围 | 山体、建筑、植被、地面 |
| backdrop | far | 一组远处地貌 | 画在图里的天空、玩法地形、相邻建筑/前景 |
| landmark | far | 一组地标，可含自身承托岩基 | 玩法主崖壁、平台与无关近景 |
| scenery | middle | 一组环境主体，可含小型附着底座 | 连续玩法墙体/表沿、平台、相邻地标 |
| valley | far | 一片谷底纵深景观 | 玩法平面、近景框景；未请求的水 |
| platform | main | 一座严格侧视的实心平台 | 主崖壁、支腿、相邻景物与后退顶面 |
| foreground | foreground | 一组清晰的近景装饰 | 主墙、承托厚板、连续可玩表沿和高台 |

父级是通用职责，主题决定实际主体和数量，不固定森林/雪山/沙漠或11张图。
远景/中景等非硬绑定职责可在设计中明确调整；sky/ground/platform/foreground
保持各自背景、主场景、前景职责。不会因此赋予碰撞或重排既有渲染层。

## 单体说明

新brief可添加`sourceScopes`数组，每条为：

```json
{
  "subjectId": "framing-rocks",
  "content": "一组低矮散置岩块、稀疏干枝与少量矮植被。",
  "exclusions": ["整片承托崖壁", "连续可玩平台"],
  "parentRole": "foreground"
}
```

Agent应在准备设计时把“两侧前景/中央谷地”等场景描述另写为单个素材的正向
说明，避免把完整一侧场景当成素材。未提供时沿用该subject.content，并如实
记录`contentOrigin: subject-description`；程序不会假装已经语义改写自然语言。
提示仍明确只输出其中一个对应主体，不传坐标和包络；重复主体各有独立计划。

每条subjectId必须存在且唯一。角色、图层、需求SHA与来源实例绑定，父级词汇
闭合；默认排除项必须保留，可增加排除项。单条内容最多1200字符，合并后的
地形材质内容另受总量限制，排除项最多16条；私有地址、路径及未知字段拒绝。
完整例子见`examples/coherent/desert-citadel.brief.json`。
已绑定的source-scopes与项目摘要一起校验；调整设计应准备新的项目/配方，不能
手改封装文件让已有授权追随变化。明确来源修订可提供新的准确sourceScope。

## 生图与回拼职责

每项只传已接受完整参考的原PNG，明确用于笔触、配色、材质和光照，输出内容由
单体brief决定。场景坐标、粗包络与锚点保留在计划绑定和回拼数据中，不进入
图片提示。默认透明单体要求完整居中、真实孔洞和四边余量；天空/材质满画布，不套用
居中剪影规则。余量仍是软提示，原有PNG技术检查继续执行，不证明模型已正确分层。

0.84.0为连续远山/后方谷地新增显式[有限景带边界](background-band-v1.md)。它在
scope/scopes v5中保留v4内容职责，同时以自然上轮廓和侧下画外延续替代该来源的
居中孤岛/四边12%指令。必须绑定有界相机/视差并单独量测full native placement；
不降低原透明border门，不修改旧请求，不自动赋予循环能力。

候选包额外保存每项`*-scope.json`，来源证据记录parentRole与scope SHA。
原PNG、原色、连续Alpha派生、地形/平台编译和回拼规则沿用原链。当前父级职责
记录在计划及来源证据，Studio仍沿用已有图层显示兼容规则，不自动改作者层序。

来源的语义隔离与最终整图均保留为待视觉审阅。发现混层应按准确来源记录决定，
再规划新请求；不靠算法遮罩清理掩盖错误，也不自动重试。允许为已技术接收的
来源准备明确v4替代计划，前驱原图、QA及美术决定保留，计算授权单独绑定。

## 零生图审阅

```sh
npm run coherent -- source-review --root /local/project --out /local/fresh-review
npm run coherent -- source-review --root /local/project --briefs /local/source-briefs.json --out /local/fresh-review
```

`--briefs`是上面override对象的数组。新v2项目默认使用已绑定的source-scopes；
历史项目未提供时只生成一份新版规则的假设预览，不迁移项目或冻结计划。

审阅包包含准确参考原PNG、单层定义、各项旧默认/新提示和逐字校验清单。before
指旧默认首批配方，不是当前交付素材；没有伪造生图前后对照。重复导出重放全部
字节，篡改即失败，工作流事件不变。准确计算审阅还会提供`source-scope-review.json`。

v4已用替身走通规划、单次授权、技术接收、派生、交付、实际Studio和ZIP一致性。
沙漠10来源与暮秋水车工坊9来源另有真实样本；水车工坊远山原技术拒收后，经单独
准确批准使用零生图补框准备来源，原图与失败保持。实际来源观察和整图仍独立
审阅，不将少量样本当作跨主题自动语义纯度保证，见执行文档第134、138节。

0.72.0支持[未提交v4来源另冻新计划](unsubmitted-source-revision-v1.md)：planned/authorized
父项必须完全没有attempt、submission、result、terminal字段。新scope编译为新的planned
子计划和批次，必须新摘要授权，不迁移旧未用授权；已预留/提交来源不能走此分支。

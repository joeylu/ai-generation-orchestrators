# Coherent 低Alpha边缘的显式画布补框

本入口用于已接收的v27透明来源。它保留生成结果的原生PNG与技术拒收记录，
生成另一个零生图的准备来源；不是图片重试、轮廓清理、Alpha擦除或隐藏几何恢复。
单层职责沿用v4，新交付继续使用显示密度v2。

## 有界资格与像素操作

只允许同时满足以下条件的准确来源：

- 当前v27透明来源处于rejected-technical，原技术检查的唯一问题为
  COHERENT_CLIPPED_SILHOUETTE。
- 重新读取原PNG并重算原QA，指纹和旧结果完全一致。
- 原画布外两圈最高Alpha大于1且不超过3/255；Alpha至少16/255的内容非空，
  且四侧均保留至少4px。统计不证明所有隐藏轮廓完整，准确预览仍须人工检查。
- 原宽高各增加4px后，仍在原计划sourcePolicy的边长上限内。

程序在四侧追加2px的零RGBA外框，将原RGBA完整平移(2,2)。所有原RGB和连续
Alpha逐字保留，包括低Alpha尾迹和透明像素的隐藏RGB；不裁取包络、不擦像素、
不调色、不做形态学处理。派生PNG重新运行同一Coherent技术检查，必须通过。
旧QA的阈值与原失败状态保持。

## 先预览，后采用

```sh
node scripts/coherent.mjs border-review --root /local/project --source SOURCE_PLAN_SHA256 --out /local/fresh-border-review
```

只读导出原PNG、准确补框预览、原计划/结果、原/新PNG和RGBA指纹、边缘统计、
提案及校验清单。预览导出不追加工作流事件，不授权或提交任何图片调用。
用户接受proposal.json的准确摘要后执行：

```sh
node scripts/coherent.mjs border-apply --root /local/project --review /local/fresh-border-review --decision /local/decision.json --preparation-id hills.border.r1 --batch-id sources.border.r1
```

decision使用既有review收据结构：decisionId、targetSha256、decision="accept"、
notes。程序重放整份预览包、原图和提案，拒绝替换、篡改或不匹配的接受决定。
准备记录为ai_scene_coherent_border_preparation_v1，maximumCalls=0；无图片attempt，
不继承原图或整图美术接受。准备后的技术通过明确归属新来源，不改称原生生成通过。

新ai_scene_coherent_source_batch_v2仅采用该准确准备来源，其余已收到来源、
未提交计划及未使用授权保留原身份。补框不增加计算额度；原有未使用授权仍分别
绑定原不可变计划，各最多调用一次。已提交、失败或未知的生成计划不能借此重发。
计算审阅v2把零调用准备来源与图片计划分列，并列出尚未使用的原授权计划摘要。

## 交付与回放

候选保存准备PNG、原PNG、原失败结果、准备提案/决定和双重来源身份。
verify重新从原字节计算准备结果及全部指纹，再重放派生、组装、ZIP与Studio。
准备后的技术通过、Agent单层观察和用户整图美术决定分别记录。

旧v1批次、既有v27生成计划及历史候选按原规则重放。该入口不接受任意像素操作、
自选滤镜、任意路径字段或执行代码，也不增加Studio HTTP生图/准备端点。

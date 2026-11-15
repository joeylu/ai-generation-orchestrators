# 首屏补充环境来源：离线计划 v7

0.19.0 增加三个明确的非循环环境角色；使用 generation plan/request v7，继续使用
原有 native-environment 源政策与 processing profile v2。v5/v6 的角色集合、prompt
与摘要保持不变，不将新角色伪装成低墙或树组。

| role | 来源范围 | 后续须单独检查 |
| --- | --- | --- |
| distant-ruins | 完整的远处桥堡组合、透明拱孔、低对比青绿色 | 远近尺度、支撑关系与背景覆盖；非循环 |
| floating-platform-shell | 草顶、收拢石底和少量垂藤组成的完整正侧视实心台地 | 水平顶边、接触线、实际摆放尺寸；不是已认证碰撞形状 |
| valley-water | 独立的静态溪流与小瀑布景片 | 透明边缘和谷地遮挡；不包含动画、物理或循环连续性 |

前景叶丛仍使用原 v6 foreground-foliage；旧失败来源只能显式修订为新计划，旧批准
与预留不能继承。新三角色均为透明 environment、repeatAxis=none，采用原完整
Alpha 边界加二像素、等比面积缩小、不放大的派生方式；不修轮廓或推断几何。

API 为 `freezeEnvironmentSupplementPlan(root, options)`；options 与原环境来源相同：
planId、parents、referencePlanSha256、capabilitiesSha256、assetId、role、sourcePolicy、
derivation、intent。未知角色/字段、错误 fit、循环要求、缺少已接受参考或透明能力
均拒绝。CLI 为：

```powershell
node scripts/workflow.mjs plan-environment-supplement --root WORKFLOW --file OPTIONS.json
```

这只冻结计划，必须再取得准确 digest 的单次计算确认。由现有 authorize/reserve/
submitted/receive/review-image 离线交换完成接收；内核与 Studio 均不调用提供商。
原生 RGBA PNG 不改，Alpha=0 的隐藏 RGB 仅作诊断，真实触边继续拒收。源技术通过、
源作品接受、派生作品接受和整包接受相互独立。未知结果保持终态，不自动重新提交。

build/verify-environment-proof 可为技术通过的 v7 来源生成独立明暗底预览和派生证据；
派生仍 productionKit=false、visualAcceptance=not-assessed。当前首屏/四屏组装器没有
自动接入这三个新角色，已有 4188 地图与导出包不变。接入应等待真实输出后的摆放
和表面几何检查，不能把冻结补图计划写成已完成的资产。

合成回归覆盖三个角色的计划/接收/派生、旧格式关闭性、原生字节与连续 Alpha、
可见触边拒收、终态修订/新授权及 CLI 零提交；测试不生成媒体。

## 补充来源的准确透明外框准备

0.19.0 另提供独立的 supplement-padding 提案与批准，不扩大旧 v1 补框批准的范围。
封闭角色为 foliage（v6 foreground-foliage）、distant-ruins（v7 同名角色）、platform
（v7 floating-platform-shell）。水景、其他角色、通过的来源、条带、Alpha≥2 的
触边或其他 QA 失败均拒绝。仅原边带最大 Alpha=1/255 且只因 margin 拒收才可提案。

`proposeSupplementPadding(root,{batchSha256,items})` 的 items 为 1—3 个封闭
`{key,sourcePlanSha256}`。程序重放准确原图、旧 QA、当前设计和像素操作，绑定原图/
RGBA、新 PNG、尺寸、旧失败、反事实 QA 与批摘要；不改变来源状态。所有原 RGBA
复制到 (2,2)，四边只增加两像素零 RGBA，原 PNG 保留；没有抹除、阈值化或补画。

`approveSupplementPadding(root,proposal,receipt)` 仅在准确提案的用户 accept 后追加
独立 supplement-padding-approval。`prepareSupplementPadding(root,options)` 的字段
与旧 prepareEnvironmentPadding 相同，追加 environment-preparation v2，显式记录
sourcePlanFormat。新 QA 绑定原生成计划；原失败保留，新来源 pending-visual-review，
maximumCalls=0，不自动授予美术接受。每项批准只可准备一次，重放须重建相同 PNG/QA。

```powershell
node scripts/workflow.mjs propose-supplement-padding --root WORKFLOW --file OPTIONS.json
node scripts/workflow.mjs approve-supplement-padding --root WORKFLOW --proposal PROPOSAL.json --file HUMAN_RECEIPT.json
node scripts/workflow.mjs prepare-supplement-padding --root WORKFLOW --file PREPARATION_OPTIONS.json
```

旧批准不能准备新来源，新批准也不能调用旧准备接口。准备 v2 可用既有 proof
build/verify 派生明暗底预览，派生仍未接受。这个扩展不允许把真实裁断伪装成留边
问题，也不改变原生图或绕过未获批准的准备；Studio 无新增 HTTP 入口。

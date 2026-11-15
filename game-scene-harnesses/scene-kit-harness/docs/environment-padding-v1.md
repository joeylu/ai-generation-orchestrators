# 环境来源：经批准的透明外框准备

0.17.0 提供离线零生图准备。原生 v6 环境块只因 ENVIRONMENT_ALPHA_MARGIN 拒收，
且原两像素边带内最大 Alpha **恰为 1/255**，才能提议补框。首版限定树组、拱门、
断墙三种角色；Alpha≥2 的触边、条带、其他 QA 失败与已通过来源均不可使用。
它不修复真正裁断的叶片，不删除微弱 Alpha，也不修改既有拒收结果。

`proposeEnvironmentPadding(root,items)` 不改变工作流。封闭 items 为 1—3 个
`{role,sourcePlanSha256}`；role 为 trees/arch/wall，必须匹配原计划角色。程序完整
重放旧 QA、当前设计与原 PNG，逐行复制 RGBA 到 (2,2)，外侧补两像素零 RGBA，
重新编码成新 PNG。原文件字节保留；新文件内部的每一个 RGBA 值，包括 Alpha=0
处的隐藏 RGB，逐像素保留。新尺寸仍受原策略限制。

有摘要的提案绑定原计划、原图、原解码 RGBA、旧 QA、新 PNG、操作与尺寸。
`approveEnvironmentPadding(root,proposal,receipt)` 必须收到用户对准确提案摘要的
明确 accept；receipt 与图片美术审阅记录不同，decisionId 仍全工作流唯一。
程序重算提案再记录批准，不能通过重新封装哈希替换像素或扩大范围。

`prepareEnvironmentPadding(root,{preparationId,approvalSha256,sourcePlanSha256})`
按提案再生产新 PNG，存入内容寻址 blob，并追加独立 environment-preparation。
一份批准的每个来源仅准备一次；同源后处理可通过 proof build/verify 重放。
该记录绑定原图、旧失败、批准/提案、新图与新 QA；maximumCalls=0。原计划继续
rejected-technical，新来源进入 pending-visual-review，**不授予源美术接受**。
新 QA 的 planSha256 绑定原生成计划，准备记录摘要另作派生证据，避免自引用。

重放程序逐字节重建 PNG/QA，检查批准范围与唯一性。不能把准备来源重新授权、
预留或修订为图片生成。新来源可由环境 proof producer 派生明暗对照，派生输出
继续遵守 Alpha=0 时 RGB=0；接缝、轮廓完整性和美术审阅不因补框自动通过。
更改已接受设计会使尚未执行的准备和后续派生失效。

```powershell
npm run workflow -- propose-environment-padding --root WORKFLOW --file ITEMS_JSON
npm run workflow -- approve-environment-padding --root WORKFLOW --proposal EXACT_PROPOSAL_JSON --file HUMAN_RECEIPT_JSON
npm run workflow -- prepare-environment-padding --root WORKFLOW --file PREPARATION_OPTIONS_JSON
npm run workflow -- build-environment-proof --root WORKFLOW --plan PREPARATION_SHA --out NEW_DIRECTORY
```

提案本身维持 awaiting-exact-pixel-preparation-approval 原始内容；接受后追加批准记录，
不回写提案。这个本地 CLI/API 无提供商调用，未增加 Studio 的 HTTP 能力。

0.19.0 的叶丛/远桥/悬浮台使用独立[补充来源准备合同](environment-supplement-v1.md)，
不复用本 v1 批准，也不改变这里 trees/arch/wall 的原角色与重放摘要。

# 参考图主导：默认参考流程（0.34.0）

用户选择的默认链路为：内容/画风/可拆规范 → 完整参考图 → 标准与准确图审阅 →
实测布局 → 冻结准确原图和实际布局 → 后续资产拆分回拼。后半段资产拆分与忠实
回拼仍待实现。本版完成前半段的独立 CLI/API，不把它称为完整资产交付。

默认后半段是Agent按实际图层/实例分解生成任务，通过显式图片适配器参考确认图
重新生成素材，再按实测布局回拼验收。精细像素抠层不是必经步骤；局部裁图、
包络/表沿与锚点可提供生成约束，CPU分割仅为可选定位/轮廓辅助。重生成后的
质量门比较构图、轮廓、遮挡与美术还原，不要求原图RGBA逐像素复制。

0.43.0提供[受约束素材候选入口](reference-assets-v1.md)，支持实测实例子集的
准确批次、图片执行/接收和固定参考窗对照。首张真实前景未遵守位置与留边而
技术拒收，当前并未完成忠实回拼或完整资产交付；CPU入口继续作为可选试验。

默认入口为 `./reference` 和 `npm run reference -- ...`。精确结构输入仍用显式
`reference:standard`，属于已有试验流程，当前宿主图片接口不保证像素锁定。旧计划、
图片、布局偏差和人类决定保留；此版不会重算旧判定或切换旧工作流文件。

0.35.0 另有[显式预设画风隔离对照](reference-led-isolation-v1.md)：用户拒收 v18 后，
可保留已接受需求和文字画风，省略整场景图片输入形成独立 v19 计划。默认流程与
自定义风格锚点要求不变；新计划仍需单次计算确认及相同七标准/实测接受门。

0.36.0 另实现[显式投影/前景条件入口](reference-controls-v1.md)：导入并接受准确
控制审阅包后，v20固定发送两张内部规范图，仍走相同图像审阅门。当前只支持
清爽手绘预设，未验证真实控制效果，默认v18/v19与custom锚点要求保持原样。

0.37.0增加[接受后的可见拆分追踪](reference-decomposition-v1.md)：输出逐主体原像素
上下文局部，接收原生像素归属标签并检查片段坐标回拼；没有自动分割、真实材质
Alpha或隐藏补全，不把复制闭环当作忠实素材还原完成。

0.38.0另接通[可选CPU种子分区](reference-segmentation-v1.md)，0.39.0增加独立
[点框候选试验](reference-prompt-segmentation-v1.md)。这些均不替代或阻塞默认素材
生图链；实测仍不适合完整场景。设置、试验和美术接受分别记录。

## 生成前：有规范，没有像素关卡模板

新 spec v3 只包含 mode、投影、非空内容、style-only 输入、基准视口、画幅容差和
封印 requirements。它不含 grid、地图格数、polygon、anchor 或 referenceLayout。
style v2 仍支持预设与准确自定义锚点，用户图片/手绘仅供风格。若只上传风格图，
Agent 仍须先明确内容或场景配方，不能从图内悄悄继承关卡。

`ai_scene_reference_requirements_v1` 明确本场景：

- layers：层 ID、类型、深度、视差；最多16层。
- subjects：主体 ID、图层、角色、内容、数量范围和定性 placementHint；总容量
  最多24个实例。支持可选主体、同角色多实例，不固定十一角色。
- compositionNotes：自然语言构图建议，不构成生成前像素锁定。
- 七项 standards：projection、layer-separation、frame-completeness、terrain-readability、
  foreground-readability、style-consistency、decomposability。内容按场景明确，不能删掉
  不易通过的要求；无前景场景按明确缺省策略核验，不强制增加。

Agent 将自然语言整理为此合同；CLI 不自带自然语言或图像理解服务。生成前的规范
审阅绑定 spec/style 摘要；图片计算另绑定准确 v18 计划单次批准。v18 只有风格图或
文字输入，不生成或上传固定结构底图，也不为任意主题预先安排平台坐标。

## 两条候选来源

1. 新生成：v18 仍是单次预留 → 提交 → 显式宿主适配器 → 原生 PNG 技术接收。
   unknown 终态、不自动重试或回退。原生图保留字节，按声明映射生成审阅缩图。
2. 已有 PNG：设计接受后显式 candidate 导入原字节。程序登记 no-generation 候选
   计划和技术接收，maximumCalls=0，不产生授权、预留或生成尝试，不能转成计算。
   来源仅声明 user-selected-existing-png，不伪造生成来源证明、旧计划通过或美术接受。

已有图也必须符合新的独立规范，接受前状态 pending-visual-review。把一张旧图导入
为新候选不会消除它在旧精确结构计划中的失败；选择新模式本身不接受任何图。

## 生成后：实际测量与人类接受

`ai_scene_measured_reference_layout_v1` 绑定 plan/raw 摘要和 canonical-reference-frame，
含实际 layers、instances、surfaces 和七项 quality 观测。程序校验闭合字段、数量、
图层归属、点/轮廓范围和数据一致性，不自动做语义分割。

每个实例记录 instanceId、subjectId、layerId、visibleEnvelope、anchor、visibility、
anchorEvidence、notes。visibleEnvelope 是单个简单多边形的操作者包络，不是精细
Alpha 遮罩。visibility 区分 visible/occluded/frame-clipped/occluded-and-frame-clipped；
推定锚点必须标 inferred，不能把“完全可见”同时标为推定。可见锚点须在可见包络内。
隐藏/框外几何始终未恢复，不根据这份布局伪装成完整素材。

实际 terrain 实例须有表沿 surfaces，每条含实例、从左到右的点、observed 或
partly-inferred 证据和说明。纯观测点须位于实例包络，推定段必须显式标记。这里
记录可视表沿，不自动生成碰撞或把地形吸附到预设格子。

七项 quality 均由操作者基于真实图给出 pass/fail/uncertain 与说明。数量缺失、表沿
缺失、任意 fail/uncertain 都阻止接受。程序“reported-satisfied”仅表示这些申报与
结构检查齐备；用户仍须核对准确图片、数量、侧视、前景、层次及标注对应关系。
好看不能替代纯侧视/可拆性检查。

审阅包包含原图、基准帧、实测包络/表沿叠图、requirements、analysis、未接受目标
候选和封印 packet。人类接受必须绑定整个 packet，不允许只接受 raw PNG 绕门。
接受后程序写入不可覆盖的 review，并生成 `ai_scene_reference_reconstruction_target_v2`，
绑定准确 PNG、映射、实际布局、证据与人类决定。重放重新计算目标，手改目标并
重算外层日志哈希仍不能通过。

没有“与生成前坐标误差为零”的分数。后续真正回拼必须对照这张已接受图及其实测
布局另做位置、轮廓、遮挡和外观验收；本版尚未实现该资产生成/回拼门，也不能
把新目标送入旧固定地图组装器冒充完成。

## 调用

```sh
npm run reference:led:prepare -- --example snow-castle --out NEW_PROJECT
npm run reference -- preview --root PROJECT --out NEW_PREVIEW
npm run reference -- design --root PROJECT --decisions USER_DESIGN_RECEIPTS
```

新生成分支：plan（OPTIONS 可为 `{}` 或 planId/parents）→ authorize → run（显式
--adapter codex 或 --adapter-module）。这些决定互相独立，准备和预览不调用图片。

零生图候选分支：

```sh
npm run reference -- candidate --root PROJECT --file EXISTING_PNG --options CANDIDATE_OPTIONS
npm run reference -- assess --root PROJECT --analysis ACTUAL_MEASUREMENTS --out NEW_REVIEW
npm run reference -- verify-review --root PROJECT --analysis ACTUAL_MEASUREMENTS --out NEW_REVIEW
npm run reference -- review --root PROJECT --analysis ACTUAL_MEASUREMENTS --decision USER_PACKET_RECEIPT
npm run reference -- target --root PROJECT --out NEW_TARGET_DIRECTORY
```

CANDIDATE_OPTIONS 为 `{planId}`；ACTUAL_MEASUREMENTS 必须封印。需要时可直接 reject
准确原图，无需先补完整标注来拒收。导出的 target 小包没有图片素材，不是资产包。

API 对应 init/inspect/previewReferenceLedProject、verifyReferenceLedPreview、
reviewReferenceLedDesign、plan/authorize/runReferenceLedProject、intakeReferenceLedImage、
assessReferenceLedImage、verifyReferenceLedImageReview、reviewReferenceLedImage、
exportReferenceLedTarget。底层原子状态由 `./generation` 维护；测量校验由
`./reference-measurement` 导出。所有本机文件路径仅属于本地选择，不进入公开计划。

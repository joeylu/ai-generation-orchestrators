# 文档索引

## 当前入口

- [本次源码收尾](studio-closeout-2026-10-10.md)：当前范围、1418项本地回归及页面验收来源。

- [使用与启动](start-here.md)：需求、生成、修改、试玩及下载。
- [Studio 日常启动](studio-start.md)：一条命令、固定地址、版本更新与重启恢复。
- [采用回答后直接提交](adopt-answer-submit.md)：一次点击合并答案并生成或修改，未填全不发、失败不重试，离线仍支持手动导出。
- [此前响应读取失败与恢复](response-recovery.md)：babc6c历史构建；89项回归、10组实际HTTP故障页面检查及20组日常检查通过，模型0。
- [此前日常 Studio 范围提示更新](daily-studio-scope-update-2026-10-09.md)：72a060历史构建的20组服务验收、ZIP离线与存档恢复，记录保持。
- [此前日常 Studio 整体验收](daily-studio-acceptance-2026-10-09.md)：a188历史构建的15组验收及来源，记录保持。
- [目录与依赖边界](structure.md)：源码职责、工具预检及历史产物。
- [命令索引](commands.md)：日常使用、离线检查与真实验收的区别。
- [第一版源码收尾](v1-candidate-2026-10-08.md)：此前版本的范围与验收来源。
- [Studio 本机保存](studio-storage.md)：新建面板、历史恢复、草稿及10轮限制。

## 生成与修改

- [选中控件的范围冲突提示](selected-edit-scope.md)：明确要求超出所选控件时先停在本地，保留原文并提示取消选择；128项对应回归、41组程序页面通过，模型0，已进入4951日常构建。
- [连续编辑单次真实结果](continuous-edit-real-results-2026-10-09.md)：已有真实声音编辑结果追加1次改口与多项编辑，最终45/25正确，3个图标和试玩保持；6组页面、实际ZIP及来源审计通过，授权已消费。
- [连续编辑验收与单次复验准备](continuous-edit-acceptance-2026-10-09.md)：同一面板4步程序编辑、13组页面与65项回归通过；改口语义仍未自动核对，冻结准备记录保留，后续真实结果独立记录。
- [要求已满足时本地提示](local-satisfied-edit.md)：完整明确要求与“其他不变”已匹配当前Spec时不提交编辑；1383项回归、29组程序页面检查，模型调用0。
- [同名按钮本地选目标](local-edit-target-choice.md)：单个精确改名遇到重名时先列出分组供选择，再点击才提交；1376项回归、23组程序页面检查，模型调用0。
- [同名按钮单次真实编辑结果](scoped-copy-real-edit-results-2026-10-09.md)：1次真实编辑、零重试，两组同名按钮精确改名，其他字段/试玩值保持；5组浏览器与1份实际ZIP通过，授权已消费。
- [同名按钮单次真实编辑准备记录](scoped-copy-real-edit-plan-2026-10-09.md)：24份输入与284份源码冻结，8项本地和5组浏览器夹具预演；准备记录保持，真实执行见结果页。
- [同名按钮的分组定位](scoped-button-copy.md)：Studio新修改上下文0.14支持精确分组限定与点选后的原名；1370项回归、19组程序替身页面检查，模型调用0，7份旧上下文兼容复核。
- [精确按钮文案核对](button-copy-checks.md)：前版0.13检查漏改、误改与“其他不变”；1355项回归、11组程序替身页面检查，模型调用0，后续分组扩展见0.14。
- [新菜单默认单次真实复验](menu-defaults-real-results-2026-10-09.md)：1次调用、零重试，未再增加小标题，新默认比例/配色、5组浏览器及1份实际ZIP通过；后续用户反馈“还可以”作为单样本参考，授权已消费。
- [纯文字菜单默认落地](menu-defaults.md)：新Studio采用minimal-v2的菜单比例与中性色，其他类型基础样式保持；1339项回归、15组夹具浏览器及3份实际ZIP通过，原真实结果保留。
- [暂停菜单单次真实结果](composition-real-pause-results-2026-10-09.md)：1次调用、业务与离线包检查通过；当时默认生成比精修样本松散，视觉验收待定，授权已消费。
- [分类型构图提示与输入检查](composition-planning.md)：设置、菜单与弹窗分别指导；文字/局部编辑保留构图，明确布局要求优先，1324项本地回归及后续单次真实结果的边界。
- [当前排版参考](visual-baseline.md)：声音设置保留对齐版，暂停/退出恢复紧凑试稿之前的构图；分类型选取，避免机械套用布局。
- [暂停与退出排版对比](compact-actions-study.md)：历史四份试稿，技术检查通过，但用户反馈不如上一版，不采用为设计基线。

- [声音设置对齐与间距](audio-aligned-layout.md)：沿用Noto与线条图标，统一标签/滑轨和数值/开关/保存边界，收紧分组与底部操作；浅深色前后试玩及离线对齐检查，默认未切换。

- [Apple面板字体对比](apple-typography-study.md)：Noto Sans SC与等线，两款中文字体在声音、资料和退出面板中浅深色对照；固定字号、字重及布局，确认实际字体加载，默认未切换。

- [Apple风格整套精修](apple-suite-polish.md)：六类面板、12份浅深色，统一底板、文字层级和操作比例；总览进入前后试玩对比，保留声音图标/清晰滑块与退出精修，默认未切换。

- [退出确认细节精修](apple-dialog-polish.md)：紧凑比例、文字层级、细边线与轻量投影；当前版与新稿直接对照，浅深色可试玩，未推广默认。

- [Apple风格多面板样本](apple-panel-samples.md)：主菜单、暂停、画质设置、角色信息和退出确认，10份浅深色候选与原简约版并排对照，可试玩和下载；模型调用0，默认未切换。

- [声音设置连续布局试稿](audio-flow-study.md)：声音控件合为一张卡片，恢复默认与关闭/保存归入底部操作区，保留字体与控件美术。

- [声音设置滑块清晰度](slider-clarity.md)：圆钮边缘与投影、轨道对比，保留无底色图标；浅深色、桌面与窄屏真实拖动及离线包验证。

- [声音设置图标精修](plain-audio-icons.md)：重画三个图标并去掉蓝色底块，原分组布局与业务保持；浅深色可试玩对比、程序试稿。

- [Apple风格分组布局试稿](apple-grouped-layout.md)：音量、静音、恢复默认分组，浅深色Pixi试玩及离线包；程序夹具、模型调用0，未替换默认。

- [不同 Skill 美术对照](art-skill-comparison.md)：frontend-design / Taste Redesign / Impeccable；修正版3次真实调用完成，6份浅深色、20组汇总检查通过，匿名对照入口和此前失败记录保留。

- [声音设置美术试稿](crafted-audio-study.md)：参考Impeccable，薄荷紧凑、温润留白、横向分栏三款实际Pixi候选及浅深色切换；未推广日常主题。

- [自然语言编辑](panel-editing.md)、[Codex 接入](codex-planner.md)、[点选修改对象](panel-point-selection.md)。
- [视觉主题](panel-visual-style.md)、[浅深模式与主色](panel-themes.md)、[自定义外观](panel-appearance.md)。
- [简约面板美术](panel-minimal-art.md)：当前基础样式、历史美术总览与旧面板编辑兼容；[前一版视觉](panel-refined-surface.md)保留历史证据；[输入覆盖v2](input-coverage-v2.md)：纠正、排除、歧义与复合请求的24项夹具及未验收边界。
- [按用途排版](panel-presentation.md)、[布局](panel-layout.md)、[比例与固定尺寸](panel-frame.md)。
- [按钮主次与主题下拉](panel-semantic-controls.md)、[菜单表单弹窗排版](panel-focused-layout.md)、[主题页签](panel-navigation.md)。
- [按钮排列与形状](panel-action-layout.md)、[顺序、正文与单按钮样式](panel-control-editing.md)。
- [标题对齐与底板](panel-title-bar.md)、[正文换行](panel-text-wrap.md)、[同轮比例与布局](panel-layout-details.md)。
- [属性与修改范围](panel-edit-property-checks.md)、[修改结果核对](panel-edit-request-checks.md)。
- [进度条](panel-progress.md)、[Tabs](panel-tabs.md)、[输入表单](panel-forms.md)。

## 资源与交付

- [通用资源增量导入](asset-import.md)、[纹理重绘与筛选](texture-library.md)、[面板选材](asset-planning.md)。
- [内置核心图标](core-assets.md)、[按控件用途选图](asset-usage.md)。
- [确定性组合](panel-composition.md)、[多面板宿主](panel-host.md)、[Web 业务绑定](game-binding.md)。
- [面板交付包](panel-delivery.md)、[Unity 导出](unity-export.md)、[Unity 适配协议](../adapters/unity/CONTRACT.md)。
- [Unity 业务 SDK](unity-game-binding.md)。尚未接入当前用户的游戏项目。

## 验收与历史

以下记录绑定各自指定的源码与输入，不自动证明后续源码版本已通过。

- [16 类评测方法](panel-evaluation.md)、[用户修改边界审计](edit-boundaries-audit.md)。
- [用途排版真实复验](visual-smoke-acceptance.md)、[第一版历史收尾](first-version-closeout-2026-10-07.md)。
- [按用途选图真实验收](asset-usage-real-acceptance-2026-10-09.md)：四份真实结果、标签误判复核及实际下载包证据。
- [修改链计划](edit-chain-plan-2026-10-06.md)、[原生 Unity 历史接入验收](unity-game-integration-acceptance-2026-10-06.md)。
- [完整任务、修复和失败记录](tasks.md)。

# 纯文字菜单默认样式落地

## 2026-10-10 · 单按钮分组高度修复

日常输入“生成一个开始按钮”已取得有效方案，但重复分组标题隐藏后，minimal-v2菜单测量只留下56px行槽，低于固定分组配方的80px最小高度，随后编译以RECIPE_GEOMETRY拒绝。修复菜单测量的分组最小高度为80px；保持280×48px按钮、原文、事件和配方校验，明确尺寸越界仍拒绝。八种浅深配色的单按钮、独立分组标题及原生Intent物化均有回归；此前成功的多按钮菜单、非菜单和Tabs对应回归通过。

45项相关回归通过（`output/single-button-regression-v3.txt`）。候选及实际4951的8组页面检查通过，包括原始方案Spec/目录全等、五份原记录字节保持、原点击事件一次、刷新恢复、实际下载重编译和390px容纳，新的模型请求0。使用原方案本地重新编译的包位于`output/single-button-recovered-v1/panel.bundle.json`，摘要`7cc7930ed78eedbd6d8e522463637cc3c2d3310168dae7e010c18204b9af3955`；未改写原Intent、方案或模型回执，没有重新生成。源记录摘要在`output/single-button-recovery-input-v1/source-audit.json`。

修复前八种配色真实触发的编译FAIL保留在`output/single-button-before-fix-v1.txt`；补充Intent测试时上下文能力选项遗漏的FAIL保留在`single-button-regression-v2.txt`。浏览器v1误读事件封装字段的FAIL保留，只修正观察脚本后v2通过。日常服务已更新为e1e8dbbf96b180652ad3d20bb02c51087ed71485892cdc09775e635cc2d43520；用户需求保留，已将恢复包导入当前页面，0/10轮次，未点击生成。Unity编辑器原生导入未运行。以下保留早前落地记录。

2026-10-09，单次真实暂停菜单暴露出默认目录与精修参考的差距后，将菜单的比例、留白和中性色接入已有生成、编译、Pixi与UGUI导出链路。本轮模型及媒体调用0；没有修补原始模型输出，也没有再次消费真实调用额度。

## 采用范围

`npm run studio` 下次构建默认使用 `examples/modern-menu.catalog.json`，目录及主题版本0.18.0，`surfaceStyle: minimal-v2`，编译器0.26.0。仍有原八种浅深主题和12个内置核心图标，Studio操作界面不增加选项。已运行服务和静态页面不会自动更新；本轮没有结束或替换4951进程。

只有无Tabs、单分组、全为无独立标签的文字按钮、无行图标的菜单采用新菜单外观。分类依据结构，不按面板名或按钮文字猜用途。其他设置、表单、正文弹窗、加载页、图标菜单及Tabs继续使用原minimal-v1的基础token和排版；对应节点、素材、状态及业务合同逐项对齐检查通过。

未指定尺寸的新菜单默认完整底板428px宽、28px内边距、34px标题槽；标题居中加粗，按钮列居中，短文案默认280×48px、10px圆角，底板20px圆角。行槽56px、额外行间隔12px；长文案按保守文字宽度测量。保留primary/secondary/danger显式配方，不按按钮顺序猜第三项应改成文字链接。明确的面板尺寸、标题对齐、横纵排列、按钮尺寸/形状及局部颜色覆盖仍然优先，越界仍拒绝。

新菜单采用中性浅灰/深灰背景及底板，蓝色等强调色集中用于主按钮。字体为系统 `Segoe UI, Microsoft YaHei UI, sans-serif`，24px标题、16px正文；没有内嵌字体，不保证跨设备字形一致，也没有解决既有1倍画布在高DPI下的清晰度边界。

新目录的生成提示建议：没有明确分组标题要求时，单组菜单使用面板原题作为分组标题，避免凭空增加“菜单入口”。这是提示建议，尚未重新调用模型验证。编译器不会删除已保存的非重复小标题或改写任何文案。

## 保存及编辑兼容

旧目录、主题和编译器保留；打开已保存面板不会自动升级。新服务仅额外接受完整内容精确匹配的 `modern-navigation@0.7.0`、`modern-refined@0.8.0` 和 `modern-minimal@0.9.0` 编辑上下文，编辑继续使用原目录；生成只接受新构建固定的目录。修改过token的目录和修改过的新目录没有这项兼容权限。素材、绑定、存活试玩值、10轮限制及撤销规则保持。

原真实包 `output/composition-real-pause-plan-v1/panel.bundle.json` 未写入，bundle摘要仍为 `ab30c0804bd89d1c4bc251ae6bf0edce9e7446bb1f11f7d7af24291dbd541658`，文件字节摘要仍为 `760f5a7a0b5e64b1fc0973681acbf67825fe35c0f96a6566f4ab4069b14afd8b`。原方案、回执、冻结计划与授权消耗记录保留；新源码不代表原冻结源码，不能用旧授权再次派发。

## 对照及验证

入口 `output/menu-defaults-review-v1/review/index.html?panel=fresh-dark`，共三份并排实际Pixi对照：

- `saved-dark`：原真实规格与换新目录后的派生预览。保留完整原文、额外分组标题、原显式几何和全部业务，非新的模型结果。
- `fresh-dark` / `fresh-light`：明确编写的原生Intent程序夹具，比较相同业务在未指定尺寸时的前后默认；非真实自然语言理解证据。

| 验证 | 结果与证据 |
| --- | --- |
| 最终全量本地回归 | 1339/1339，`output/menu-defaults-full-regression-v2.txt` |
| 菜单、启动及服务编辑准入 | 47/47，`output/menu-defaults-edit-compat-v2.txt`；真实CLI为替身，无模型请求 |
| 实际浏览器 | 15组通过，桌面及390px下的独立试玩、按钮事件、严格即时导出和无裁剪；`output/menu-defaults-review-v1/review/review-report.json` |
| 实际下载ZIP | 3份完成CRC/摘要、无图库Studio重导入/重导出及离线打开；浏览器错误与外部请求0 |
| 旧包严格重放 | 原真实结果及声音/暂停/退出六份浅深参考，共7份通过；`output/menu-defaults-compatibility-v1/report.json` |
| 当前静态Studio | `output/menu-defaults-studio-v2/`，目录摘要 `8246828753c3bb97af2fdf9e40e9aa21b7c2be0640949e9eb765438dddad7bb0`，原12图标池摘要保持 |
| 汇总结论 | `output/menu-defaults-review-v1/acceptance.json`，`TECHNICAL_PASS_VISUAL_REVIEW_PENDING` |

已查看浅深色新默认和保留真实规格的对照截图。技术检查不代替用户美术验收；Unity编辑器原生导入及游戏接入仍为NOT_RUN。390px检查证明固定画布缩放容纳，不是重新流式排版。

## 本轮失败保留

`menu-defaults-targeted-v1.txt`的23/24是表单夹具误用通用按钮配方，修正夹具为已有显式语义配方。`targeted-v2.txt`的31/34暴露0.26遗漏原按钮绝对定位分支，修复后`targeted-v3.txt`为34/34，未放宽节点对齐门禁。随后新增升级服务准入回归，`menu-defaults-edit-compat-v1.txt`保留旧编辑请求400的真实失败；补齐精确前驱目录列表后47项对应检查与1339项全量回归通过。原失败文件均未覆盖。

## 单次真实复验准备（待新授权）

该计划随后已获新授权并完成唯一一次调用：默认几何、配色及额外标题检查通过，5组浏览器与1份实际ZIP离线往返通过；用户美术确认待定，授权已消费。见[真实复验结果](menu-defaults-real-results-2026-10-09.md)。以下保留准备时记录，原冻结文件不追改。

已冻结 `output/menu-defaults-real-pause-plan-v1/plan.json`，摘要 `9c4ff862621433bafc3dbbb129f6085906a4413c14262ae523297f0af1d1f1dc`。沿用上次相同需求文本，只运行一次新默认深色蓝色暂停菜单，gpt-6-luna / xhigh，编辑0次、自动重试0；旧真实结果仅作输出后的只读对照，不提供给模型。

14份输入、278份源码/合同/锁定依赖指纹、单次执行器与确定性浏览器构建器固定。当前Studio上下文重建、原生Intent程序夹具物化及Workbench接受一致，五项反例检查通过；新增验收明确拒绝“菜单入口”等额外小标题，并核对0.26的默认几何与配色。错误授权摘要在派发前拒绝，派发标记、真实调用及结果文件均不存在。受限环境登录不可见的FAIL保留；宿主只读login status复核PASS独立记录，网络和模型可用性未检查。冻结计划只读复核通过，本轮模型调用0；状态PREPARED / REQUIRED_NOT_GRANTED。准备证据不是新的真实生成或美术验收。

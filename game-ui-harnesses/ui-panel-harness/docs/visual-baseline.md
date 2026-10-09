# 当前排版参考

2026-10-09，用户对声音设置对齐版反馈“好多了”，随后对暂停/退出紧凑试稿反馈“感觉不如上一版”。暂停/退出紧凑试稿不采用为后续设计基线；保留它的源码、样本和技术验收记录，以便回看，原回执不改写。

| 类型 | 当前参考来源 | 选择依据 |
| --- | --- | --- |
| 声音设置 | `output/audio-aligned-review-v4/review/audio-{light,dark}-after.panel.bundle.json` | 保留用户反馈改善的对齐、间距和操作层级。 |
| 暂停菜单 | `output/apple-suite-polish-v2/review/pause-{light,dark}-after.panel.bundle.json` | 返回紧凑试稿之前的居中标题、280px窄按钮、48px按钮高度与原次级入口配色。 |
| 退出确认 | `output/apple-typography-review-v2/review/exit-{light,dark}-noto-after.panel.bundle.json` | 返回紧凑试稿之前的269px完整底板、原说明层级和两个179×48px等宽按钮。 |

暂停/退出两类按最近一次整体反馈恢复参考，不能将此解释为用户分别验收通过了每类细节。其他面板也不自动改成左对齐、全宽按钮或更小尺寸。

## 使用边界

- 设置列表可沿用已改善的标签/轨道和数值/操作对齐规则。
- 动作菜单保留原居中构图与按钮比例；进一步调整应单独对比，不能因“统一”而机械套用设置页规则。
- 弹窗保留原说明与操作区的平衡；不将未认可的正文精简和小型右下按钮写进生成/编辑提示。
- 默认主题没有切换，本次仅恢复设计参考，不执行Git重置、改写保存包或重新生成模型结果。

后续已将这些分类型原则接入原有生成与编辑提示，见[构图提示与输入检查](composition-planning.md)。该提示接入只提供能力范围内的建议，不会自动套用参考包的精确几何、字体或主题版本，也不代表真实生成美术已经复验通过。

再后续将[纯文字菜单默认](menu-defaults.md)单独接入日常生成，采用暂停参考的部分比例与中性色；旧保存包、声音/退出参考不自动迁移。该默认落地的本地验证与本节更早的“默认没有切换”记录分别记录。

新默认的[单次真实深色暂停菜单](menu-defaults-real-results-2026-10-09.md)随后获得用户“还可以”的反馈，保留 `output/menu-defaults-real-pause-plan-v1/panel.bundle.json` 作为当前日常菜单样本；旧精修浅深色参考仍用于比较比例。该反馈只对应此单样本，其他主题/类型和整体美术定稿仍待确认，原验收回执不改写。之后先补输入核对，保持当前视觉。

本次只读复核六份参考包严格重编译通过，暂停与退出四份参考包分别与 `output/compact-actions-review-v3/review/` 的 `before` 原包逐字段一致。没有模型调用、资源生成或新的大批浏览器测试；原有浏览器、离线和原生未验收边界保持。

参考页：声音设置 `output/audio-aligned-review-v4/review/index.html?panel=audio-dark`；暂停 `output/apple-suite-polish-v2/review/index.html?panel=pause-dark` 的右侧；退出 `output/apple-typography-review-v2/review/index.html?panel=exit-dark-noto` 的右侧。

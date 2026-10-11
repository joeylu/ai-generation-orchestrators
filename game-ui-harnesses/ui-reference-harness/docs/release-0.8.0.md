# UI Reference Harness 0.8.0

## 0.8.0：统一项目主参考

所有新面板计划共用已确认风格版本的完整 primary-style PNG；任何面板都可以先生成。
默认无备注使用完整默认样本，衍生或自定义风格使用确认后的完整预览，不使用卡片缩略图。
项目主参考只通过风格确认/修订改变。接受面板图片只接受该 run，不能设定项目锚点。
旧 anchorPanelId 仅作为惰性兼容输入；useAsAnchor: true 明确返回 PROJECT_ANCHOR_REMOVED。
新 DAG 为 ui_reference_project_dag_v2，含 primaryReference、无 anchor 依赖。
修改请求依次冻结 revision-source、layout-reference、primary-style（及已有原型上下文）。
风格缺少主参考时返回 STYLE_PRIMARY_REFERENCE_REQUIRED，须明确修复风格；不自动补图。
旧 DAG、计划、锚点、原图、原生会话和 ZIP 均保留。已完成旧结果可显式验收/导出；旧计划不执行。
新 DAG 不重置项目/面板/风格/原型会话的三轮修改预算，失败和不明状态不自动重投。
规则风格与六种样本准备仍可读取；无主参考的规则草案不能再冻结新计算计划。
真实模型调用 0；替身与 PNG 技术检查不代表人工视觉验收或 Docker 实际部署。


该版本改变新计划的依赖合同。宿主必须固定正式标签、完整提交、源码附件/manifest/runtime 摘要，并保持原始字节与兄弟 Harness 关系；禁止修改 vendor 或复制核心。Hook 原始字节不变，但新 runtime 的信任绑定必须单独审核。

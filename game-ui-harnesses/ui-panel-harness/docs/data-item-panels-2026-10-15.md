# 每条数据的独立底板

新生成默认使用 `modern-readable-game-data-panels`：主题0.31.0／0.31.1、`game-readable-v5`、Compiler0.44。旧目录与保存包保留各自的编译版本，不自动迁移。

语义分组使用外层Panel；组内每条有标签的只读数据Text，使用独立的内层Panel包住完整“标签＋值”。例如签到的今日奖励、连续签到各有一块底板，结算的结果、用时、得分、奖励各有一块。分组不能通过标签字符串猜测，也不要求模型为每条数据新增section。

数据底板采用主题surface底色、1px边框、8px圆角、12px内边距；外层分组采用control底色。文字和数据仍由原Spec提供。并排放不下时按同组规则上下排列；明确允许换行的数据在底板内部重新测量。保留原文、wrap:none、字号、顺序、事件和状态，不用缩字或截断解决空间不足。固定尺寸放不下仍报错。

标题底板沿用现有规则；message.text正文与确认问句不额外套数据底板。按钮、滑杆、列表等控件保留各自原有表现，不为每个控件标签再加一层。底板是编译出的真实非交互Panel节点，Pixi和Unity文档共享层级；运行时不读取外部skill。

本轮重排同一批10份已保存真实结果的0.43离线变体，没有新模型调用。来源不改写；新文件与前后对照分别保存在本机忽略目录 `output/data-item-panels-ten-fixes-v1/` 与 `output/data-item-panels-ten-review-v1/index.html`。公开回归夹具 `tests/fixtures/data-item-panels-regressions-v1.json` 只含Spec、状态、目录和摘要。新提示尚未再次调用真实模型，Unity编辑器尚未原生执行；rc.7仍未发布。

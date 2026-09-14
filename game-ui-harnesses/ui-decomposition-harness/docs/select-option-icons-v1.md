# Select 菜单逐选项图标接入

唯一字段合同：[消费端 select-option-icons-v1](../../ui-component-harness/docs/select-option-icons-v1.md)。
拆分端复用 `bindings[].states.select.optionIcons`，不新增同义字段或 parts 角色。
本目录文档说明生产端接入与验收，不替代消费端合同。

## 生产与交付

- 在生成计划中分别列出菜单背景、每个有依据的选项图标和运行时文字。
  图标不烘入菜单背景，也不用普通 Image 节点覆盖弹出菜单。
- 每个实际 optionId 恰好一个条目；明确无图标使用 `icon:null`。
  未知图标不能用 null 冒充已恢复。未知版本、字段、缺项、错 ID、非法几何、
  重叠文字区、无效图层、PNG 摘要和 Alpha 错误由校验或导出拒绝。
- 必须提供 popupContentLayout。行按真实 options 顺序等分安全区；
  图标/文字布局使用注册后的行内坐标，来源层的 left/top 不决定菜单图标位置。
- 官方 CLI 编译 layerId 到包内 image 引用。图标保留完整 PNG 透明留边并居中 contain；
  不裁 Alpha 轮廓、不拉伸、不自动猜色。hover/selected 共用该 optionId 的素材。
- 默认交付检查把 popup 和菜单图标列为 standby，不能贴在收起栏上。
  原图若菜单展开，通过独立 reference-state 的 popupOpen 记录；未知仍为 unknown。

## 本地验收

`stateful` 从已验证的绑定和消费端 Bundle 编译每个 optionId 的图标、文字区域、
完整 PNG 比例和安全裁剪，验证各图标的包内摘要及显式 shared 来源证据。
真实鼠标选择、键盘切换后检查值与事件次数、菜单文字、图标位置/尺寸及可见像素；
保留焦点截图，失焦后比较素材，关闭后检查 popup 销毁并保存截图。

程序像素检查主要比较不透明核心；不是任意重画图标识别，也不证明半透明边缘
与原画逐像素相同。菜单遮挡、半透明合成和 Studio 保存/重开由消费端独立回归补充。
现有统一矩阵仍拒绝尚未接入的 sourceCanvas/组件尺寸变换；不能因消费端支持注册缩放
便宣称所有变换组合已获此适配器验收。v1 仅等高行、同选项固定图标。

回归：`tests/test_select_option_icons.py`、`tests/test_stateful.py` 的 Select icons 测试。
使用消费端正式确定性夹具，新增素材均为程序测试几何，无媒体服务。
产物与证据：`work/ui-decomposition/select-option-icons-producer-20260914-r001/`。
此夹具不是 Quest Journal 美术；人工标记始终 false。

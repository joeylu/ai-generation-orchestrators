# Tabs 纵向布局接入

唯一字段定义见[消费端正式合同](../../ui-component-harness/docs/tabs-layout-v1.md)。
拆分端原样使用 `bindings[].states.tabs.layoutPolicy`，不定义同义方向字段。

纵向导航必须先声明 version=1.0、orientation=vertical，并为真实 tabId
提供现有 items 布局、普通/激活底板和独立图标。右侧内容使用组件树的显式
children 布局；不得用 Button 伪装 Tabs，不得虚构未展示页签的业务内容。
没有该字段时继续按旧横向合同验收。

Schema、导出校验和状态矩阵检查同一字段。导出仍校验全部图层摘要与 Alpha；
官方 consumer CLI 继续校验绑定注册及原生素材尺寸。矩阵核对编译前后方向
一致，按每项实际坐标截图与检查状态底板、图标。独立 Studio 回归检查真实
鼠标、上下键、Home/End、左右键无事件、页面显隐、模态阻挡与保存往返。

本扩展不构成新的美术生成授权。仍须冻结具体计划摘要、取得当轮计算授权，
并保留 unknown 参考状态及 human_visual_acceptance=false。

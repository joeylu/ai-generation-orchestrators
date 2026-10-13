# 主标题默认居中

用户查看8套真实面板后反馈主标题仍偏左。旧规则仅对单分组、纯按钮面板居中；加入结算文字、设置字段或进度条后退回左对齐。此前业务验收没有检查标题字形中心。

Compiler 0.32.0 将PanelSpec 0.16的主标题统一默认水平居中、垂直居中。显式titleBar.horizontalAlign/verticalAlign优先，null继承该版本默认。正文、分组标题、表单标签、按钮布局和业务内容保持其原规则。Pixi按实际字形测量，Unity导出采用相同的有效标题对齐。旧0.31.0包继续按原编译器和视觉规则回放，不在导入时迁移。

使用8份原始真实模型结果确定性重建：spec、状态、动作、绑定及组件树逐项相同，仅选择新版编译/展示合同重新交付。新增模型调用0，旧包与截图保留。

- 完整源码回归1638/1638通过，无跳过：`output/centered-title-regression-v1.log`。
- 8份交付53项浏览器检查通过、错误0：`output/reference-eight-centered-browser-v1/browser-report.json`。新增主标题字形中心与Panel中心偏差小于1像素的检查，重新打开和离线重载后复查。
- Unity文档导出对齐检查通过，本轮未运行Unity原生编辑器验收。
- 8套前后对照、试玩与下载（本地生成产物：`../output/reference-eight-gallery-centered-v1/index.html`，不随源码提交）。

原始8次真实模型的业务成绩不因重建而增加。这项展示修复无需重新向模型提交同样需求。原始审计仍绑定原源码和原输出；新版重建证据逐面板位于`output/reference-eight-centered-v1/<ID>/replay-evidence.json`。

日常Studio已更新，构建摘要`ed5a40c2a5d59dee8c5477cb70a4c9ccdbf8c57e382fe47dc1ab6d55f84725ad`。新版未发布SDK候选为`output/centered-title-sdk-v1/ai-ui-panel-harness-0.1.0-rc.5.zip`，SHA-256 `27787fd059002c85cfa97a946bf12173e146ea8e998541368bcdf4bb87484e6a`。安装检查35项、通用浏览器17项、全组件浏览器12项通过。首次安装检查因预期居中节点数尚未计入新增主标题而失败，记录保留；修正检查为单独验证主标题后，同一包通过，记录为`output/centered-title-sdk-installed-v2`。

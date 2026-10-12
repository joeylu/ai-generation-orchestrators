# 图片卡片对齐

角色选择这类并排卡片，名称与缺图提示原先继承设置字段的左对齐；图片槽和按钮已经居中，三者的视觉轴线因此不一致。新规则将卡片名称与缺图提示居中，保留正文、设置字段和表单标签的左对齐。

## 范围与版本

源码 SDK 与 Studio 启动器的新任务默认目录改为 `modern-centered-cards`。它沿用 `modern-image-slots` 的全部配方、颜色、字号、尺寸和图标；16 个主题只增加 `cardAlignment: centered-v1`，简化标题版为 0.21.0，显式标题版为 0.21.1。PanelSpec / Bundle 仍为 0.15，编译器为 0.30.0。

规则只适用于包含一个静态 Image 和一个无外部标签、`emit` 动作 Button 的分组，可另含 Text 描述。该分组的标题和缺图提示居中，按钮沿用已有居中规则。图片已有来源时没有新增提示。说明正文、多按钮分组、混合设置、表单、重置和提交动作不采用此规则；Tabs 的导航规则也没有改变。

Pixi 使用实际字体的 `renderedTextBounds` 测量文字，按所在槽位水平居中；不插入空格，不改变文案、几何尺寸或状态。UGUI adapter 0.1.6 将相同目标导出为 `MiddleCenter`，现有导入器读取锚点。没有增加原生组件或字体资源。

旧目录和旧编译器仍保留。普通编辑使用保存包自己的主题、目录和编译器，不自动采用新规则。旧版无图片 Spec 可继续使用新目录的标题策略，其编译版本不因此升级为 0.30.0。对旧 0.15 图片包执行“简化／恢复分组标题”时，使用其自身的标题主题对，不顺带改变卡片排版；成功操作仍计入最多 10 次修改，撤销不返还次数。

## 对比与验证

本地入口：`output/card-alignment-review-v2/index.html`。可切换角色选择／声音设置、修改前／居中规则、浅色／深色，试玩并下载各自离线包。

浅色角色修改前直接采用上一轮保存的真实 Bundle，SHA-256 为 `dfc7482b3d70cfd632337d6f15e9c65018d4eadc792b48b1b8870aea71543a68`。居中版由程序保留原 Spec，仅显式替换主题后编译；深色对照也是程序重放，声音设置使用已有夹具。四组修改前后的 Component 文档、动作和状态相同。它们不是新的模型生成结果。

```sh
node --test tests/card-alignment.test.mjs tests/section-headings.test.mjs
node scripts/build-card-alignment-review.mjs --source output/image-slots-real-plan-v2/panel.bundle.json --output output/card-alignment-review-v2
node scripts/check-card-alignment-browser.mjs --review output/card-alignment-review-v2 --output output/card-alignment-browser-final-v1
node --test tests/*.test.mjs
```

2026-10-12 验收：

- 完整回归 1537/1537 通过，日志 `output/card-alignment-regression-final-v1.log`。覆盖五类面板浅深色、绑定图片和占位、描述正文、排除分组、旧 Bundle 往返与编辑、旧标题采纳及撤销。
- 8 份确定性对照构建通过；JSON 往返、Bundle 校验、Web/UGUI ZIP 的字节和逐文件 SHA-256 通过，构建回执 `output/card-alignment-review-v2/acceptance.json`。
- 26 项实际浏览器检查通过，报告 `output/card-alignment-browser-final-v1/browser-report.json`。浅深色三张卡片的名称、占位提示与按钮的实际文字中心偏差均为 0；角色名各出现一次。检查图片不发事件、三个按钮分别发一次事件、宿主关闭重开、设置字段原位、滑块键盘和开关、小屏画布容纳、两份实际下载 ZIP 的字节及逐文件摘要、离线键盘选择和刷新重开。小屏检查只验证画布容纳，不代表触屏可用性验收。
- 首次浏览器脚本的滑块键盘检查未先取得焦点，`output/card-alignment-browser-v1/` 保留 FAIL；改用已有样本测试的焦点方法后复核通过。没有重跑模型或修改回执。
- 最终对照的开发 IIFE runtime 为 979937 bytes，SHA-256 `64a5309a207a252a8d55bea0f9aa168653c36bba44274725d62af161f2c1ae7c`。这不是正式 SDK 的新摘要。

本轮真实模型与图片生成调用为 0，原真实方案、Bundle 和回执没有改写。未发布新的固定 SDK，未修改或部署 Docker/Web 项目，也未重启日常 Studio 服务；旧静态页面和已运行服务的构建不会自动替换。新默认在后续正常构建启动时生效。

正式 rc.3 的下载内容和摘要不变。后续发布必须使用新的唯一版本，并同步 UGUI adapter 版本与 ES/IIFE runtime 摘要；当前源码和本地对照不能替代正式安装物。Unity 原生导入、消费方 Web 验收和用户美术认可均为 NOT_RUN。

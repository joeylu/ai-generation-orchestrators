# 浅深模式与主色

新的用途排版目录`examples/modern-adaptive.catalog.json`沿用下表八种配色，
主题版本为0.4.0、编译器为0.7.3，见[按用途排版](panel-presentation.md)。
下文0.3.0目录和验收记录仍作为上一版固定来源保留。

需求描述可指定风格，Studio不增加独立风格表单。
新版目录`examples/modern-game-themes.catalog.json`提供浅色／深色与四种主色的八个组合。
未指定风格时使用浅色薄荷绿；只指定模式时采用薄荷绿，只指定主色时采用浅色。

| 主色 | 浅色主色 | 深色主色 | 精确主题ID |
|---|---|---|---|
| 薄荷绿 | `#0F7666` | `#63D3B8` | `modern-mint-light` / `modern-mint-dark` |
| 蓝色 | `#1D4ED8` | `#8BB5FF` | `modern-blue-light` / `modern-blue-dark` |
| 紫色 | `#6D28D9` | `#C1A0FF` | `modern-violet-light` / `modern-violet-dark` |
| 橙色 | `#9A4300` | `#FFB15C` | `modern-orange-light` / `modern-orange-dark` |

八个主题均为`0.3.0`，声明`visualStyle:modern-v2`，要求PanelSpec 0.7与编译器0.7.2。
旧Modern Mint 0.2.0继续使用0.7.1，更早主题也按原版本重放，导入不会升级。
任意十六进制主色、目录外风格或矛盾描述需要澄清，不能偷偷近似或创建主题。

## 可粘贴的需求

> 生成声音设置面板，使用深色蓝色主题。主音量范围0到100，步长1，默认70；静音开关默认关闭，开启表示静音；恢复默认按钮只重置主音量和静音。

然后修改：

> 只把主色换成紫色，其他保持不变。

继续修改：

> 改成浅色，沿用当前紫色主色，其他保持不变。

修改控件、文字、初值和布局时，未明确要求换风格就保留当前精确主题。
只换模式时保留主色，只换主色时保留模式。修改仍保留试玩值，可整批撤销。
新版编辑上下文声明`themePolicy:explicit-change-v1`；换主题必须提供本轮需求引句，不能以自由设计选择替代。
程序验证来源和精确引用，模型负责理解自然语言；引句不能证明业务理解正确。

面板携带完整且固定的目录。旧包没有新版主题时，应澄清，不能暗中替换目录。
需要新版主题的新需求从新版Studio生成；原文件与历史交付保留。
组合要求目录及当前主题相同，先明确统一主题再组合，程序不猜测应该采用哪一个。

## 渲染与交付

深色面板使用深色面板、设置行和输入区域，以及浅色正文和高对比主色。
共享组件的Select弹层与Tabs页签头使用固定浅色表面；本版保留浅色导航区并配置深色文字。
导航描边与选中标记按浅色表面调整对比度。错误提示根据行底色选择颜色。
共享组件源码不变，字段、事件、操作范围、资源图片、命名和UGUI脚本不因主题增加副本。

主题保存在PanelSpec精确引用和PanelBundle目录中，Pixi与Unity导出读取同一份编译样式。
只换颜色不改变控件几何、存活字段及试玩值。按钮反馈继续遵守减少动态效果偏好。

```sh
node scripts/build-workbench.mjs --catalog examples/modern-game-themes.catalog.json --output output/my-themed-studio
node scripts/serve-workbench.mjs --workbench output/my-themed-studio --output-root output/my-themed-runs --port 0
node --test tests/panel-themes.test.mjs tests/panel-composition.test.mjs
```

本工作区的八主题与面板对照（本地产物：`../output/panel-theme-review-v2/index.html`）包含8份明确程序夹具、
16份保存真实面板的深色蓝色重编译、3份既有控件夹具和5种同主题组合。
本轮没有新模型调用，不能计为新一轮真实生成稳定率。
浏览器及交付检查单独记录；Unity目标工程运行和用户视觉验收仍为`NOT_RUN`。

749项单元回归通过。主浏览器报告（本地产物：`../output/panel-theme-browser-v1/visual-browser-report.json`）通过678项检查，
含32次精确导入、32份实际下载ZIP的CRC与文件摘要、离线打开和试玩状态重导入，以及27份对照预览。
细节报告（本地产物：`../output/panel-theme-details-v2/theme-details-report.json`）通过23项，覆盖八主题下拉选项、
输入校验、页签，以及可见UI中换主题、保留试玩值与撤销；修改方案是明确导入的夹具，不是模型返回。
代理查看了深色下拉、表单错误提示和浅色橙色截图，未代替用户视觉批准。

首轮完整组合触发批量JSON结构上限，失败产物保留在`output/panel-theme-review-v1/failed-review.json`。
修复后按最多32份来源分别执行原20,000节点/32层快照限制，继续拒绝访问器、稀疏数组、符号和超限单包。
新目录完整组合与本轮5种实际组合均通过；没有扩大单个面板的JSON上限。
细节脚本首轮误读弹层检查字段，FAIL保留；按真实`textBounds`检查后使用新目录完成验收。

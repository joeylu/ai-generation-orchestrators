# 静态图片槽

PanelSpec / PanelBundle 0.15、编译器 0.29.0 在 modern-v3 主题下新增 `image` 内容行，复用 Component 的 Image。它是 Panel 的第八种内容行；Component 的其余基础组件不因此全部成为 Panel 可生成的控件。

## 用法

`modern-image-slots.catalog.json` 在原 `modern-menu-headings-v2` 的主题与配方上增加 `content.image@0.1.0`，保留标题去重和无标题分组最小高度规则。后续源码默认为兼容的 `modern-centered-cards`，另将合格卡片的名称和缺图提示居中，见[图片卡片对齐](card-alignment.md)。旧 Bundle 使用自身固定目录和编译器重放。

```json
{
  "id": "portrait",
  "kind": "image",
  "recipe": { "id": "content.image", "version": "0.1.0" },
  "label": "战士肖像",
  "source": null,
  "width": "fill",
  "height": 180,
  "fit": "contain"
}
```

`source: null` 显示带说明的占位。绑定素材时，`source` 为图库中精确的 `namespace/id@version`，同时固定 `assets.library` 的 ID 与 SHA-256。占位说明必须能完整放入槽内，实际图片不再添加标签空带。

宽度可为 `fill` 或 16–2048 的整数，高度为 16–2048 的整数，实际尺寸还必须满足配方和所在分组的几何限制。`contain` 完整显示，`cover` 中心裁切，`stretch` 拉伸。UGUI 的 `cover` 导出为现有 sprite region 合同中的中心裁切区域，再拉伸到槽尺寸；没有新增 Unity 导入器能力。

图片行没有绑定、输入事件或业务状态。角色选择通过旁边的 Button 或 Select 表达。它支持独立图片与名称、按钮组合，不提供图片点击选择、任意叠层或自动生成人物立绘。

## 生成、编辑和保存

新目录使用 PlanningContext 0.10、PanelIntent 0.11、Proposal 0.10。`assetRetrievalVersion: 0.2` 的 `content-image` 候选仅在显式启用图片检索时出现。素材仍经过已有 PNG、字节数、SHA-256 和资源闭包校验。没有合适素材时保留占位，不用小图标替代肖像，也不接受任意 URL 或磁盘路径。

Spec 0.15 的编辑使用 EditContext 0.15、CodexEditDraft 0.3。图片选择范围开放修改说明、移除行和 `set-image-properties`：

```json
{
  "op": "set-image-properties",
  "rowId": "portrait",
  "source": null,
  "width": "fill",
  "height": 220,
  "fit": "contain",
  "assetLibrary": null
}
```

首次绑定图片必须给出匹配检索上下文的 `assetLibrary: {id, sha256}`；已有素材库固定后不能借此替换库身份。`add-row` 的图片分支另需 `state: null` 和 `assetLibrary`，普通行的字段合同保持不变。图片来源须为当前 Bundle 已包含的素材或固定检索候选。

保存时包含选中的 PNG 资源。重新导入后即使没有原图库，也可保留和编辑已有图片；新增未包含的素材需要匹配的图库。普通编辑保留未涉及的内容、绑定、合法试玩值和资源；撤销不返还已消费的成功修改次数。图片行不会分配虚假状态。

## 确定性验收

```sh
node --test tests/image-card-copy.test.mjs tests/image-slots.test.mjs tests/image-slots-transport.test.mjs
node scripts/build-image-slots-review.mjs --output output/image-slots-review-v4
node scripts/check-image-slots-browser.mjs --review output/image-slots-review-v4 --output output/image-card-copy-browser-v2
node --test tests/*.test.mjs
```

对照页包含文字、肖像占位、绑定验证纹理三种结构的浅深色样本。纹理是程序绘制的几何 PNG，用于检查布局、资源保存和导出，不是人物立绘或模型生成的美术成果。

浏览器检查覆盖实际 Pixi 实例、图片无业务事件、按钮操作、小屏容纳、实际下载 ZIP 的字节与摘要、离线重开及键盘交互。生成和编辑运输测试均使用明确替身，真实模型调用为 0。

2026-10-12 确定性验收结论：

- 全量回归 1479/1479 通过，包括旧版 Bundle 的原样重放及 rc.3 单控件分组回归。
- 图片专项覆盖完整显示、中心裁切、拉伸、占位、首次绑定、修改、撤销、无图库重导入、多分组、Tabs、组合布局、默认音量 57 与合法试玩值保留。
- 六份浅深色样本构建通过；`output/image-slots-browser-v5/browser-report.json` 的 30 项浏览器检查通过。
- 本地开发 SDK 解压到仓库外的安装验证 33 项通过，使用 6 次显式 CLI 运输替身；没有调用真实模型。生成、编辑和导出后包文件完整性检查通过。
- 开发 SDK 的程序回执为 `publicationEligible: false`，不作为正式安装物。正式 rc.3 没有改写或重新上传。

对应本地结果在 `output/image-slots-review-v3/`、`output/image-slots-browser-v5/`、`output/image-slots-sdk-dev-check-v1/`，完整回归日志为 `output/image-slots-regression-final-v3.log`。此前失败记录保留；最终结果来自重新执行确定性检查，未修写程序回执或模型输出。

本次源码能力尚未发布为新的固定 SDK；已发布 rc.3 的内容和摘要不变。生产消费者应等待新的不可变版本发布，不能修改 vendor 作为替代。上游浏览器检查不等于消费方 Web 验收；UGUI 文档及 ZIP 校验不等于 Unity 原生导入通过。

## 角色卡片文案层级

新编排样本让分组标题承担角色名称，不再同时添加“角色／战士”正文、重复名称的肖像说明和“选择战士”按钮。没有肖像时仅提示“待添加肖像”，有素材时不额外显示说明；上下文明确的按钮统一用“选择”，仍保留各自独立的选择事件。额外的角色描述仍可使用 Text 行。

此规则已加入 `panel-intent-v0.11-images.md`，只指导没有明确指定文案的新方案。编译器没有自动改写或隐藏文案；旧样本、已保存 Bundle 和用户明确要求的名称、说明及按钮文字仍原样保留。普通图片尺寸编辑也不会顺带清理已有文案。

2026-10-12 文案修正验收：

- 专项测试 20/20、完整回归 1482/1482 通过，覆盖新方案与旧面板文案、动作和状态保留。
- 六份浅深色样本构建通过；浏览器检查 36/36 通过，直接检查实际 Pixi 渲染文字中每个角色名称只出现一次、占位说明及按钮文案，并复核点击事件、实际下载 ZIP 的字节及逐文件 SHA-256、离线重开与键盘操作。
- 新对照入口为 `output/image-slots-review-v4/index.html`；报告为 `output/image-card-copy-browser-v2/browser-report.json`，回归日志为 `output/image-card-copy-regression-v1.log`。
- 首次浏览器检查因验收脚本误读检查节点中不存在的 `props` 字段而失败；失败报告保留在 `output/image-card-copy-browser-v1/`。修正脚本为读取运行时公开的 `renderedTextBounds` 后，使用相同构建物复核通过，没有改写旧回执。

本次真实模型与图片生成调用均为 0；未发布 SDK，也未修改 Docker/Web 消费项目。Unity 原生导入、消费方 Web 验收和人工美术认可均未验收。

## 单次真实生成复核

后续在新的单次授权下，以普通角色选择需求执行了 1 次 `gpt-6-luna / xhigh` 真实生成、0 次重试。原方案自行生成三张并排图片占位卡片，角色名各出现一次；原始方案未改写，实际 Pixi、独立按钮事件、实际 ZIP 下载与离线重开等 12 项浏览器检查通过。入口为 `output/image-slots-real-plan-v2/review-v1/index.html`，完整摘要、授权消费、原始回执及边界见[真实结果记录](image-slots-real-results-2026-10-12.md)。此结果只覆盖这一例，未发布正式 SDK，人工美术认可、Unity 原生导入和消费方 Web 仍待验收。

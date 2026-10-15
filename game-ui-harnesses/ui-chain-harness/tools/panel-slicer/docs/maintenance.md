# Panel Slicer 使用与维护

本专项已按用户要求工程收口，转入维护阶段，现正式命名为 Panel Slicer（面板自适应工具）。单素材自动配置、LTRB 编辑、Panel 背景包、父容器自适应、透明 PNG 导出和后台入口统一位于 `tools/panel-slicer/`；[工具首页](../README.md) 是统一入口。历史收口范围与证据见 [执行文档 12.8](../../../docs/execution-plan.md#128-panel-九宫格专项收口v023)。实际素材的美术接受与生产交付分别记录。

## 使用

```sh
npm run editor:check -- --browser chrome
npm run editor
```

打开本地 `http://127.0.0.1:4175/slice.html`，或点击画布顶部“九宫格素材”。画布、素材工具、自适应验收三页属于同一版本构建，状态、摘要和验收一起维护。端口冲突时运行 `npm run editor -- --port 4176`。

1. 打开 PNG。初始示例是程序夹具，可以保存原始示例 PNG；用户图片不会自动推断切线。
2. 拖动 L/T/R/B 或输入四边数值，方向键可微调。数值从各自边缘向内计数，单位为原图像素，中心须保留正宽高。
3. 设置素材密度、边框倍率与目标宽高。拖动预览右下角也可改变尺寸，一次手势对应一次撤销。
4. 选择输出分辨率，导出背景 PNG。成品不包含棋盘格、选框或示例文字。
5. 保存 `.slice.json`，保留原始 PNG；重开时先选同一张原图，再打开配置，程序核对摘要与尺寸。
6. 要用于画布，点击“导出背景包”，下载包含原始 PNG 的 `.background.json`。回到画布选中 Panel，在右侧“Panel 背景”区域导入。保持当前 Panel 的尺寸和内容，采用背景包的默认倍率。

画布右侧可选择已导入的背景或恢复“默认工程皮肤”，并按当前尺寸以 1×/2×/4× 导出背景 PNG。Panel 拖动过程中更新真实背景，Esc/取消恢复原尺寸，松开才写入一条历史；不符合内容或容器边界的最终尺寸会回滚。画布保存 JSON 已包含原图及切线，不需要重新链接本机路径。“九宫格素材”入口打开新标签页，保留当前画布编辑。

背景包也可用九宫格页的“打开配置 / 背景包”重新编辑。它保存素材和默认倍率，不绑定画布目标尺寸；重新打开时派生一个合法预览尺寸。PNG 成品本身不携带这些可编辑参数。

## 父容器自适应验收

九宫格页顶部“自适应验收”打开同一构建的 `/slice-runtime.html`。初始素材明确标记为程序示例，可导入 `.background.json` 检查自己的面板素材。切换紧凑/宽/高尺寸，或输入父容器宽高；父容器四周固定留 16 逻辑单位，内部背景自动填满剩余空间，文字和 PixiUI 按钮保留原大小。验收尺寸不写回背景包，可按当前内部背景尺寸导出 PNG。

独立消费代码位于 [examples/sliced-panel/app.mjs](../../../examples/sliced-panel/app.mjs)，复用既有 SlicedBackground、背景包校验/加载、纹理共享与 PNG 导出；没有另一套九宫格计算、尺寸监听器或复制的控件实现。布局使用当前锁定的 @pixi/layout 3.2.0 原生机制：LayoutContainer 在计算背景时调用其 setSize。

```js
import '@pixi/layout';
import { LayoutContainer } from '@pixi/layout/components';
import { SlicedBackground } from './tools/panel-slicer/src/sliced-background.mjs';
import { sliceViewOptions } from './tools/panel-slicer/src/document.mjs';
import { measureSlices } from './tools/panel-slicer/src/geometry.mjs';

// asset/doc 由前文的加载/校验接口提供。它们共享原图和单位合同。
const options = sliceViewOptions(doc);
const background = new SlicedBackground({ ...options, texture: asset.texture(doc.density) });
const panel = new LayoutContainer({
  background, layout: { width: '100%', height: '100%', flexShrink: 0 },
});
const parent = new LayoutContainer({ layout: { width: 720, height: 420, padding: 16 } });
measureSlices({ ...options, width: 720 - 32, height: 420 - 32 });
parent.addChild(panel);
app.stage.addChild(parent);

// 更改父布局前检查内部背景下限，随后由 Layout 自动调用 setSize。
measureSlices({ ...options, width: 960 - 32, height: 360 - 32 });
parent.layout = { width: 960, height: 360 };
app.renderer.layout.update(app.stage);
app.render();
```

该原生容器用法适用于独立游戏消费；PanelDocument/注册组件继续按显式尺寸创建，未新增文档百分比或通用父子自动填充合同。字体与控件内容如何适配仍由布局负责。父容器必须有可计算的尺寸，需在写入布局前校验背景/内容下限；示例将合法父尺寸限定为 320–2048，不等于核心算法的范围。调用方应先销毁全部视图，再释放共享资源。

无效输入保留上一份有效预览，仍可保存及导出该预览；按钮明确标为“当前有效”，提示本次修改未应用。输入框可继续修正，也可点击“恢复到当前有效参数”。PNG 或背景包编码期间有效预览发生变化时不下载旧结果；仅出现未应用的无效输入不阻止导出。配置是可编辑源，PNG 是当前有效尺寸的烘焙结果。

## 唯一参数合同

[slice-document.schema.json](../../../schemas/slice-document.schema.json)：kind=`ui_slice_document`，version=`1.0`。未知字段/版本不自动迁移。

| 字段 | 单位与职责 |
| --- | --- |
| source | 原始 PNG 字节 SHA-256 和物理像素宽高，不存本机路径 |
| bordersPx | 命名的 left/top/right/bottom，原图整数像素；不保存第二套逻辑边界 |
| density | 素材像素/逻辑单位，整数 1–4；@2x 为 2 |
| multiplier | 实例边框倍率，0.125–16；数值越大，边角越小 |
| target | 目标逻辑宽高，编辑工具每边 24–4096 |
| exportResolution | 输出像素/逻辑单位，1/2/4；输出每边最多 4096 像素 |

`逻辑切线 = bordersPx / density`，`显示边框 = 逻辑切线 / multiplier`。支持 @2x 原图奇数像素切线，小数逻辑边界由程序派生。导出分辨率不参与几何计算。目标宽高不得小于对应两侧显示边框之和。

支持不超过 32 MiB、每边最多 4096 的静态 PNG，解码前检查头部与尺寸；拒绝 APNG、EXIF 方向元数据。颜色经浏览器默认颜色空间解码，导出保持渲染结果，不承诺 ICC 字节往返。原始字节单独保留，alpha 不作阈值化。

## 维护入口

| 模块 | 职责 |
| --- | --- |
| tools/panel-slicer/src/geometry.mjs | 无渲染器依赖的几何计算与边界检查，逻辑单位输入 |
| tools/panel-slicer/src/document.mjs | 配置版本、原图绑定、像素换算与导出尺寸限制 |
| tools/panel-slicer/src/source.mjs | 有界 PNG 解码与原始摘要 |
| tools/panel-slicer/src/asset.mjs | 一次解码、按密度复用纹理、统一释放源资源 |
| tools/panel-slicer/src/sliced-background.mjs | Panel 与导出共享的 SlicedBackground |
| tools/panel-slicer/src/export.mjs | 同一背景对象的固定区域提取与 PNG 编码，不负责下载/编辑状态 |
| tools/panel-slicer/web/ | 文件选择、手势、历史、预览与下载，只维护一份已校验文档 |
| configs/component-registry.draft.json | Panel 的 pixelsPerUnitMultiplier 属性、默认值与范围 |
| schemas/panel-background.schema.json、tools/panel-slicer/src/package.mjs | 可移植背景包；复用切线 Schema 的字段，不维护第二套单位合同 |
| src/panel/backgrounds.mjs、background-pool.mjs、prepare.mjs | 绑定操作、原图摘要核对、按源共享纹理与候选场景事务 |
| src/editor/panel-background-controls.mjs | 所选 Panel 的背景导入与 PNG 下载入口 |

SlicedBackground 固定原图 UV 切线，内部几何宽高乘倍率、内部缩放取倒数；外层仍是目标宽高。resize、setSize 和 width/height 赋值都经过相同检查。不能把 leftWidth 等切线除以倍率来实现此效果。

运行时皮肤提供 `backgroundSpec(role) -> {texture, borders}`，borders 使用纹理逻辑单位；fixture 与 PNG 包加载器均实现该接口。Panel 从该接口创建背景，倍率保存在组件属性中。运行时在修改几何前检查倍率后的边框下限，既有 minSize、内容安全区和布局限制也保留。倍率不会改变文字大小或 contentInsets。

```js
// 从上述对应模块导入；bytes/JSON 由调用方读取，不隐式发起 URL 请求。
const asset = await loadSliceAsset(bytes);
const doc = validateSliceDocument(input, asset.source);
const background = new SlicedBackground({
  ...sliceViewOptions(doc), texture: asset.texture(doc.density),
});
container.addChild(background);
background.resize(nextWidth, nextHeight);
const { blob } = await exportBackgroundPng(renderer, background, doc.exportResolution);
background.destroy(); // 先释放全部消费视图
asset.dispose();      // 再释放共享纹理和源图片
```

工作台预览使用现有 createRuntime/Panel 适配器及空内容槽，没有另一套 Canvas2D 九宫格算法。背景不拥有 Texture；更换尺寸、切线和倍率不重新解码/上传原图。

## 第一版边界与扩展

- 中心始终填充；尚无 tiled、空心中心、自定义四角变形、atlas rotation/trim 编辑。
- Panel 支持倍率，Button/Input 等保留原有九宫格行为。扩展时复用背景与几何接口，再测试状态、标签、命中区域，不复制公式。
- 父布局应将分配的逻辑尺寸传给组件 resize。PanelDocument 仍按显式尺寸布局，没有新增通用百分比/flex 自动填充规则。
- 单素材配置可用于单背景消费，不自动修改整套皮肤的角色、字体、版本或接受记录。向 skin-import 迁移时派生逻辑 borders，再由包构建器校验/发布。当前 skin-pack 0.1 仍要求整数边界，不能静默舍入奇数像素/@2x 的边界。
- canvas 页面仍绑定工程皮肤；背景包只显式替换所选 Panel 的背景，不改整套皮肤或其他控件。
- 本批范围集中于 Panel；普通 Image、按钮、图标等仍保持原有实现，不做全控件 Image 抽象改造。Dialog 等出现明确动态背景需求后可复用同一内核。

## Panel 文档与资源所有权

`PanelDocument 0.2` 的可选 `panelBackgrounds` 表保存原始 PNG Base64、source 摘要/尺寸、density、bordersPx。节点 `props.backgroundRef` 引用该表；节点自己的 size 和 pixelsPerUnitMultiplier 是实例参数。多次导入相同素材及切线复用同一条资源，复制 Panel 保留引用，倍率可分别编辑。0.1 文档在工程绑定匹配时继续可读；带背景资源的文档明确标记为 0.2。

JSON 文件最多 12 MiB，最多 16 条背景配置、原图字节合计 8 MiB、不同原图解码像素合计 4096×4096。超过上限拒绝导入，不缩放或改写原图。单素材工作台仍允许 32 MiB PNG，其画布背景包另受上述限制。

`preparePanel` 先校验文档，再从 background pool 获取已核对摘要的纹理，最后调用同步 `compilePanel`。当前场景和候选场景共享源纹理引用；候选失败释放自身引用，旧场景不变；旧视图销毁后再释放引用。尺寸、倍率、试玩切换无需重新解码。撤销到已释放的素材时重新从文档原始字节解码。默认工程皮肤的内容安全区、组件最小尺寸仍适用，素材切线不充当 contentPadding。

外部调用同步 `compilePanel` 时通过 `panelBackgrounds: Map<id, {texture,borders}>` 显式传入已加载资源；未知引用拒绝，编译器不隐式加载 URL 或文件。浏览器消费可直接组合 `createBackgroundPool` 与 `preparePanel`，销毁场景时调用返回的 dispose 以同时释放视图和资源引用。

维护检查：`npm test` 验证合同/单位/失败条件；`npm run editor:check` 验证画布与九宫格；共享 Panel 改动再运行 `npm run test:components` 和 `npm run skins:check`。注册表修改后运行 `npm run contracts:build`。来源摘要覆盖 slicing、slice-editor、Schema、样例和浏览器断言；成功前不切换 current，报告与构建记录不得手改。

## 规则型 Panel 自动配置（v1）

九宫格工作台默认导入 PNG 后自动配置；画布选中 Panel 也可直接使用“导入 PNG · 自动配置”。高级设置默认折叠，可显式启用手动导入。已保存配置和背景包按原值恢复，不重新分析。

`tools/panel-slicer/src/analyze.mjs` 是不依赖渲染器的确定性像素分析器。它逐像素比较完整列/行与中心列/行的预乘颜色及 alpha，寻找连续重复区域；两个方向都须至少保留原尺寸的四分之一且不少于 4 像素。非平坦边界内保留一个一致像素作为采样余量。颜色/alpha 容差为 2/255；中心 alpha 小于 32、无稳定区域、明显渐变和复杂纹理拒绝自动配置。它是保守的规则检测，不是美术接受或适用于任意图片的保证，也没有声称进行视觉模型或多尺寸图像评分。

`automatic.mjs` 将检测结果转换成已有 SliceDocument：density=1，multiplier=max(1, 原宽/首次目标宽, 原高/首次目标高)。这是初始显示约定，不是从 PNG 猜测物理 PPU；超过现有参数/尺寸限制仍拒绝。工作台默认目标 480×280，画布使用所选 Panel 的尺寸；后续 resize 不重新分析、不改变倍率。分析只在导入时进行，不进入渲染循环。

失败时释放候选资源，保留上一份素材、文档和历史，显示拒绝原因；用户可更换素材或主动选择高级手动导入。导出的背景包和 PanelDocument 保存最终明确参数及原始 PNG，继续复用已有运行时与 PNG 导出。没有新增 LLM、网络请求或私有服务依赖。

### 结构识别补充（v2）

重复行列检测失败后，`structure.mjs` 可识别有明确四边框的填充纹理面板：先以 alpha≥32 的主体占用率定位矩形，要求主体填充率至少 88%；再比较中心颜色分布与四边剖面，要求四边均能分离出边框。中心有明显透明洞、强烈图案或无明确边框时仍拒绝。轮廓靠边扫描保护圆角、倒角和肩部；保护后没有足够中心区域也拒绝。

这套启发式并非语义识别或美术接受。内部纹理仍由现有 NineSliceSprite 拉伸，边缘上的重复装饰也可能变宽；不保证木纹/纸纹颗粒保持原尺寸。配置结果仍保存为原有格式，不改变素材像素或透明度。包含文字/插画的误接受风险不能只靠像素统计完全排除；真实样本的多尺寸视觉审查独立于程序验收。

### 尺寸适用策略（texture-balanced-v1）

结构检测得到的纹理面板自动携带可选 resizePolicy=texture-balanced-v1；旧配置不含此字段时保留旧行为。规则集中在 measureSlices，工作台、Panel 文档校验、运行时预检、SlicedBackground 和原生布局消费共享。背景包 asset 和 SliceDocument 保存策略；PNG 本身只保存像素，不包含规则。

设中心原宽高为 Cx/Cy（源像素先除 density），边框总和为 Bx/By，实例倍率 M，目标 W/H，则中心拉伸为 sx=(W*M-Bx)/Cx、sy=(H*M-By)/Cy。任一方向小于 0.25、大于 4，或横纵比值超过 3，拒绝当前尺寸。阈值是保守的产品约定，不是视觉质量证明；输出分辨率不参与判断。修改策略需新标识，避免旧文件随实现变更静默改变含义。

自动纹理导入工作台时以接近原图比例的尺寸开始；画布直接导入则验证用户当前 Panel 尺寸，失败不覆盖原背景。后续拖动或编辑失败保留上一份有效状态。背景包重开按源尺寸、密度和倍率恢复合适的起始比例。重新选择素材或调整容器比例仍可能必要，程序不会偷偷修改倍率绕过规则。

## 独立构建与依赖边界

- `npm run slicing:check`：只构建并验收九宫格工作台和原生布局示例，输出 `previews/slicing/`；具有独立的锁、current 指针、来源记录及验收报告。
- `npm run slicing:status`：只判断九宫格来源与产物是否有效。
- `npm run slicing:preview -- --port 4178`：独立服务，保留 `/slice.html`、`/slice-runtime.html`；根路径也是九宫格工具。
- 原 `editor:check` 仍执行画布及九宫格完整集成验收，输出 `previews/editor/`。默认 editor serve 优先使用有效的独立九宫格产物；画布过期时不妨碍有效的九宫格页面提供预览，画布入口待重新验收后恢复。

九宫格来源通过 esbuild 的实际本地模块依赖图取证，并补充运行数据、构建器、Schema 和独立浏览器测试。画布 app/CSS、画布尺寸预设、编辑区块、Panel 文档预设和画布测试不属于它的来源。共用运行时、组件注册表、皮肤角色、基础模板、依赖锁及共用构建代码发生变化时仍需重新验收，这是实际依赖而非独立插件隔离。

独立入口只注入 registry/usage/template/profile，不载入画布预设、区块、文档绑定。仍使用真实 Panel 与同一套 SlicedBackground，没有复制算法或生产源目录。`tests/editor-scope.test.mjs` 验证范围排除、共用依赖失效、独立输出及最小数据边界。

## 后台调用

单张 PNG 与目标尺寸可通过本地 CLI 或 Node 函数自动产出 PNG，不必打开预览页面。参见 [后台入口](integration.md)。复用同一自动分析、尺寸校验和 Pixi 渲染，独立于预览构建。

# 生成图到标准部件：定位与规范化

这是离线单板后处理工具，接收已保留的生成结果，产出可审核候选。不调用模型，不修改原图或原始失败记录，不将候选当作完整皮肤包。本文的规范化与修整是独立工具，不等于 Studio 的完整批次定位和组包流程；后者见[任务 DAG](skin-task-dag.md)。历史阶段与试验结论见 [执行文档](execution-plan.md)。

## 维护入口

| 内容 | 维护位置 | 派生产物 |
| --- | --- | --- |
| 部件 ID、槽位、目标尺寸、形状和伸缩方向 | 原有 skin-template-set.draft.json | 冻结的 geometry.json；定位范围、文件名和输出板 |
| 检测与重采样策略 | [skin-normalization.json](../configs/skin-normalization.json) | 冻结策略、检查和操作参数 |
| 风格意图 | 每套风格自己的 style.json | 生图提示词；后处理不重绘材质 |
| 源裁切框、身份候选、输出清单 | 程序计算 | source-parts、assets、manifest、report；不要手工修改 |
| 语义/美术接受 | 可预览核对；尚无完整的正式接受/发布入口 | 当前固定 unreviewed / productionReady=false |
| 完整皮肤的使用参数 | 独立 metadata profile 与任务派生入口；不由本单板工具补齐 | 完整组包继续验证切线、安全区和最小尺寸 |

新增受支持形状的部件、修改板数或 outputScale，从模板派生，不另写部件名单。本工具的形状规范化仅支持其明确实现的处理方式；九宫格大面板、非胶囊长条和多块组合素材不应强行套用。完整批次另有定位和组装入口；S05 材质按独立模板的固定矩形提取，不走本工具的单主体连通规则。

## 处理方法

1. 核对计划、接收回执、参考输入和原图摘要，读取冻结模板。活动模板已变更时阻断；仅组件注册更新时仍可处理历史原图，但明确标记 consumerCompatibility=requires-rebind，不能直接用于新组件合同。
2. 查找 alpha > 0 的八连通区域，使用 alpha ≥ seedAlpha 的主体像素重心。重心唯一落入模板槽位时产生身份候选；同槽多件、缺件、未分配主体、强碎片或软边粘连多个强主体均阻断。
3. 只丢弃与主体断开且没有强像素的低透明度碎点，限制丢弃的 alpha 总量。主体相连的连续 alpha、软边和内部透明孔保留；不做全局二值化、颜色抠底、自动补画或彩边重绘。
4. uniform 部件等比缩放并居中留透明边。胶囊形 horizontal/vertical 部件沿短轴等比缩放两端，只改变中段长度；源端部范围由短边的一半推导，数值写入 operation，仍需观察真实材质效果。
5. 使用预乘 alpha 的像素面积采样；RGB 在源 sRGB 编码空间求平均，不是线性光重采样。输出保留连续 alpha，alpha=0 时 RGB=0。尺寸规范化不保证两态的原始轮廓或高光一致。
6. 按 bodyRect 放回精确尺寸的板，保存独立 PNG。检查尺寸、区域外像素、空件及独立 PNG 与板图裁切的一致性。同版本工具从原图重新计算并逐像素核对，不能仅重写摘要来伪造结果。

身份依据是几何位置，不是视觉语义识别。如果模型互换了开/关外观，单靠槽位无法识别；review.html 提供编号、资产 ID、状态及逐件前后对照。状态组来自原模板，报告列出 alpha ≥ 128 的轮廓边缘差值；该阈值只用于诊断，不改输出 alpha。

阈值包括 seedAlpha、minimumCorePixels、maxDiscardedAlphaMassFraction、主体尺寸变化范围、画布/固定比例容差和最大放大倍数。修改策略后新建构建，旧版保留；current 识别旧策略或旧工具，不自动放宽阈值以通过某张图。

## 命令与产物

在本 Harness 目录执行，路径替换为本次计划与尝试：

```powershell
node scripts/skin-normalize.mjs build --plan work/skins/example/plans/<plan-sha256> --sha256 <plan-sha256> --attempt work/skins/example/attempts/<plan-sha256> --out work/skins/example/normalized
node scripts/skin-normalize.mjs status --out work/skins/example/normalized
node scripts/skin-normalize.mjs verify --package work/skins/example/normalized/builds/<build-id> --manifest <manifest-sha256>
```

可用 `--policy path/to/policy.json` 指定明确的策略修订。含用户图像的输出强制放在本 Harness 忽略的 work/ 下。build 使用独占锁、新候选目录和原子 current；失败保留诊断候选，已有 current 不变。

- inputs/：原图、旧计划及冻结输入、接收回执、原始检查、后处理策略。
- source-parts/：定位出的原部件，保留相连的连续 alpha。
- assets/：目标尺寸的独立 PNG，文件名就是资产 ID。
- normalized-sheet.png：按原模板排列的无文字透明板。
- review.html、overview.md：前后与逐件核对入口。
- manifest.json、report.json：来源、坐标、操作参数、摘要、检查和待审核项。

manifest 的 kind 是 ui_skin_normalization_candidates，不能冒充 ui_skin_asset_pack。仍缺其余必需板、各资产使用元数据和美术接受。verify 返回资源完整性结果；工具版本不同则不声称重放通过，status 标为 stale。current 不代表生产可用。

初版 S03 清理 2,508 个弱透明游离像素，状态轮廓仍有差异；该历史保留。最新候选继续进行下述可选修整。原生成图的尺寸/几何 rejected 记录保持不变，后处理不提交模型。

## 可选的状态与彩边修整

`refinement` 是可选策略，通用配置默认不启用。本次皮肤使用本地 `work/skins/woodland-parchment/normalization-policy.json` 修订 3；它是本套皮肤处理参数的维护入口。新增风格不能无条件复用这里的排除色相。

可选 `smoothEnvelope` 在状态对齐后、彩边修整前执行，仅支持圆形与明确的胶囊模板。它根据 coreAlpha 主体框拟合外沿，以 paddingPixels/insetPixels 控制边界，以 featherPixels 保持连续 alpha；输出 alpha 不超过原值，透明孔不填补，内部 RGB 不模糊。单件损失超过 maxRemovedAlphaMassFraction 即失败，操作及损失写入报告并参与重放。本套使用 128/0/0.2/1 与 3% 上限。带装饰或不规则外形须另定策略，不能强行套用。

状态组仍来自冻结模板。先按 coreAlpha 确定各态主体边界，对齐到居中的共同主体框；每轴变化不能超过 maxAxisScaleChange。随后逐像素取组内最小 alpha，使两态透明轮廓完全一致；不向透明孔补画。每态被移除的 alpha 总量受 maxRemovedAlphaMassFraction 限制，超过即阻断。这一步明确允许有限的分轴对齐，不再声称所有修整都是纯等比缩放。

彩边只在指定边缘带处理。满足 hueRanges/minSaturation 的异常颜色，从附近足够不透明、位于边缘带内部且不在异常色相范围的原像素取 RGB；alpha 不变。内部同色像素保留，找不到可靠来源或修改数量超预算就阻断。bandPixels、searchRadius、coreAlpha、maxChangedPixelFraction、maxUnresolvedPixels 分别维护；本次限制在 2 像素边缘带、8 像素搜索、红/紫红高饱和色相、3% 可见像素修改上限。没有按错误结果自动放宽策略。

修整前的规范化 PNG 保存在 baseline-assets/；原裁切仍在 source-parts/。manifest 每个资产记录 core-frame、共同 alpha 损失和 RGB 修改数量，同版本 replay 核查基线与结果。技术检查不能替代对金边厚度、纹理连续性和状态识别的人工观察。

## S03 局部组件验收

候选先通过独立的 [skin-pilot.mjs](../scripts/skin-pilot.mjs) 进入局部验收。它读取候选 manifest 和当前模板/角色映射，消费全部 9 个 PNG，组装 Switch、Slider、ProgressBar、ScrollView；字体、Text/Container 使用已有工程脚手架。缺少皮肤角色时拒绝，不补一张程序纹理来伪装覆盖。

验收参数只维护在 [skin-pilot.json](../configs/skin-pilot.json)：三档宽度、少量控件几何和角色的尺寸密度规则。校验器复用 runtime-theme 字段限制；资产 ID 仍通过当前角色映射取得。显示密度由 PNG 的短轴尺寸除以目标逻辑尺寸派生，端部切片同步换算为逻辑单位，避免把 48 像素圆头直接压到 20 像素高却保留原宽度。

滚动条宽度维护在 profileOverrides.geometry.scrollbarWidth（当前 10）；minThumbLength（当前 24）只约束短滑块下限，其余长度由视口/内容比例计算。生产与局部 PNG 加载器统一使用线性过滤和自动 mipmap 改善缩小采样，这属于运行时能力，不修改源图片。局部浏览器检查包含真实纹理的采样设置、轨道/滑块宽度及长度比例。

```powershell
node scripts/skin-pilot.mjs --package work/skins/example/refined/builds/<build-id> --manifest <manifest-sha256> --out work/skins/example/component-pilot
node scripts/skin-pilot-view.mjs --out work/skins/example/component-pilot --port 4176
```

后一个命令验证构建文件摘要与源版本，只在 127.0.0.1 提供一份静态交互页面。没有写入 API、模型入口或远程部署。页面可切换横竖、点击与拖动；报告、截图和内嵌字体/纹理随构建保存在私有目录。

这是局部消费证据，不能代替全部必需板、16 类真实风格绑定、字体生产授权及完整皮肤包。生产 PNG loader 的完整覆盖要求继续生效；局部工具没有修改该要求。

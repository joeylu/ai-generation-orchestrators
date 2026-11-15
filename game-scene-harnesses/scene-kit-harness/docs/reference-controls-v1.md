# 投影与前景条件输入合同（0.36.0）

本版实现显式的受控参考入口：已审阅规范样块与提示 → 独立控制设计接受 → v20
冻结计划 → 新单次计算确认 → 一张完整参考 → 原有七标准/实测接受门。当前支持
清爽手绘预设的小样，不代表模型已实现投影锁定、跨主题效果已通过或资产回拼完成。
默认v18和显式v19继续保留，不自动迁移旧项目或把控制入口应用到所有风格。

## 确定性生产与审阅身份

`./reference-controls` 提供固定v1的 `controlGuideRecipe`、`renderControlGuides` 和
`compileProjectionFocusPrompt`。前两张512×512 PNG分别为正立面示意和清晰前景
示意，第三张1040×512总览仅供审阅。样块是正向画法语法，不是地图模板或画风，
其中的形状、位置、数量与8像素白带不成为生成图的像素验收标准。

v1图像和提示策略保持重放字节；修改它们需新策略版本和准确审阅。本次将用户
已接受包的允许行为移入核心，导出图指纹与原审阅样块相同，未复制工作目录或
接入宿主配置。提示将投影/清晰度置于前面，主体来自spec v3，画风来自style v2；
zIndex、parallaxX、摘要等保留为计划数据，不转成画面指令。

当前导入格式为已审阅的 `ai_scene_projection_focus_control_review_packet_v1`，
含8个固定允许载荷：两张样块、总览、配方、方案、清单、提示草案、README。
程序在路径查找前校验允许名单、重复、大小与摘要；重绘三张图并比较字节、
重编译提示，并核验方案对spec/style/requirements及拒收来源的绑定。即使攻击者
重算包摘要，替换样块、提示或调换图角色仍不能通过。

历史packet中的pending/not-implemented是审阅时的快照，原字节保留。导入后
另写 `ai_scene_reference_controls_v1`，再由显式
`ai_scene_reference_controls_review_v1` 接受准确packet；不手改原包为accepted。
控制接受既不接受原场景美术，也不授权计算。

## 当前试验范围

来源须为当前已接受spec/style下，技术通过且用户明确拒收的v18/v19。未审图、
未知或技术失败不能充当该入口的来源。画风须为preset、name为清爽手绘、anchors
为空；custom及其他提示策略不在此版范围，不能用此入口静默删除必要锚点。
上传图依旧仅供风格，这次明确使用预设文字，不把旧整场景图发给模型。

## v20请求

请求严格含两个已接受原字节输入，顺序为：

1. `internal-projection-example`：正立面与薄雪沿的画法。
2. `internal-focus-example`：前景轮廓清晰度。

总览、旧场景图和用户风格图不进入该试验请求。宿主须支持imageToImage及至少
2图；计划绑定设计、控制包、人类控制接受、被拒来源及输出政策。实际构图在
准确参考接受后冻结，没有相机硬锁、预先指定的关卡坐标或自动语义检测。

提示等于审阅包里的完整草案。通用修订接口仍可对terminal v20准备新ID，但
intent必须为空、控制包与政策不变；不能借任意INTENT改掉已审阅提示。未知终态
不自动重试，每个新请求均需新的准确计划单次授权。

生成结果沿用v18/v19的原生PNG技术接收、连续字节保留、七标准/数量/表沿/证据
检查和准确实测packet接受门。raw接受绕门、把v20目标交给旧固定组装器均被
阻止；target v2绑定完整计划摘要，实际资产拆分/遮挡补全/忠实回拼仍未实现。

## API与CLI

底层 `./generation`：

- `importReferenceControls(root, {controlId, sourcePlanSha256, reviewPacket}, artifactsMap)`。
- `reviewReferenceControls(root, controlsSha256, receipt)`；receipt目标为packet摘要。
- `getReferenceControls`、`previewReferenceControlledPlan`、`freezeReferenceControlledPlan`。

项目 `./reference` 提供相应 `importReferenceControlProject`、
`reviewReferenceControlProject`、`previewReferenceControlledProject`、
`planReferenceControlledProject`。run/authorize/assess/review/target继续复用原入口。

```sh
npm run reference -- controls-import --root PROJECT --review REVIEW_DIR --options IMPORT_JSON
npm run reference -- controls-review --root PROJECT --control CONTROL_SHA --decision RECEIPT_JSON
npm run reference -- preview-controlled --root PROJECT --options PLAN_JSON
npm run reference -- controlled --root PROJECT --options PLAN_JSON
```

IMPORT_JSON为 `{controlId, sourcePlanSha256}`，PLAN_JSON为
`{planId, controlsSha256}`。prepare/import/review/preview/freeze均不调用模型，CLI
没有`--yes`。只有run在新单次确认后调用明确宿主。Studio HTTP无任何新增能力。

规范图仍可能影响形状或画风；首张真实原图与初始布局的接受只确认该样张，跨主题
效果和稳定性未验证，不能把软条件宣传为硬控制。本版工程测试仅用合成夹具与替身，
不消耗真实图片计算；真实生成由另行批准的准确计划执行。

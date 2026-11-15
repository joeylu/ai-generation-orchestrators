# 自包含地形候选包 v2

0.16.0 在原 kit v1 之外增加显式 `ai_scene_kit_v2`。它把已验证连续地形试样变成
独立、可编辑、可导出的 art-candidate；生产美术验收仍未完成。原 v1 Schema、
夹具、散列变体规则和编译结果不迁移，未知字段与未知版本继续拒绝。

## 数据与验证

[kit v2 Schema](../schemas/kit-v2.schema.json) 复用原目录/规则/预设合同，并要求
terrainAppearance。该字段绑定固定连续取样 Profile、准确材料源/试样摘要、body/cap
PNG 路径、字节数、SHA-256 与尺寸，visualAcceptance 恒为 not-assessed。

当前 Profile 明确限定 64×64、1:1、零锚点/偏移的地形片，每个邻域角色恰好 16
个变体，数组按 phase=0..15 排列。选择公式为 `positiveMod(y,4)*4+positiveMod(x,4)`，
不排序数组，不依赖 seed、镜头或地图宽度。原 kit v1 仍排序变体并使用旧散列规则。

body-field 为 253×253，cap-field 为 253×8，分别与现有曲线的 256 世界单位周期
对应。字段是 kit 的直接依赖，与模块 PNG 共同计入像素/字节预算，检查普通文件、
路径安全、PNG 结构、连续 Alpha、尺寸、非空与摘要；两个字段不可相互或与其他
依赖别名。新包不允许以外部地形试样开关来替换其导出身份。

v2 包的默认/检查地图可显式使用作者 v1/v2/v3；共享语义仍验证邻域角色、矩形
连接、闭合曲线、预设、边界与检查图覆盖。其编译结果显式为 `ai_scene_compiled_v4`，
包含 terrainMaterial，其他几何与作者格式保持对应。渲染器遇到带材质的曲线却缺少
纹理时拒绝更新；不能静默用工程色替代。原编译 v1/v2/v3 仍按原规则呈现。

## 候选生产

`buildSceneCandidate(root,baseKit,options,terrainRoots,out)` 在工作流事务中重放当前
设计、远山源接受、材料源接受、原始/修订/连续试样完整字节证据，再用 allowlist
组装新目录。options 为 `{candidateId,materialPlanSha256,environmentPlanSha256,
environmentOptions}`，terrainRoots 为 `{originalRoot,revisionRoot,studyRoot}`。
不生成图片，不追加作品决定或生成尝试；输出只允许新目录。verify 使用相同输入
逐字节重编译，不能只凭 manifest 自述通过。

当前候选含 752 地形 PNG（47×16）、有限远山与纯色天空、两张曲线材质、5 个地形
预设、默认 v3 地图和 47 角色检查图。新默认图展示平地、连通丘陵、缺口、台阶和
悬浮台；它是编辑演示，不证明跳跃可达或物理正确。工程环境标记不进入此包。

```powershell
npm run workflow -- build-scene-candidate --root WORKFLOW --kit BASE_KIT --file OPTIONS_JSON --original ORIGINAL_PROOF --parent REVISED_PROOF --study CONTINUITY_STUDY --out NEW_DIRECTORY
npm run workflow -- verify-scene-candidate --root WORKFLOW --kit BASE_KIT --file OPTIONS_JSON --original ORIGINAL_PROOF --parent REVISED_PROOF --study CONTINUITY_STUDY --out CANDIDATE_DIRECTORY
npm run studio -- --kit CANDIDATE_DIRECTORY/kit
npm run scene -- export --root CANDIDATE_DIRECTORY/kit --map default --out NEW_EXPORT_DIRECTORY
npm run scene -- verify-export --root NEW_EXPORT_DIRECTORY
```

远山仍是四屏有限图片，循环接缝失败和原派生报告保留；天空是工程纯色，树林、
遗迹与前景待真实生成/接受。候选组装不把这些缺项或地形重复周期记成通过。

## 保存、ZIP 与消费

原 `exportScene` 和 `openSceneExport` 即可携带新 kit 的完整依赖，含材质场，严格
重新编译作者数据。新增 `exportSceneArchive(handle,map)` 返回确定性 ZIP 字节：
同样的 manifest/作者/编译场景/kit，固定时间、标准 CRC32、排序的安全路径，单包
不超过 256 MiB、8192 文件。ZIP 仅输出，不提供任意 ZIP 上传/解压服务。

本地 Studio 的“下载场景资产包 ZIP”按当前 revision 打包内存文档与已配置的不可变
kit。旧 revision 为 409；跨源和请求选择路径仍拒绝。解压后可用 verify-export
检验，再从其中 kit 和作者 JSON 重开。外部试样模式依旧明确提示不包含其临时外观。

Pixi 适配与 [消费例子](../examples/consume-scene.mjs) 共用 loadTerrainMaterial，
加载地址与纹理生命周期由宿主控制。body 双轴重复、cap 横向重复/纵向钳制，均为
线性采样。离开场景解绑 viewport 事件并销毁自身树，宿主共享纹理不销毁。目标
项目必须先验证制品，再接入自己的资源/场景生命周期；本仓库未改写消费项目。

本版本是本机工程候选，未打不可变发布标签，不能将其称为已验收的生产安装版。

## 0.17.0：独立分层审阅候选

`buildSceneReviewCandidate` / `verifySceneReviewCandidate` 先完整重放原候选的材料、
地形试样和已接受远山，再重放五个准确来源的技术接收与环境派生。封闭 options
为 `{reviewId,baseCandidate,environmentSources}`，可显式增加 `layoutRevision`，仅接受
initial-v1（省略时的原摆放）、grounded-v2（避免横跨缺口）和 grounded-v3（再调整
可见底座锚点）。每版保留旧版确定性重放，不覆盖旧包。environmentSources 必须
正好包含 sky、forest、
trees、arch、wall，每项为 `{planSha256,layoutStudy}`。不增加图片计算或作品决定。
来源可为 pending-visual-review 或 accepted；拒绝技术失败、视觉拒绝、角色混用、
过期来源。获准确批准的补框来源使用独立 preparation 摘要，包含原 PNG 与批准证据。

这是明确的审阅包：productionKit=false、fullKitVisualAcceptance=not-assessed，
逐项记录 sourceArtAcceptance；源未接受时写 pending-human-review。它不替代原来
要求接受来源的有限远景示例，也不将源接受推导成派生或整包接受。

新 catalog v2（仅 kit v2 可使用）显式增加 background，要求不透明、repeatAxis=none，
编译为普通 Sprite。原 catalog v1 保持封闭。environment 仍要求透明像素；strip 仍
专用于横向重复。新 v2 背景未加入旧的精确模块生成批次合同。

固定四屏默认图保留原地形、丘陵、格子连接、缺口和平台，添加独立天空、远林、
树组和遗迹，删除纯色天空占位。天空 1024×576/视差 0，远山使用实际宽度/0.15，
远林 1536×512/0.16，远林原 384 高目标仍失败。森林画布位于 y=64，保留全 Alpha；
两条远景均为有限 Sprite，接缝未认证。程序为 cameraLeft=0..3072、1024×576 固定
视口计算有理数覆盖，不推广到扩建后的地图、自由缩放或循环地图。

树组/拱门/断墙的派生 PNG 分别等比面积缩小到 512×512、640×480、512×256，
从完整 proof 图读取，不截掉微弱 Alpha，不改源文件。材质、来源、派生、缩小摘要
与审阅状态留在候选包；普通导出只携带精确运行依赖与作者/编译数据。
默认图 15 个环境实例；叶丛真实触边未获修复批准，排除并列为缺项。

grounded-v3 的树组/遗迹 anchorPx.y 取派生图中最后一个 Alpha≥128 的像素行。
这只定义地图放置的可见底座基线；原生/派生 RGBA、画布、QA、轮廓和透明边带
完全保留。阈值不用于接收、裁剪或删像素。派生报告另记录锚点政策，图片摘要与
此前相同；候选源的 Alpha<128 细节仍可见并可延伸到锚点下面。

```powershell
npm run workflow -- build-scene-review-candidate --root WORKFLOW --kit BASE_KIT --file REVIEW_OPTIONS_JSON --original ORIGINAL_PROOF --parent REVISED_PROOF --study CONTINUITY_STUDY --out NEW_DIRECTORY
npm run workflow -- verify-scene-review-candidate --root WORKFLOW --kit BASE_KIT --file REVIEW_OPTIONS_JSON --original ORIGINAL_PROOF --parent REVISED_PROOF --study CONTINUITY_STUDY --out REVIEW_DIRECTORY
```

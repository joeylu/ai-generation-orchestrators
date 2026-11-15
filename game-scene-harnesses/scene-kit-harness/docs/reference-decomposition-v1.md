# 准确参考图的可见拆分追踪（0.37.0）

本页是旧 target v2 可见像素实验分支。若任务是判断景深、遮挡和可编辑素材职责，
先读[参考图职责拆分审图](reference-responsibility-review-v1.md)，再走 coherent
主链；无需先运行本页分割。下文未实现的能力指此精确提取分支。

本版在已接受target v2之后增加确定性的追踪工作包与可见像素归属检查。
它没有图像理解/自动分割服务，没有恢复材质Alpha、遮挡形状或完整资产。
来源生成、补全、可复用模块、忠实资产回拼和整包接受仍待实现。

0.38.0另提供[显式CPU种子分区生产者](reference-segmentation-v1.md)，可产生待审
归属候选；不改变未知/冲突、材质Alpha和语义接受边界，不是自动场景理解。

## 入口与身份

`./reference`公开四个独立离线操作：

```text
npm run reference -- decompose --root PROJECT --out NEW_DIRECTORY
npm run reference -- verify-decomposition --root PROJECT --out DIRECTORY
npm run reference -- ownership --root PROJECT --map NATIVE_LABEL_PNG --out NEW_DIRECTORY
npm run reference -- verify-ownership --root PROJECT --map NATIVE_LABEL_PNG --out DIRECTORY
```

项目入口重新读取当前工作流，通过已有核心API取得已接受target v2和准确原PNG。
未接受、不同来源或当前候选尚未接受均停止；不读取调用者随意提供的target来认证
人类决定。不新增工作流事件、授权或尝试，不调用任何模型，不改变Studio HTTP。
输出必须是工作流和源码外的新目录；复检重编译并逐文件比对，附加文件也拒绝。

`./reference-decomposition`公开纯函数`decompositionReviewFiles`、
`visibleOwnershipFiles`及标签表`visibleOwnershipPalette`，供确定性程序组合。
纯函数校验封印、原图摘要、格式和坐标映射；封印不是身份签名，单独传入文件不能
代替项目入口的真实工作流重放，也不能产生新的美术接受。

## 工作包

`ai_scene_decomposition_review_v1`绑定target/raw/plan、原生尺寸、准确映射、主体和
标签表。目录包括原PNG原字节、target、每个主体的原像素上下文局部、全未知归属图、
报告、说明与校验束。局部按粗包络原生外扩8px，仅供追踪，并非透明抠图。

基准图的contain-floor会分别向下取整宽高。因此局部坐标按实际resized两轴反算，
并裁到原PNG范围；不能直接用一个名义scale处理两轴，不能把缩图余边变成素材。
已测表沿、可见状态和标记原样保留，标记不是资产原点，包络不是Alpha遮罩。

所有归属初始为黑色未知，不自动按包络填充，也不把剩余像素归给天空。工作包状态
始终为awaiting-visible-ownership，不能宣称已完成分割或接受任何像素归属。

## 归属输入与片段

输入为与原PNG同尺寸的不透明8位RGB/RGBA PNG。黑色表示未知，其余准确RGB由
target实例顺序产生固定互异标签；一个像素只有一个可见归属。非标签颜色、半透明
标签、缩图、裁图和不支持格式均停止，不量化、不猜最近色、不修图。标注可来自
后续显式选择的分割工具/操作员；本版不内置分割生产者，也没有要求用户手工画图。

输出保留原生归属图原字节。程序对每个非空主体创建紧包围框片段，选择像素直接
复制原图RGBA，其他像素为全零透明；坐标记录为原生整数，保留空主体和未知计数。
粗包络不限制标签范围，以免把粗标注错误硬裁成最终轮廓。

这是**二值可见归属**，不是材质透明度估计。原图抗锯齿混色已混入背景；复制这些
像素不能消除底色污染，不能恢复完整遮挡部分，也不保证移动/视差时边缘正确。
没有去色、锐化、填补、柔边或隐藏RGB更改；原始PNG始终不动。

## 回拼与验收边界

回拼从编码后的片段及其记录原点构建，未知保持透明，不使用原图补洞。
报告记录未知像素、空主体和全部RGBA的像素差；差值图显示RGB差、未知图用粉色
标出缺口。任何未知或空主体都是incomplete-visible-ownership。

完整覆盖且每个主体非空时，只能得到
complete-visible-ownership-pending-semantic-review。像素复制能原样拼回是坐标/复制
闭环；随意分配标签也可能回拼一致，因此不作为语义正确、真实分割或素材质量分数。
程序保留semanticSegmentation/visualAcceptance=not-assessed、hiddenGeometry=unknown、
reusableAssets/assetPackage=false，没有可绕过审阅的自动美术接受入口。

下一阶段仍需准确归属语义审阅、混色边缘/材质Alpha处理、隐藏补全规划、完整素材
生成与对照，以及编辑器还原地图。新模型调用按仓库合同另行冻结和批准；本版
工作包不能作为图片计算授权，旧固定地图组装器的阻止规则不变。

# 原像素CPU分区候选（0.38.0）

本版提供可运行的操作员种子引导CPU GrabCut生产者和独立接收/复检入口，接在
[可见拆分追踪](reference-decomposition-v1.md)之后。它只提出可见像素归属候选，
没有自动场景理解、材质Alpha、隐藏补全或整包美术通过；测试不运行真实GrabCut。

## 公开入口

```text
npm run reference -- segmentation-seeds --root PROJECT --seeds SEED_SPEC --out NEW_INPUT
npm run reference -- verify-segmentation-seeds --root PROJECT --seeds SEED_SPEC --out INPUT
python -B adapters/grabcut.py --input INPUT --runtime PRIVATE_CONFIG --out NEW_CPU_OUTPUT
npm run reference -- segmentation-import --root PROJECT --seeds SEED_SPEC --cpu CPU_OUTPUT --out NEW_REVIEW
npm run reference -- verify-segmentation --root PROJECT --seeds SEED_SPEC --cpu CPU_OUTPUT --out REVIEW
```

准备、接收和复检均不运行CPU分区或模型。项目入口重放已接受target v2和原PNG，
未接受目标仍被阻止。Python是显式独立生产者，不增加HTTP、后台任务、安装、
下载、GPU或生图调用。JS核心不依赖Python/OpenCV，也不修改已有工作流决定。

`./reference-segmentation`公开纯函数segmentationSeedFiles与
seededSegmentationReviewFiles；纯函数校验封印不认证人类身份，真实决定仍由
项目工作流负责。CPU操作和候选接收不增加参考工作流事件。

## 种子与算法

ai_scene_segmentation_seed_spec_v1绑定准确target/raw、原生坐标、迭代次数1—8、
整数随机种子及每实例ROI和正/负笔画。笔画为整数线段圆帽，半径0—64像素；
全体主体必须齐套且顺序绑定。越界、正种子交叉、同主体正负冲突均在CPU前停止。
操作员种子是语义候选，不能冒充用户已审遮罩。

每个灰度种子PNG与原图同尺寸：0确定背景、85确定前景、170可能背景、255可能
前景，Alpha全255。ROI只初始化概率，区域外仍为可能背景，不把粗包络硬裁成
遮罩。其他实例的正种子自动作本实例确定背景，规则写入冻结计划。

生产者固定单线程、关闭OpenCL、显式RNG、GC_INIT_WITH_MASK；每实例一次
GrabCut函数调用，内部迭代数已冻结。硬种子必须保持，随后按8连通组件只保留
触及正种子的区域。未触及的细节可能漏失，过滤不是语义证明。标签及人工提示
用途见[OpenCV官方说明](https://docs.opencv.org/4.13.0/d8/d83/tutorial_py_grabcut.html)。

## 运行时与失败

PRIVATE_CONFIG由调用者显式选择，字段为site、opencv、distribution、numpy及files，
files为相对site的path/sha256/byteLength。无内置宿主路径、自动发现或自动安装。
每次先核验所有列出的安装文件、导入来源和版本，再核验全部输入种子。site和
Python位置仅留私有参数，不进入计划或审阅束；公开结果仅保留版本、CPU配置、
文件数量/清单摘要及实现摘要，报告封印不是第三方身份签名。

输出必须新建，禁止覆盖输入、源码或旧结果。CPU前写started；失败写failure，
保留部分mask和调用数，停止后续主体、不重试。0调用依赖失败也保留；确定性
修复后可在新目录重算同一原PNG，不借此重发图片请求。mask以不透明0/255 RGBA
编码，原画不改写。本入口不授权依赖下载或新模型计算。

## 接收与冲突

接收端重编译当前target/raw/seed spec，核对结果的计划/原图身份、CPU配置、
调用数、实例序列、固定路径、PNG摘要、原生尺寸、二值值域、像素计数和所有硬
种子。失败停止，不修图或补齐；显式生产者提供执行证据，封印不证明语义正确。

一个像素只有一个候选时才赋归属；零个或多个候选都保留黑色未知。不按zIndex
覆盖、置信度臆测或天空回填。原mask全保留，conflicts.png标冲突，unassigned.png
含冲突和无候选，片段与回拼复用已测坐标链。报告始终为未审CPU候选，无自动
美术接受入口；可见片段保留原混色边缘，不是完整、干净Alpha或可平铺资产。

下一步仍需语义审阅、修订种子或换显式分割生产者、边缘与隐藏补全规划，以及
完整资产还原验收。涉及新模型/工具设置时按仓库合同准备准确计划、取得授权。

## 独立模型数据设置与限定补传

`adapters/model_setup.py preflight|install`只处理已锁定的官方SAM2.1 Tiny文件目录。
install要求准确approve-setup决定，写入Git忽略的工具目录，逐文件核对长度/SHA-256，
不安装依赖、加载模型或推理。失败保留原计划、授权、部分文件和终态，不自动重试。

`adapters/model_resume.py preflight|install`处理另行批准的区间补传计划。preflight
仅读取原失败、原计划及部分文件指纹；install要求准确approve-resume决定，复制
被冻结的部分文件到新目录，原文件不动，仅请求声明尾段和原3份配置。必须匹配
HTTP206和准确Content-Range；服务忽略范围、范围错误、短/坏尾段均停止，不回退
完整下载，最后仍核验整个模型的原SHA-256。规则参考
[RFC9110第14节](https://www.rfc-editor.org/rfc/rfc9110.html#section-14)。

这些仅是资源文件设置工具，不运行SAM2，也不证明任何模型分割效果。0.39.0另有
[独立点框CPU适配与接收协议](reference-prompt-segmentation-v1.md)，与GrabCut结果分开。

`adapters/model_recovery.py`另提供显式预算化恢复：原部分文件和配置缓存均绑定
指纹，系统curl绑定二进制摘要；最多8次区间传输、2倍剩余响应体数据和300秒传输
窗口，连续2次无进展停止。必须另有approve-bounded-recovery决定，才能在同一预算
内保留短响应片段并续接，所有短响应独立记录为未完成；旧失败不改写。
完整模型原SHA-256通过前不发布就绪，3配置也按固定指纹逐一验证；不回退全文件、
不加载模型或推理。curl参数依据[官方手册](https://curl.se/docs/manpage.html)。

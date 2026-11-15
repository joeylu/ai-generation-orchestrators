# 点/框提示的离线CPU分区（0.39.0）

这是已接受参考图后的可见归属候选入口。JS只编译、校验和回拼，独立Python适配器
使用调用者显式配置的本机CPU环境与已核验模型。没有模型下载、GPU、HTTP生成端点、
新生图或自动美术接受；测试全部使用合成图和生产者替身。

```text
npm run reference -- prompt-input --root PROJECT --prompts SPEC --out NEW_INPUT
npm run reference -- verify-prompt-input --root PROJECT --prompts SPEC --out INPUT
python -B adapters/sam2.py --input INPUT --runtime PRIVATE_CONFIG --out NEW_CPU_OUTPUT
npm run reference -- prompt-import --root PROJECT --prompts SPEC --cpu CPU_OUTPUT --out NEW_REVIEW
npm run reference -- verify-prompt --root PROJECT --prompts SPEC --cpu CPU_OUTPUT --out REVIEW
```

## 输入和证据

ai_scene_prompt_segmentation_spec_v1绑定准确target/raw、原生坐标、全部实例顺序，
模型文件长度/SHA、运行时封印和生产者实现指纹。每实例提供可空矩形框和2—256个
整数点，必须同时包含正/负点；重复点、越界、跨实例正点冲突、缺失主体和不安全
模型路径在推理前停止。框仅作为模型提示，不把ROI/粗包络当硬裁图遮罩。

编译后的ai_scene_prompt_segmentation_plan_v1固定CPU/float32/单线程、阈值0，最多
加载模型一次、每实例一次独立单帧会话。没有形态修补、连通域过滤、提示点强改、
多候选挑好图或自动重试。输入/接收/复检均不执行模型，不修改参考工作流事件。

公开JS入口为./reference-prompt-segmentation的promptSegmentationFiles和
promptSegmentationReviewFiles；核心不导入Torch、Transformers或任何宿主适配器。
模型选择通过原文件清单和可移植摘要传入，不在核心包含宿主路径或网络配置。

## 显式SAM2适配器

PRIVATE_CONFIG的site/modelDirectory只保存在本机私有工具目录；runtime封印包含
解释器身份、包版本和安装清单摘要，files逐项绑定安装文件长度/SHA。运行前核验
所有列出的文件、导入来源、CPU构建、包版本、生产者及原模型四文件指纹。
安装元数据允许PEP440的+cpu本地版本名，仍拒绝绝对路径、父目录和链接路径。

当前适配器仅加载已锁定SAM2.1 Tiny的sam2_video/Sam2VideoModel配置，复用已有
依赖，不安装包。local_files_only/use_safetensors开启，trust_remote_code关闭；
离线环境与socket阻断同时生效。CPU/float32，权重映射缺失/多余/不匹配立即停止。
接口依据[官方SAM2 Video文档](https://huggingface.co/docs/transformers/v4.57.0/en/model_doc/sam2_video)
并核对本机锁定版本源码，使用单帧流式会话和原生尺寸后处理。

推理前写started，每实例调用前独占写reserved；失败保留partial masks、调用数和
failure，无同目录覆盖或重试。成功输出独立ai_scene_prompt_segmentation_result_v1，
不冒充GrabCut报告。封印证明文件身份一致，不是模型质量或人类语义签名。

## 回拼与审阅

接收端重编译plan，校验全部绑定、一次模型加载、齐套调用数、实例/路径、PNG指纹、
原生尺寸、0/255二值不透明编码及真实像素计数。正点未选、负点被选和空mask会被
报告，不强改候选或隐去错误。全部原始mask留在candidate-masks/。

只有一个候选的像素才获归属；重叠与缺口均保留未知，不以层序或原图补齐。回拼
复用既有原生坐标片段链，原PNG保持。所有候选仍未审；可见片段保留混色边缘，
不是干净Alpha、隐藏补全或可复用资产包。降低冲突率也必须核对语义与前景原图，
不能单靠像素覆盖率接受。

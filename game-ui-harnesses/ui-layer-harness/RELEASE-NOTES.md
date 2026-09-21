# 0.1.0a1 preview

从实验链路收口为独立源码入口 `ui_layer.py`。旧正式 CLI 不覆盖。
支持规划冻结、生图请求/回执交换、自动定位、回拼及独立 UI 图层包；服务接入合同见 SERVICE-CONTRACT.md。
增加 CLI 单 JSON 输出边界、独立 Pixi 图层查看器；去字保位和装饰唯一归属约束保留。

本地验证（Windows，Python 3.14，Node）：
- 112 项 Python 离线测试（包含规划、授权、指纹、失败阻断、归位、打包、CLI、色键证据）。
- 10 项图层/旧导入合同测试。
- TypeScript noEmit 和独立查看器构建。

不包含用户参考图、生成素材、会话或私有工具配置。没有本次 Linux、Docker 或真实模型端到端验收。
视觉保真仍待迭代，技术交付保持 delivered_pending_visual_review；不自动批准用户视觉验收。
发行标识预留为 ui-layers-v0.1.0-alpha.1；只有远端标签和校验过的归档实际发布后才能作为生产依赖。

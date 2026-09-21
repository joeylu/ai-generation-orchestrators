# Release notes

## Unreleased CI compatibility fixes

- Import Pillow's `Image` explicitly so Python 3.10 can evaluate key-evidence annotations.
- Emit public CLI JSON as UTF-8 even on Windows hosts with a legacy console encoding.
- Fail test jobs on the first unsuccessful command on both Linux and Windows.
- Normalize Windows short-name aliases when checking generation results, delivery artifacts,
  and checkpoint overlap; retain traversal, symlink, and byte-identity checks.
- Bring offline board fixtures into agreement with their declared visible dimensions;
  the runtime size gate and thin-button rejection remain unchanged.

## 0.1.0a2 preview

整理为 src/ai_ui_layers、tests、docs 目录；修正包内导入、仓库资源定位、测试发现、CI 与文档链接。
根目录 ui_layer.py 的命令、stdout JSON 和图层包合同保持兼容，不修改旧正式链路。
固定标签为 ui-layers-v0.1.0-alpha.2；alpha.1 不覆盖。
本轮 113 项 Python 离线测试通过，包含从仓库外工作目录调用入口读取真实初始化任务的回归。
原任务绑定旧代码指纹，应继续用旧版本运行；本轮不迁移已有任务。

## 0.1.0a1 preview

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

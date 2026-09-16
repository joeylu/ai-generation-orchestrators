# 0.2.1rc2 — 可变正方形来源与恢复性改进

本候选版保持固定 4×4、16 帧、严格审核和三类独立计算授权，不包含 Docker、部署或
其他 Harness 改动。正式云端与 Docker 验收仍待完成。

## 行为变化

- 生图结果不再要求等于计划的 `board_size`，只要求为现有字节上限内的单帧正方形 PNG。
- 整板云抠图必须保持已审核 raw 的实际宽高；处理时再将整板统一规范化到 `board_size`。
- `submit` 会立即消费首次响应中的 completed/failed，不再把所有响应统一报告为 queued。
- JSON、输入快照和图像使用 fsync 后的同目录原子发布，避免暴露半写入的最终证据。
- 新请求可用 `reference_preparation_handoff` 显式复用同一原图的已审核参考前景。
- `inspect` 能报告 reference/raw/candidate 的 rejected 状态。
- `process` 生成私有 light/dark/checker 审核联系表和逐帧几何诊断；它们不进入交付包。
- 新增只读远端 `probe`，只做工具发现与 schema 校验，不提交业务任务。
- handoff producer 版本来自运行包版本；候选证据升级为 `character_image_candidate_v2`，
  使用 `build_state` 避免与交付层的 accepted 状态混淆。

## 保持不变的安全边界

- 非正方形结果、matte 尺寸变化、缺帧、越界、静态序列和错误透明度仍会阻断。
- 不补帧、不插值、不逐格移动角色、不做本地抠图或静默 fallback。
- 未知提交仍为 terminal indeterminate，绝不自动重发。
- 参考抠图、生图和整板抠图仍分别要求新鲜的单次授权。
- 视觉审核仍与计算授权分离，并绑定实际 artifact digest。

## 验收重点

Docker 在线验收应覆盖：不同正方形原始尺寸、非整除 4 的原始尺寸、整板 matte 尺寸保持、
首次响应直接 completed/failed、排队后完成、访问拒绝、超时不重试、参考 handoff 复用、
审核联系表，以及最终 PNG/atlas/GIF/manifest 校验。

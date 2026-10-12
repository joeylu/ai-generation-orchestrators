# 同步验证与大图离线回归

0.8.3 仅在一次同步遍历内复用成功验证的计划、项目、风格、原型、blob 与结果。缓存不跨请求、await 或进程。缓存依赖包含完整文件字节、路径链接安全、缺失状态与运行时目录清单；命中仍比较每一个字节，使用 1 MiB 共享缓冲区，避免不断分配整张大图。相同尺寸、恢复 mtime 的修改不能隐藏。失败不缓存，返回值与私有缓存隔离。

PNG 解码保留 CRC、上限、五种过滤器、全部支持色彩模型及透明像素 RGB 归零。原图与规范化图 SHA-256、全部 alpha=255、非空图、尺寸/映射、原图/规范化 RGBA 一致性及 level 9 确定性编码完整字节检查均保留。按内容摘要复用重压缩，既不降低压缩级别，也不接受同像素的非规范编码。

## 实测

同机 v25.9.0，3072×2048（6,291,456 像素），每张原图 21524845 字节。确定性高熵合成图覆盖实际大图尺寸，无真实模型调用。包含初次结果和一轮修改两张不同大图；raw 带 tEXt，reference 为无元数据规范化 PNG。每入口一次独立预热、三次独立同步检查取中位数；耗时不作为 CI 门限。原始与规范化 SHA-256 在优化前后完全一致。

| 查询 | 0.8.2 毫秒 | 0.8.3 毫秒 | 加速 |
| --- | ---: | ---: | ---: |
| verifyResult | 4098.7 | 2133.4 | 1.92× |
| projectStatus | 3347.5 | 2033.9 | 1.65× |
| inspectRun | 5177.4 | 2092.8 | 2.47× |
| inspectProjectDag | 3432.8 | 2685.9 | 1.28× |
| combinedQuery | 3925.5 | 2456.8 | 1.6× |

运行状态查询从 3 次结果验证减至 2 次，两张不同图片各一次，重复验证 1→0；大图解码 6→4，level 9 重压缩 3→2，alpha 全量扫描 3→2。其他入口原先已对两张不同图各验证一次，次数保持 2，不能记成“消除了两个重复”。同一同步范围同时查询项目/运行/DAG，仍只验证每张图一次。原图与规范化字节完全相同时，单图跨多入口回归仅解码/重压缩/alpha 扫描各一次；不同编码保留两次解码。

## 拒绝回归

- 缓存预热后替换同尺寸原图并恢复 mtime：拒绝。
- 替换规范化图并重新封存技术摘要：拒绝。
- 同 RGBA 但改为 level 1 编码并重新封存摘要：拒绝。
- 原图/规范化图一起改为末像素 alpha=254，重新封存 receipt/technical：项目状态、DAG 与直接验证均拒绝。
- 同一同步范围新增 terminal.json：拒绝，负依赖不能隐藏。
- 修改调用方拿到的 Buffer/计划对象：不污染缓存；后续独立检查重新验证。
- 所有支持色彩模型 × 五种过滤器保持像素，损坏 CRC 拒绝；嵌套异步范围拒绝，失败不缓存。

## 复现

从源码附件根目录执行。SOURCE_ROOT 必须保留三个公开兄弟 Harness 的目录关系；输出 JSON 必须是新文件。baseline 使用解压的 0.8.2，计数仅在内存加载时注入，不改源码/运行时身份或算法。

```sh
node --test game-ui-harnesses/ui-reference-harness/tests/validation.test.mjs
node game-ui-harnesses/ui-reference-harness/tests/benchmark-validation.mjs baseline BASELINE_SOURCE_ROOT work/before.json
node game-ui-harnesses/ui-reference-harness/tests/benchmark-validation.mjs optimized . work/after.json
```

完整三次耗时、次数与图片摘要见 [validation-performance.json](validation-performance.json)。所有项目、授权、验收记录均为临时合成夹具，不是用户项目或真实人工视觉验收；不连接提供商，不包含 Docker 实机验证。

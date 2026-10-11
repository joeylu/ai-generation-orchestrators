# UI Reference Harness 0.7.0

发布标签：`ui-reference-harness-v0.7.0`。本版以源码附件提供项目级 UI 参考图 DAG，
附带可选 loopback Studio 静态构建。宿主服务和前端由消费项目独立实现。

## 新增能力

- 项目上下文冻结、显式无环依赖及逐面板节点状态，提供核心函数和 `dag-*` CLI。
- 首图人工接受并明确固定为锚点后，解锁同项目其他面板的冻结计划。
- 单次摘要授权、生成交换或适配器、持久操作重放；刷新和恢复不重新提交。
- 同一面板会话最多三轮修改；重新创建 DAG 不重置额度，失败和未知结果不自动重试。
- 新图待验收时保留最近接受版本供交付，固定项目锚点不随修改替换。
- 复用已有已验收成图，完整交付仍由核心输出和校验，不引入第二种 manifest。
- 0.6.0 及已分发的 0.7.0 开发快照成图可只读检查、人工复核和导出，旧计划禁止重新派发。

流程及 API 见 [项目级 DAG 合同](project-dag.md)。风格草案合并和预览保持现有独立流程；
当前 Studio 为宿主 UX 参考，仍使用其原有面板会话接口。

## 固定安装

从本标签的 Release 下载 `ui-reference-harness-v0.7.0-source.zip`、`release-manifest.json`
和 `SHA256SUMS`。安装锁必须包含确切标签、40 位提交、附件字节数与 SHA-256、manifest
SHA-256 和运行时摘要。归档为提交中 Git blob 原始字节；解压后逐项验证 sourceFiles，
保持 UI Reference、UI Panel、UI Component 三个兄弟目录。不要转换换行或修改 vendor 文件。

使用 Node.js >= 22.18.0，推荐 Node.js 24。在解压目录运行：

```powershell
node game-ui-harnesses/ui-reference-harness/ui-reference.mjs doctor
node game-ui-harnesses/ui-reference-harness/ui-reference.mjs self-test
```

需要本地 Studio 时，将 `ui-reference-harness-v0.7.0-studio.zip` 合并解压到同一根目录，
然后运行 `node game-ui-harnesses/ui-reference-harness/web/server.mjs`。只监听 127.0.0.1。
模型适配器为可选外部集成；附件不包含私有配置、用户项目、参考 PNG、生成图或原生会话。

## 开发快照升级

已分发的开发 ZIP 摘要为
`128cd3d0d8262ea183fc5333700dc71aaee3bc74c5c6362d98996010ada2aad7`，运行时摘要为
`4d9860b276acdc6153a8ea000925abcf3bf3b0c2e3153a4a429641b97adbb6cd`。
它保持未发布身份，不能通过修改 manifest 或移除生产门禁将其提升为正式附件。

停止发起新任务并核对在途请求后再切换运行时。保留旧运行时、原始工作区和 ZIP；
确认没有在途请求后重启宿主。旧计划和 DAG 可检查，但运行时已变化时不能继续派发。
在同一项目中创建新 DAG，可复用当前风格的已接受结果和固定锚点，历史修改轮次继续计数。
这不是自动迁移或自动重新生成；不得改写原 plans、attempts、reviews 或已终止状态。

## 验证边界

发布附件中的 `offline-regression.json` 提供核心、Studio、固定原型导入、解压后自检及
逐文件校验的实际记录。测试只使用合成夹具和提供商替身，发布过程不调用生图或视频。
技术 PNG 检查不替代用户对布局、风格和准确文案的验收；本版不承诺像素级还原。

# UI Reference Harness 0.7.1

发布标签：`ui-reference-harness-v0.7.1`。这是 0.7.0 项目级参考图链路的补丁，
以固定源码附件和可选 loopback Studio 静态附件分发。

## 本次变更

- 面板支持任意状态下删除和恢复。保留核心原型、原图、会话、验收与固定锚点；
  已提交请求继续收尾，删除后拒绝新操作，恢复沿用原修改额度。
- 项目列表区分可见面板和已删除面板；新交付仅选择可见子集并披露排除项，已有 ZIP 保留。
- 图片 ZIP 和完整 ZIP 加项目名称前缀，保留中文，替换非法字符并限制文件名长度。
- 验收等待当前完整图片加载成功；历史未完成任务保持只读，错误信息本地化。
- 已完成的历史风格预览可验证、读取和采用；旧计划禁止再次派发。
- 报错显示在当前模态框之上，仍能关闭；示例原型导入等失败操作保留真实错误。
- 已发布 0.7.0 成图、修订链和修改额度继续可检查、人工复核、复用及交付。
  运行时变化仅解锁已知历史证据的读取，不授予旧计划计算权限。

## 固定安装

下载本标签的 `ui-reference-harness-v0.7.1-source.zip`、`release-manifest.json` 和 `SHA256SUMS`。
安装锁固定 tag、完整提交、附件字节数与 SHA-256、manifest SHA-256 及 runtimeSha256，
逐项验证 sourceFiles；保留原始字节和 UI Reference／UI Panel／UI Component 三个兄弟目录。
Node.js 要求 >= 22.18.0，推荐 24。

```powershell
node game-ui-harnesses/ui-reference-harness/ui-reference.mjs doctor
node game-ui-harnesses/ui-reference-harness/ui-reference.mjs self-test
```

需要本地工作台时，将配套 `ui-reference-harness-v0.7.1-studio.zip` 合并解压至同一根目录。
本地工作台仍只监听 127.0.0.1；不包含用户项目、用户图片、原生 session 或私有提供商配置。

## 升级与消费方边界

停止新任务并核对在途请求后再切换运行时，保留旧运行时、原始工作区和已有交付。
原计划、attempt、review 和 DAG 不改写；旧计划不重投，未知请求不自动重试。
运行时变化后原 DAG 可检查；同项目新 DAG 可复用当前风格接受图和固定锚点，历史三轮预算继续计数。

项目级 DAG 主流程和核心交付格式保持 0.7.0 合同。面板可见性、下载名称及界面提示属于宿主／
Studio 层；独立服务和前端须按 [宿主同步说明](host-integration.md#071-宿主与前端同步) 实现各自接口。
更新固定包本身不会自动更新独立前端或给核心新增删除入口。

## 验证边界

附件 `offline-regression.json` 记录解压后的核心、Studio、固定原型导入、逐文件完整性、CLI
和静态/API 检查。所有回归使用合成夹具和提供商替身；发布过程真实模型调用为零。
这些检查不替代用户对实际成图布局、风格和文案的验收。

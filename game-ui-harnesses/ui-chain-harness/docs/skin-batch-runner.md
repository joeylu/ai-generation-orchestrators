# 生图适配器与整批执行入口

`src/skin-generation/batch-runner.mjs` 提供参考图集的 JavaScript 执行接口。`adapter.generate(request)` 接收冻结的提示词与图片字节，返回 PNG 字节。核心保持供应商中立；[可选 Codex CLI 适配器](skin-codex.md)和宿主自行提供的适配器遵循同一单次调用边界。此接口不复制其他 Harness 的运行时或私有供应商设置，也不承诺所有扩展字段互相兼容。

## 适配接口

适配器由集成方显式传入，核心不加载任意配置脚本、不读取密钥、不记录远端错误原文。

```js
import {executeBatchPipeline} from './src/skin-generation/batch-runner.mjs';

const result = await executeBatchPipeline({
  skinDirectory,             // Harness work/下的皮肤目录，绝对路径
  batchSha256,               // 不可变批次摘要
  confirmedBatchSha256,      // 用户本次明确确认的同一摘要
  profile,                   // work/下的metadata-profile.json
  allowRejectedLocalization: false,
  maxConcurrentSheets: 2,    // 可选；只支持1或2，省略时串行
}, adapter);
```

`adapter`必须由调用方提供真实实现；上例不是内置生图服务。没有profile则只生成/接收，不进入组件后处理。allowRejectedLocalization沿用已有候选策略，默认false，不是跳过检查。

当前工作树在调用 `executeBatchPipeline` 时先检查已提供的 profile 是否位于 `work/`、可安全读取且为有效 JSON，并校验基本身份、主题格式和允许的定位例外。错误返回 `batch-runner.invalid-profile-before-generation`，不消费批次授权、不提交图片生成；省略 profile 保留只生成/接收模式。此加固晚于 rc.2。实际像素决定的切线、密度和安全区仍须通过后续确定性检查。

rc.4 配置冻结：预检后的原始 profile 字节在调用生成前保存到独立 `work/pipeline-inputs/<id>/profile.json`，另存 `binding.json` 记录批次和字节摘要。生成期间修改原文件或调用参数不会切换本次后处理配置。返回值及生成后的错误对象提供 `postprocessProfile: {file,sha256,batchSha256}`，须与该任务一起保留；后处理启动前和任务复制后都核对摘要，变化立即停止。需要单独恢复后处理时，使用这个 file 和 sha256 调用 `postprocessBatch({skinDirectory,batchSha256,profile:file,profileSha256:sha256,...})`，不要再传已修改的原文件；已有 taskDirectory 优先恢复原任务。未提供 profile 的返回结构保持原样。独立快照只用于本地恢复，不增加模型调用或改变历史批次回执。

每次generate接收：

- prompt：冻结提示词，已含风格与几何JSON。
- images：两张冻结PNG字节及SHA-256，顺序固定为style-reference、geometry-template。
- width/height、output.format=png、output.transparentBackground=true。
- sheetId、planSha256、requestSha256。request摘要基于公开参数与图像摘要，不包含本地路径。

返回1至32MiB的Uint8Array/Buffer。程序原字节保存，再复用已有接收/像素检查，非法PNG会保留并判rejected，不静默修图。

适配器必须每次 generate 最多提交一次，关闭 SDK 内部自动重试，自行实现有界超时；执行器不能强制约束外部实现。适配器抛错或返回无效类型/长度，一律标 indeterminate，不记录错误原文，不重新调用。超时后不得在后台提交第二个请求。当前没有取消协议；永不返回的适配器会占用一个执行位置，调用方也不能据此认定调用结束。即使一个本地接收失败，执行器也会等待所有已经开始的调用结束后才返回失败。

## 操作与恢复

- executeBatch：核对完整冻结输入，整批授权一次，处理批次中实际存在的四张组件图集及可选 S05 材质图集。修订3为32个基础部件，开启 S05 时另有3个材质；旧修订2的30件批次保持原记录。默认串行，显式 `maxConcurrentSheets: 2` 最多同时处理两张。
- runAuthorizedBatch：使用已有授权；只处理尚未begin的图，跳过received、failed和indeterminate。没有完整授权时拒绝。并发执行由逐图独占登记防止重复调用，竞争失败的调用方停止，不自动重试。
- postprocessBatch：独立确定性入口，从完整批次建立并执行既有DAG，无模型调用。原图rejected需要明确候选策略；失败时已建立的taskDirectory用于`skins:task resume`。
- executeBatchPipeline：生成/接收收齐后，若提供profile就进入postprocessBatch；未收齐时task=null，不伪造完整包。

适配器异常后仍继续同一批次未提交的其他图，不逐图询问用户。接收写盘或回执失败时停止，保留已提交证据；再次执行不会重投该图。postprocessBatch重复调用会建立新候选任务；已有任务恢复应使用taskDirectory，不能重跑executeBatch来恢复后处理。

## 当前边界

离线测试覆盖四张/五张批次、单次授权、重复执行零调用、异常/无效结果、缺授权、冻结资源变化及 S05 补图恢复。可选 Codex 适配器由 Node 启动 CLI 会话，再由会话调用 imagegen；供应商可用性和真实美术效果需要独立验收，不能拿旧批次授权做新计算。

完整组件链路的零模型检查入口如下。它在全新 `work/` 子目录中构建当前模板、冻结参考与五张计划，以程序渲染的清模板 PNG 作为明确标记的合成响应，再实际执行任务 DAG、材质提取绑定、消费包构建与浏览器搬迁检查。完成后重复接收和任务恢复均不得再次调用适配器或改写原证据。默认带 S05；`--no-materials` 检查四图兼容入口。它不读取已有项目，不连接 Studio，也不进入面板生成。

```sh
UI_CHAIN_TEST_BROWSER=chromium node scripts/component-pipeline-check.mjs
node scripts/component-pipeline-check.mjs --browser chromium --no-materials
```

Windows 可使用 `node scripts/component-pipeline-check.mjs --browser msedge`。浏览器须由部署或开发环境预先安装；检查不会自动下载安装。最终 `report.json` 记录32个基础部件、可选3个材质、16类组件、搬迁验证及零真实模型调用，仍保留 `visualAcceptance: unreviewed`、`productionReady: false`。该程序证明确定性工程链路可运行，不把合成素材当作真实生图质量通过。Docker 与 Web 的宿主接入以当前组件输出发行说明为准；这里的执行器不提供服务部署、队列或认证实现。

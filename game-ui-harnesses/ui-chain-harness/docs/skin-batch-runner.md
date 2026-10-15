# 生图适配器与整批执行入口

0.82新增`src/skin-generation/batch-runner.mjs`，是本地可调用的JavaScript API，不是已接通真实供应商的CLI。沿用ui-reference-harness的核心约定：`adapter.generate(request)`接收冻结的提示词/图片字节，返回PNG字节。未复制它的运行时或私有供应商设置，也未承诺所有扩展字段互相兼容。

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
}, adapter);
```

`adapter`必须由调用方提供真实实现；上例不是内置生图服务。没有profile则只生成/接收，不进入组件后处理。allowRejectedLocalization沿用已有候选策略，默认false，不是跳过检查。

每次generate接收：

- prompt：冻结提示词，已含风格与几何JSON。
- images：两张冻结PNG字节及SHA-256，顺序固定为style-reference、geometry-template。
- width/height、output.format=png、output.transparentBackground=true。
- sheetId、planSha256、requestSha256。request摘要基于公开参数与图像摘要，不包含本地路径。

返回1至32MiB的Uint8Array/Buffer。程序原字节保存，再复用已有接收/像素检查，非法PNG会保留并判rejected，不静默修图。

适配器必须每次generate最多提交一次，关闭SDK内部自动重试，自行实现有界超时；执行器不能强制约束外部实现。适配器抛错或返回无效类型/长度，一律标indeterminate，不记录错误原文，不重新调用。超时后不得在后台提交第二个请求。当前没有取消协议；永不返回的适配器会阻塞顺序执行，需要适配器自己处理超时。

## 操作与恢复

- executeBatch：核对完整冻结输入，整批授权一次，依次处理四张。
- runAuthorizedBatch：使用已有授权；只处理尚未begin的图，跳过received、failed和indeterminate。没有完整授权时拒绝。并发执行由逐图独占登记防止重复调用，竞争失败的调用方停止，不自动重试。
- postprocessBatch：独立确定性入口，从完整批次建立并执行既有DAG，无模型调用。原图rejected需要明确候选策略；失败时已建立的taskDirectory用于`skins:task resume`。
- executeBatchPipeline：生成/接收收齐后，若提供profile就进入postprocessBatch；未收齐时task=null，不伪造完整包。

适配器异常后仍继续同一批次未提交的其他图，不逐图询问用户。接收写盘或回执失败时停止，保留已提交证据；再次执行不会重投该图。postprocessBatch重复调用会建立新候选任务；已有任务恢复应使用taskDirectory，不能重跑executeBatch来恢复后处理。

## 当前边界

模拟适配器已覆盖完整四张、重复执行零调用、异常/无效结果、缺授权、冻结资源变化。既有烘焙批次另验证真实后处理路径。0.83已接入[Codex CLI透明生图适配](skin-codex.md)：Node启动CLI会话，再由会话调用内置imagegen。此前“需要另选生成接口”的结论不完整，已有CLI桥接可用；本轮已完成本机只读预检，尚未执行新的真实图集生成。不能拿旧批次授权做新计算。

本轮不增加Web/Docker、后台队列或Session，也不替换4198预览。

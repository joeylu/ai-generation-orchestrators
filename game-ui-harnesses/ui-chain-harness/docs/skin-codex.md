# Codex CLI透明皮肤生图

调用路径：批次执行器 → Chain Codex适配器 → 共享Codex CLI relay → 固定参数工具 → imagegen → 原字节回执 → DAG。

用户指定参考ui-layer链路的原生透明参数方法。实现参考其generate_session.py和frozen_image_arguments.py：透明不是提示词约定，而是冻结工具参数`transparent_background: true`。为避免复制两份CLI实现，Node侧复用ui-reference-harness/web/adapters/codex-cli-relay.mjs及其单次调用Hook/审计，只增加显式布尔透明选项；它的原默认值仍为false。

Chain的src/skin-generation/codex-adapter.mjs固定传true，不接受调用方降为false；拒绝非PNG/不透明请求或参考图顺序错误。两张输入顺序为风格参考、无标注模板。每张新建独立CLI会话，不传历史sessionKey，避免四张间的图片引用混淆。整批仍只要求一次用户确认，各图调用一次，不逐图等待确认。

Studio 与本 CLI 共用 `configs/skin-generation-execution.json`：`maxConcurrentSheets` 默认 2，允许 1 或 2，在进程启动时读取。批次最多两张同时执行，先结束的一张释放位置给下一张；按各张计划摘要写入独立目录，返回次序不影响图集绑定。保持单批次入口互斥，不开放多个项目同时生成。通用 `runAuthorizedBatch` 未显式传并发参数时仍按 1 执行，其他适配器应先确认可重入再选择 2。

每张提交前仍写独占 claim，每张最多一次；模型抛错或返回不明不重投，可以继续未提交的其他图集。本地 claim/接收写入异常停止派发剩余图集，并等待已开始的调用全部结束才释放 Studio 忙碌状态。恢复只读已有回执，不因并发改动重放请求；已运行进程不热切换。两路是本地调用并发上限，不承诺服务端耗时减半。

```text
npm run skins:codex -- preflight
npm run skins:codex -- run --batch work/skins/<id>/batches/<digest> --sha256 <digest> --confirmed <digest> --profile work/skins/<id>/metadata-profile.json
```

preflight检查CLI登录、image_generation/code_mode_host/hooks功能及固定Hook信任，不调用模型。run必须得到对应不可变批次的新鲜明确确认，先预检再消费授权。无profile则只执行生成与接收。--allow-rejected-localization仅在已明确选择进入定位候选流程时使用，不等于质量接受。

固定参数经本地只读工具以structuredContent传递，Hook拒绝重写、缺失或翻转透明值；回执透明值必须与冻结参数一致。真实alpha仍由接收后的PNG检查验证：传true不保证模型一定交付合格透明图。

CLI回执与原图保存在ignored work/skin-codex-relay，以计划摘要独占目录；不把凭据、私有端点写进公共配置。当前共享适配器沿用其既有模型/effort默认值。不得在错误后切换到另一适配器补投；未知结果保持终态。

验证：共享relay 40项离线测试通过（包括原默认false、显式true、翻转拒绝及Chain封装）；Chain 24项通过。本机preflight正常权限下available，沙盒中CLI子进程曾返回CODEX_CLI_CLOSED。真实新批次生成未执行，当前4198预览不变。

维护共享CLI运输、参数门和回执核验时，运行ui-reference-harness/web/tests/codex-relay*.test.mjs与Chain批次测试；不要在Chain复制或悄悄改写上游运输。已暂缓的“视觉审查session”是另外一个阶段，不等于禁用生图所需的CLI会话。

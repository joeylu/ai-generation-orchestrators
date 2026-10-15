# 整批授权与外部提交协议

本文说明本地授权与结果协议 CLI，接在 `skin-batch prepare/verify` 之后、`skin-task` 批次接入之前。这个 CLI 只记录授权、独占提交机会和外部结果，本身不调用模型。当前整批执行器和 [Studio](local-studio.md) 已可通过可选适配器实际提交；它们复用本文协议。批次为四张组件图，或四张组件图加可选 S05 材质图，始终一次确认整批；逐张 begin/finish 是调用方内部动作，不要求用户逐张确认。

## 使用顺序

所有命令在Harness目录执行。`<digest>`必须是用户刚明确确认的不可变批次摘要；普通“继续开发”不构成对某个新批次的计算授权。CLI信任调用者传入真实确认，不提供登录或审批身份认证。

```text
npm run skins:batch-execution -- authorize --batch work/skins/<id>/batches/<digest> --sha256 <digest> --confirmed <digest>
npm run skins:batch-execution -- begin --batch work/skins/<id>/batches/<digest> --sha256 <digest> --sheet S01
```

authorize 先检查全部计划的新鲜度和既有尝试，一次性消耗整批确认，再为四张或五张写入与授权摘要绑定的预留。任一已有尝试都不能复用。部分写入失败不会自动续写，也不能提交已预留的子集；保留现场后由用户做新决定。begin 必须成功返回，外部调用者才能调用对应模型一次；它自身不会调用模型。所有图集沿用同一整批确认；批次含 S05 时，其提交使用 `--sheet S05`。

begin写入`submission.json`，语义为“调用前已独占登记”，不声称供应商已接受请求。第二次begin失败，即使第一次调用者崩溃、无法确认是否真的调用，也不能重投。无结果时状态为indeterminate。

外部调用完成后报告实际观察到的结果：

```text
npm run skins:batch-execution -- finish --batch work/skins/<id>/batches/<digest> --sha256 <digest> --sheet S01 --status returned --raw <local-png>
npm run skins:batch-execution -- finish --batch work/skins/<id>/batches/<digest> --sha256 <digest> --sheet S02 --status failed
npm run skins:batch-execution -- finish --batch work/skins/<id>/batches/<digest> --sha256 <digest> --sheet S03 --status indeterminate
```

上述三行是互斥结果示例，不是要求实际制造失败。未确认供应商明确失败的超时/断连必须报告indeterminate。程序不存供应商原始报文、URL、凭据或私有端点。外部结果由调用者负责如实报告，当前无供应商验签。

三种结果争用同一个独占 `external-result.json`，并发或重复 finish 只能有一次写入成功。returned 记录原图摘要，再复用 receiveAttempt 保存原图及检查回执；它不等于质量通过。失败/未知结果保持原记录，不能换个 finish 命令改写成成功，也不能删除声明后重投。

当前已有显式、零模型调用的接收恢复入口。已记录 returned 但缺少 receipt 时，程序核对冻结计划、原图摘要及已有 claim/raw/inspection，只补缺失文件；不一致就停止。indeterminate 的晚到图片只有通过原请求、会话审计和图像来源核验后才能恢复，原 external-result 不改写。Studio 提供“检查并恢复已返回图片（不生成）”；也可使用现有 CLI：

```text
node scripts/recover-codex-sheet.mjs --project work/skins/<id> --batch <digest> --sheet S01
```

没有原图或可信来源证据时，恢复不会凭空制造成功。模型仍需重新生成时，必须显式准备单张补图计划并确认其新摘要；已收到但检查为 rejected 的图也可走此入口。Studio 的补图操作复用 [supplement.mjs](../src/skin-generation/supplement.mjs)，保留旧计划、原图、回执和失败记录，不自动补生成。

## 状态与接入

`skins:task batch-status`可读取新旧两种协议：

| 记录 | 状态 |
| --- | --- |
| 无授权/无预留 | awaiting-authorization |
| 整批授权及全部四份或五份预留齐全，尚未 begin | authorized-awaiting-external-submission |
| begin后无结果，或接收中断 | indeterminate |
| 明确外部失败 | failed |
| 回执和原图完整 | received，独立保留检查结果 |
| 旧单板预留且无回执 | reserved-outcome-unknown |

批次的全部必需图集 received 后，沿用 `skins:task create --batch --sha256 --profile` 进入 [DAG](skin-task-dag.md)。新授权、提交、结果、补图链和 S05 来源/模板也会复制进任务冻结证据。原始检查 rejected 的候选仍须明确选择定位候选策略，不改写失败记录、不跳过下游校验。补图改变有效来源后，Studio 为未完成的旧处理创建新任务，不续跑其冻结旧图。

## 维护与验证

- `src/skin-generation/batch-execution.mjs`：批次确认、独占登记和结果报告。
- `attempt.mjs`：继续拥有原始接收/像素检查，对批次预留增加提交与返回摘要约束。
- `batch-intake.mjs`：核验新旧证据与状态，不发起任何调用。
- `tests/skin-generation-plan.test.mjs`：离线完整四张接收、重复/并发提交拒绝、失败/未知终态、部分授权、计划过期检查。
- `tests/skin-material-generation.test.mjs`：可选五图、S05 补图来源、接收中断恢复、篡改拒绝及无重复提交。

既有真实批次不回填授权或提交记录；开发测试使用临时夹具。[可注入适配器的整批执行 API](skin-batch-runner.md) 负责调用与 DAG 后处理衔接，可选实际适配器和本地 Studio 已实现。协议 CLI 不提供远程部署、后台队列或容器服务；这些边界不否认已有本地生成和预览入口。

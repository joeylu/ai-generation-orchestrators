# 整批授权与外部提交协议

0.81新增本地协议入口，接在skin-batch prepare/verify之后、skin-task批次接入之前。它负责记录授权、独占提交机会和外部结果，不调用任何模型，不包含供应商适配或后台调度。继续遵循四张整批一次确认；逐张命令是适配器内部动作，不要求用户逐张确认。

## 使用顺序

所有命令在Harness目录执行。`<digest>`必须是用户刚明确确认的不可变批次摘要；普通“继续开发”不构成对某个新批次的计算授权。CLI信任调用者传入真实确认，不提供登录或审批身份认证。

```text
npm run skins:batch-execution -- authorize --batch work/skins/<id>/batches/<digest> --sha256 <digest> --confirmed <digest>
npm run skins:batch-execution -- begin --batch work/skins/<id>/batches/<digest> --sha256 <digest> --sheet S01
```

authorize先检查全部计划的新鲜度和既有尝试，一次性消耗整批确认，再为四张写入与授权摘要绑定的预留。任一已有尝试都不能复用。部分写入失败不会自动续写，也不能提交已预留的子集；保留现场后由用户做新决定。begin必须成功返回，外部调用者才能调用对应模型一次；它自身不会调用模型。四张都沿用同一整批确认。

begin写入`submission.json`，语义为“调用前已独占登记”，不声称供应商已接受请求。第二次begin失败，即使第一次调用者崩溃、无法确认是否真的调用，也不能重投。无结果时状态为indeterminate。

外部调用完成后报告实际观察到的结果：

```text
npm run skins:batch-execution -- finish --batch work/skins/<id>/batches/<digest> --sha256 <digest> --sheet S01 --status returned --raw <local-png>
npm run skins:batch-execution -- finish --batch work/skins/<id>/batches/<digest> --sha256 <digest> --sheet S02 --status failed
npm run skins:batch-execution -- finish --batch work/skins/<id>/batches/<digest> --sha256 <digest> --sheet S03 --status indeterminate
```

上述三行是互斥结果示例，不是要求实际制造失败。未确认供应商明确失败的超时/断连必须报告indeterminate。程序不存供应商原始报文、URL、凭据或私有端点。外部结果由调用者负责如实报告，当前无供应商验签。

三种结果争用同一个独占`external-result.json`，并发或重复finish只能有一次写入成功。returned记录原图摘要，再复用receiveAttempt保存原图及检查回执；它不等于质量通过。失败/未知结果是终态，不能换个命令偷偷改成成功；接收中断保留未完成证据，不自动删除声明或重做接收。后续如需处理晚到结果，应新增明确的人工恢复协议，本版未实现。

## 状态与接入

`skins:task batch-status`可读取新旧两种协议：

| 记录 | 状态 |
| --- | --- |
| 无授权/无预留 | awaiting-authorization |
| 整批授权及四份预留齐全，尚未begin | authorized-awaiting-external-submission |
| begin后无结果，或接收中断 | indeterminate |
| 明确外部失败 | failed |
| 回执和原图完整 | received，独立保留检查结果 |
| 旧单板预留且无回执 | reserved-outcome-unknown |

四张received后，沿用`skins:task create --batch --sha256 --profile`进入DAG。新授权、提交和结果文件也会复制进任务冻结证据。原始检查rejected的候选仍走0.80明确选择的定位候选路径，不改写失败记录。

## 维护与验证

- `src/skin-generation/batch-execution.mjs`：批次确认、独占登记和结果报告。
- `attempt.mjs`：继续拥有原始接收/像素检查，对批次预留增加提交与返回摘要约束。
- `batch-intake.mjs`：核验新旧证据与状态，不发起任何调用。
- `tests/skin-generation-plan.test.mjs`：离线完整四张接收、重复/并发提交拒绝、失败/未知终态、部分授权、计划过期检查。

既有真实批次不回填新授权或提交记录；开发测试只使用临时夹具。0.82已增加[可注入适配器的整批执行API](skin-batch-runner.md)，负责顺序调用及DAG后处理衔接；真实供应商适配和Web/Docker仍待实现。

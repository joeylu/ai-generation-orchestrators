# 项目级 UI 参考图 DAG · v2

0.7.0 源码提供可执行、可检查、可恢复的项目级依赖图。它只编排 UI 参考图，不调用
ui-panel 的生成任务，不启动 ui-layer，不提供服务端账号、数据库、队列或部署实现。
公开入口为 `src/index.mjs` 与 `ui-reference.mjs` 的 `dag-*` 命令。

## 图与人工边界

0.8.0 创建 ui_reference_project_dag_v2，冻结项目、运行时、风格、primaryReference、原型、意图和分辨率。
所有面板 plan 节点依赖同一个 confirmed-primary-style 节点，没有代表面板或已接受图片锚点门。
每个面板独立通过计划、单次计算授权、生成、PNG alpha=255 技术检查与人工验收。
默认选择全部注册面板；显式子集披露 selection=explicit-subset。
风格/原型变更使旧 DAG 失效但不改写旧快照。旧运行时只允许完成图片的显式复核和导出，禁止计算。
接受图片不改变主参考；主参考只通过确认新风格版本更新。缺少完整主参考时要求修复风格。

## 初始化、查看与准备

先使用现有 init/style/import 接口建立项目。风格已由用户确认并激活。

```powershell
$Cli = 'game-ui-harnesses/ui-reference-harness/ui-reference.mjs'
$Project = 'work/my-game-ui'
$Created = node $Cli dag-create --root $Project | ConvertFrom-Json
$Dag = $Created.dag
node $Cli dag-inspect --root $Project --dag $Dag
node $Cli dag-advance --root $Project --dag $Dag --operation-id ([guid]::NewGuid().ToString())
```

dag-create、dag-inspect、dag-advance 不生成图片。advance 仅为当前依赖已满足且未准备的面板
创建冻结计划：任意面板均可准备，不依赖另一面板验收。它不授权、不提交、
不处理未知结果、不创建重试、不自动导出。导入、保存草稿、轮询、刷新和恢复均不得授权生图。
单个面板可用 dag-prepare，参数为 `--panel` 和 `--operation-id`。

返回的 dag、run、图片及交付路径都相对项目根目录。严禁接受客户端提供的服务器路径，
宿主先将自己的项目 ID 映射到已授权工作区，再调用接口。

## 生图与验收

```powershell
node $Cli inspect --root $Project --run runs/RUN_UUID
node $Cli dag-authorize --root $Project --dag $Dag --panel main-menu --run runs/RUN_UUID --operation-id OP_UUID --plan-sha256 PLAN_SHA256 --approval '用户针对该冻结计划的一次生成决定'
node $Cli dag-generate --root $Project --dag $Dag --panel main-menu --run runs/RUN_UUID --operation-id ANOTHER_OP_UUID --adapter work/provider-adapter.mjs
node $Cli dag-review --root $Project --dag $Dag --panel main-menu --run runs/RUN_UUID --operation-id REVIEW_OP_UUID --image-sha256 IMAGE_SHA256 --layout pass --style pass --copy pass --decision accept --note '用户对这张图的实际验收意见' --anchor false
```

命令中的占位 UUID 与摘要必须替换为实际值。DAG SHA 不能代替单份计划摘要。
对没有已有锚点的代表面板，接受时必须明确 `--anchor true`，不隐式升级为锚点。
有固定锚点之后，后续图片的 review 不再使用该参数。
首图接受后再调用 advance 为其余面板冻结计划，各自授权与生成；可由宿主安排有界并行，
本模块没有后台调度器或自动计算循环。

可选宿主交换：dag-request 保留一次请求，按冻结顺序传递原始 prompt 和图像；
dag-receive 用 `--request-sha256` 与 `--image` 保存返回 PNG。首次 request 返回 exchange，
相同 operationId 重放时 exchange=null，防止把查询误作新的派发指令。
确定已保存 raw.png 但处理未完成，可显式 dag-finish 重放同一 `--raw-sha256`。
不确定提供商是否接受时用 dag-stop 明确记录 indeterminate，不能再次提交同一 run。

## 持久化、重放与修改

所有变更要求宿主提供 UUID `operationId`，记录在 `dags/<id>/operations/`。
同一逻辑动作重传必须复用相同 ID 与相同参数；返回现有结果，不重新派发。
相同 ID 配不同参数会返回 DAG_OPERATION_CONFLICT。新的用户动作使用新 ID。
生成操作先持久化，核心在调用适配器前保留单次请求。崩溃后的 started 操作只供核对，
不能自动恢复模型调用；started 也不证明提供商已接受。真实状态以 run 证据为准。
不要通过重新创建 DAG、替换 operationId 或删除记录绕过会话、未知结果和修改轮次。
宿主按项目、风格和原型修订保存当前 DAG ID；重启后读取同一份 DAG，而非初始化新图。

```powershell
node $Cli dag-revise --root $Project --dag $Dag --panel settings --source-run runs/SOURCE_UUID --note '用户的实际修改意见' --operation-id OP_UUID
```

返回新 run，仍须新授权与新派发。修改以最近技术合格图为上下文，项目风格、原型与初始意图
保持不变。同一项目、风格、原型的面板会话最多三轮；新建 DAG 也不能重置已冻结轮次，
失败或未知的修改已提交则占一轮，记录不覆盖。
在原尝试仍保留请求、待接收或待本地处理时，先核对并明确处理原尝试。
初图终止且从未得到可修改图片时，显式 dag-retry 需要 `--source-run` 与 `--decision`；
它只准备新计划，不复用授权、不派发，也不能替代有图片后的三轮修改。
宿主适配器预检应在准备新一轮前完成；预检失败不应进入新修改轮次。

DAG 保留完整操作与运行历史。当前预览可显示最新有图片的结果；最近接受图独立记录。
与 Studio 一致，有更新待验收时仍可导出最近接受版本，状态中
`deliveryUsesOlderAccepted=true` 明确披露选择。更新验收不会替换项目固定锚点。

## 交付

```powershell
node $Cli dag-export --root $Project --dag $Dag --operation-id OP_UUID
```

所有选中面板都有当前风格的接受图后才允许导出。输出使用现有 exportProject/validateDelivery，
不由编排器制作第二种核心 manifest。目录为
`dags/<id>/deliveries/<accepted-selection-sha256>/`，相同选择重复导出复用并重新校验，
接受新版本后写新目录，旧 ZIP 保留。完整交付不包括 DAG 私有操作、授权或宿主信息。
UI 的仅 PNG ZIP 可在验证完整包后复用 Studio 的导出逻辑，不能冒充完整核心交付。

## 宿主接口与 Studio UX

公开函数与 CLI 一一对应，见 src/index.mjs。generateProjectDagPanel 的最后一个参数
是已有 `{generate(request) -> Uint8Array}` 适配器，其余函数不需要提供商。
actProjectDagPanel 接受 receive/finish/stop/review；receive 的 payload.rawSha256 是图片字节
真实 SHA-256，不是文件名或 JSON 摘要。inspectProjectDag 返回：

- status、currentContext、runtimeCurrent、selection，以及明确的图节点状态。
- anchor 的原图、计划和验收摘要；panels 中每轮 run、技术状态、最新可修改图片和最近接受图。
- 稳定 sessionKey、revisionsUsed/revisionsRemaining、deliveryUsesOlderAccepted、未完成操作和实际已保留调用数。
- output 的已验证交付目录、面板集合和选择摘要；没有完成时为 null。

宿主生成按钮可采用 Studio 相同的一次点击 UX：先完成只读预检；在该明确单图动作内
准备计划并读取确切输入，将点击决定绑定新计划 SHA，再调用授权与单次生成。
前端不出现“准备待生成计划”按钮，不增加第二次授权页面；DAG/create/advance 本身仍无计算授权。
HTTP 单次点击可通过既有操作日志记录各子步骤，稳定派生 prepare/authorize/generate 的不同
operationId。客户端断线或宿主重启后只能读取或完成已明确的确定性步骤，不能重新提交生成。

服务和前端由消费仓库实现。当前 Studio 的项目列表、风格确认、原型导入、面板补充、
进度、三轮修改、接受、回收站及两类导出是 UX 参考；服务接入需提供自己的 API 合同。
当前 DAG 从已确认的风格和已导入的原型开始；风格草案合并／预览沿用既有独立流程，
不将其描述成该 DAG 已实现的模型节点。只实现当前参考图链路。

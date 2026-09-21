# UI layer host contract v1 (preview)

唯一公开入口：`python game-ui-harnesses/ui-layer-harness/ui_layer.py`。
每次命令 stdout 输出一个 JSON（`--help`/`--version` 除外），过程信息写 stderr。
退出码 0 表示命令完成或正常等待，不等于视觉通过；非零表示本次命令失败。
不直接调用内部 Python 函数，内部 M1/M2 文件不作为 Web 合同。

## 输入与任务寿命

`run --image PNG --output NEW_DIR --target frozen|ui-layers --max-calls N`。
ui-layers 还需要 `--viewer BUILT_VIEWER_DIR`，包含 viewer.html/viewer.js。
输入为 EXIF 方向 1 的 PNG；每个任务新建目录；不得复用其他用户目录。
N 为生图素材上限 1..128，不是所有规划调用的 token/费用上限。
run/resume 可执行模型调用；status 为只读。模型网络授权及服务访问权限由宿主负责。

## CLI 操作

以下参数均加在 `ui_layer.py` 后：

| 操作 | 额外参数 | 含义 |
| --- | --- | --- |
| status | --output RUN | 读取状态，不推测成功 |
| resume | --output RUN | 继续尚未执行节点；不自动重试不确定请求 |
| authorize | --output RUN --job-digest DIGEST --approval TEXT | 记录用户对冻结摘要的真实授权 |
| next | --output RUN | 预留一次请求，返回 asset、submissionDigest、arguments |
| receive | --output RUN --submission-digest DIGEST --source PNG | 校验并接收真实生图结果 |
| fail | --output RUN --submission-digest DIGEST --reason TEXT | 记录失败或不确定结果，禁止自动重发 |

`arguments.prompt`、`arguments.referenced_image_paths` 是宿主生图输入。
宿主自行映射提供商参数，保留原提示词和参考图；路径是执行环境本地路径，不直接发给 Web。
每个 next 后必须有对应 receive/fail；响应丢失时先查状态，不再次 next/重新生图。
读取状态不能凭空判定远端已失败或安全重试。

## 状态

status 响应 kind=`ui_delivery_dag_status_v1`，包含 status、target、nodes、nodeSeconds、
failures、automaticRetries=0、humanVisualAcceptance=false。planning/generation/package 按阶段出现。
这是预览状态合同：消费端应忽略未知附加字段，遇到未知状态停止自动推进并显示诊断。

| status | 宿主动作 |
| --- | --- |
| incomplete | 展示阶段；无运行进程且没有不确定调用时可 resume |
| frozen | 仅规划目标完成 |
| awaiting_authorization | 展示 generation.jobDigest 和 maximumCalls，等待用户授权 |
| ready | 可 next 取一份生图请求 |
| awaiting_result | 已预留请求，等待对应结果；不可重新派发 |
| raw_complete | 可 resume 进入定位与打包 |
| blocked_no_resubmit / stopped_no_retry | 展示失败，等待明确的新处理决定 |
| delivered_pending_visual_review | 技术交付完成，等待用户视觉验收 |
| stopped（错误响应） | 命令退出非零；保留 reason，不能当成功 |

interrupted_or_running 节点不能仅靠文件判断是否仍有进程；进程生命周期由服务掌握。
正在运行的同一任务不能并发 resume。运行时或输入指纹变化将拒绝继续。

## 图层交付（Web/Pixi 消费边界）

成功输出 `RUN/delivery/ui-layers.zip`；`package-result.json` 为宿主记录。
ZIP 中包含 composition.json、manifest.json、review.json、reference.png、preview.png、
layers/*.png、viewer.html、viewer.js、README.txt。仅相对路径，无私有 session/凭证。

composition.schema 位于 `../ui-decomposition-harness/planning-harness/schemas/layer-composition.schema.json`。
kind=`ui_layer_composition_v1`；画布单位为原图像素；原点左上；layers 数组从后向前。
每层 id/name/role/path/x/y/width/height/visible；PNG 已是实际归位尺寸，不再按 bbox 猜测缩放。
textPolicy/backgroundMode 显式给出。用户上传的业务文字默认去除，不保证可编辑文字层。
manifest 校验字节数和 SHA-256；review 始终披露视觉待验收，不因校验通过而升级成视觉成功。
Web 应验证图层合同和资源摘要，不执行上传包内脚本；可复用本仓库构建的可信 Pixi 查看器。

## 服务端负责的映射

服务可以自定 taskId、上传和下载接口、进度通知及视觉验收 API；这些不是拆分核心字段。
保留核心版本、任务目录映射、冻结摘要、请求摘要和产物摘要；对 Web 隐藏本地路径及会话细节。
用户提出追加修正时新建绑定计划和授权，不手改旧回执/交付清单，不自动无限重生。

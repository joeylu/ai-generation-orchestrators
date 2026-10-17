# Web 接手入口：16 类组件

`ui-chain-components-v0.1.0-rc.4` 支持 `existing-image` / `generate-reference`：已有 PNG，或文字/风格先生成参考 PNG、人工接受后再生成组件。核心提供 CLI/API 与浏览器组件工厂；生产 HTTP 由 Docker 宿主实现。旧 Studio 仍是图片入口，不是新增文字 UI 的证明；不要将其内部路由或[Docker 接入](docker-integration.md)中的 proposed 名称当作现成 API。

第一步取得部署方交付的 **OpenAPI 3.1、请求/响应实例、状态/错误表、容器验收报告、核心及镜像摘要**。缺少实际合同就先停在接口 mock，不写死端口、私人服务 URL、凭证或历史验收路径。当前接入结束在 16 类组件输出，暂不实现面板生成、规划或编辑。

## 用户流程与页面数据

| 用户动作 / 页面 | Web 发送 | Web 必须展示或保留 |
| --- | --- | --- |
| 新建项目 | 选择 existing-image 上传 PNG，或 generate-reference 填描述/风格、可选指导 PNG及尺寸 | 两入口区别、原始/冻结输入预览；默认开启 S05，已有批次API需显式 true |
| 准备参考计划（生成模式） | 描述、可选 style/guide 与尺寸，不传计算确认 | `planSha256`、`requestSha256`、用途、尺寸、最多一次；参考阶段只生成不透明 PNG |
| 确认参考生成 | 当前计划的 `confirmedReferencePlanSha256` | 提交后查询原任务，禁重复提交；不是图集授权 |
| 参考图人工接受 | 实际预览 `imageSha256` 与同一 `confirmedImageSha256`、accept/reject | 技术 QA 与人工决定分别显示；accepted 的 `reviewSha256`；拒绝或尚未接受不能准备新桥接批次 |
| 准备批次 | 项目 ID；不发计算确认 | 冻结参考/风格预览、S01–S05 或 S01–S04、图数、资产数、`batchSha256`、每图范围 |
| 用户确认图集生成 | 新显示的 `batchSha256` 与 `confirmedBatchSha256`；生成模式另绑定 `sourceReferenceSha256` | 明确第二个计算决定；默认 5 张图集，参考接受/旧确认都不能代替 |
| 制作进度 | 只读任务查询，轮询频率按实际合同 | 每图等待/提交/接收/失败/未知，以及本地节点状态；来自真实时间戳的耗时 |
| 图像接收异常 | 明确选择参考接收恢复或组件图集接收恢复 | “检查已返回图片，不生成”；参考 `reception-incomplete` 只恢复可信已保存原字节，没有来源就停止 |
| 缺图/拒绝图补图 | 先准备单图新计划，用户确认新摘要后才提交 | 仅补哪张、新计划摘要、一次调用；保留其他图及原失败历史 |
| 本地处理暂停 | 明确的确定性 resume 操作 | 失败节点、可恢复范围、无新增模型；工具/来源变更另建任务 |
| 组件包可用 | 获取包清单/预览/下载 | 16 类试玩、材质与槽位、技术检查和原图警告、外观待验收、完整包下载 |

生成参考模式默认共 1 + 5 张、两次计算确认；关闭 S05 为 1 + 4 张。已有 PNG 模式跳过参考生成，仅确认图集。参考人工接受是单独决定，不能自动预勾选图集确认。五图仍为 32 基础部件+3 材质、16 类组件；按冻结合同显示历史数量，不增加第 17 类纹理控件。

用户预览/接受使用 `imageSha256`（PNG）；图集桥接的 `sourceReferenceSha256` 是 `source-reference.json` 完整字节摘要，包含来源与 batch 绑定，不是图片 SHA。直接采用宿主返回值，不自行拼 JSON 或计算另一种摘要；人工接受后还要展示新图集批次。

## 状态与错误处理

HTTP 成功、图片返回、技术 QA、参考人工 accepted 和最终组件接受分别显示。参考 `pending-visual-review` 仅表示可供审查，人工拒绝是 `rejected-visual`；只有 accepted 对应的图片/审查摘要才能桥接，换图、换描述/风格须新计划。保留组件单图 `inspection` 与 `originalChecksPassed`；最终 `awaiting-visual-review`、`productionReady: false` 仍显示“技术检查通过，待组件外观验收”，参考 accepted 不覆盖它。

参考 `reserved-no-resubmit` / `indeterminate` 与图集 failed/indeterminate 不自动重发；参考技术/视觉拒绝不能显示“重新执行原计划”。断连/刷新后查询原任务，生成类 fetch 禁自动重试；两阶段幂等键分别绑定其摘要。换参考须新参考计划与新确认，图集补图须新单图计划与确认；查询可重试，接收恢复不生成。

界面只展示宿主脱敏的稳定错误代码、原因及实际可用操作。`failed-retryable` 是 DAG 的本地确定性阶段状态，不能翻译为“重试生成”。没有取消协议时不得把关闭页面显示成“模型调用已取消”；不根据估算进度伪造剩余分钟数。

## 组件消费包

宿主返回的包应完整包含：

- `manifest.json`：`kind: ui_component_consumer_candidate`、16 类数量、文件 SHA-256、源皮肤摘要以及待验收字段。
- `kit.json`：冻结 registry / usage / template / theme 和浏览器皮肤数据；是生成结果，不是新的维护源。
- `runtime.mjs`：随包构建的 PixiJS/PixiUI/Layout 组件运行时及 `createComponentKit`。
- `skin/`：分离 PNG、字体、材质和原始 SkinPack 清单；不要只下载基础部件丢掉 S05 绑定。
- `source.json`、`dependencies.json`、`licenses/`、`LICENSE`：来源和依赖许可；`checks.json`、横竖预览由宿主另交付其技术证据位置。

完整包按清单核验。主机路径不属于 Web 合同；访问资源使用宿主返回的安全 URL/文件 ID。不要从用户可控字符串拼接本机路径，也不要允许 ZIP 越界解压或远程任意 URL 作为冻结资源。

同一个组件包内 `runtime.mjs` 与 `kit.json` 一起使用，不将另一版本的皮肤或全局 Pixi 实例混进来。资源和模块通过同源或合同允许的静态 origin 提供；CSP/CORS、URL 有效期和用户授权归 Web/宿主配置。预览不应需要仓库、`node_modules`、模型服务或 CDN。

最小接入示例（代码部署在解包目录中，使用相对静态资源 URL）：

```js
import { Application, createComponentKit } from './runtime.mjs';
const app = new Application();
await app.init({
  width: 1280,
  height: 720,
  preference: 'webgl',
  layout: { autoUpdate: true, throttle: 0 },
});
document.querySelector('#component-preview').append(app.canvas);
const data = await (await fetch('./kit.json')).json();
const kit = await createComponentKit({ app, data, onEvent: handleComponentEvent });
const button = kit.runtime.create({
  id: 'start',
  recipeRef: 'button@1.0.0',
  props: { label: '开始', enabled: true, variant: 'primary' },
  size: { width: 240, height: 56 },
});
kit.runtime.mount(button);
kit.runtime.flush();
function disposePreview() {
  kit.dispose();
  app.destroy({ removeView: true }, { children: true });
}
```

`handleComponentEvent` 由 Web 定义。换包或卸载时调用 `disposePreview`。组件创建属性、试玩运行值和页面业务状态分别维护；初始化/恢复/程序更新不冒充用户操作。句柄的 `snapshot()` 是单组件创作字段，不是完整资源包或面板导出；不要用它代替消费包清单。完整组件和布局约束见[组件运行时](component-runtime.md)、[布局合同](layout-contract.md)与[材质](skin-surfaces.md)。

## Web 验收

按实测合同回放两种起点：参考确认前零调用、确认后一次、技术 QA/人工接受隔离、接受后未确认批次零图集调用、拒绝/摘要变更阻断、两阶段重复确认/断网刷新/接收恢复、图集补图新确认和本地恢复。离线替身通过不是真实模型或人工美术接受；浏览器恢复同一任务，不新增重复尝试。

消费包验收覆盖全部 16 类、最小/正常/伸展尺寸、中文长短文本、禁用与选中状态、鼠标/触摸/输入焦点、横竖预览、1:1 槽位普通/选中、S05 标题/分组/底纹绑定。检查控制台无错误、字体与所有资源可加载、无外部模型/CDN请求；Web 的真实设备 IME/触摸验收与核心离线检查分别记录。

把预览、技术证据与源风格参考并排交给用户人工验收。技术通过是进入这一步的条件，不能替用户签署美术接受，也不触发后续面板任务。

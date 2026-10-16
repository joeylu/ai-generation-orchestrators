# Web 接手入口：16 类组件

Web 接入分为两部分：通过部署方实装的 HTTP 合同管理组件生成，通过生成包内的浏览器运行时预览/消费组件。本发行提供后者的组件工厂及文件合同；前者由 Docker 宿主实现。不要把本地 Studio 内部路由或[Docker 接入](docker-integration.md)中的 proposed 操作名称当成已发布 API。

第一步取得部署方交付的 **OpenAPI 3.1、请求/响应实例、状态/错误表、容器验收报告、核心及镜像摘要**。缺少实际合同就先停在接口 mock，不写死端口、私人服务 URL、凭证或历史验收路径。当前接入结束在 16 类组件输出，暂不实现面板生成、规划或编辑。

## 用户流程与页面数据

| 用户动作 / 页面 | Web 发送 | Web 必须展示或保留 |
| --- | --- | --- |
| 新建项目 | 项目名、预设风格或上传参考、补充描述、材质选项 | 原始输入预览、实际上传限制；新项目默认开启 S05，底层明确传材质 true |
| 准备批次 | 项目 ID；不发计算确认 | 冻结参考/风格预览、S01–S05 或 S01–S04、图数、资产数、`batchSha256`、每图范围 |
| 用户确认生成 | 当前显示的同一 `batchSha256` 与一次确认 | 提交后锁住重复按钮，查询已有任务；切换项目或取消不授权 |
| 制作进度 | 只读任务查询，轮询频率按实际合同 | 每图等待/提交/接收/失败/未知，以及本地节点状态；来自真实时间戳的耗时 |
| 图像接收异常 | 明确点击接收恢复 | 标明“检查已返回图片，不生成”；没有可信来源时显示原原因 |
| 缺图/拒绝图补图 | 先准备单图新计划，用户确认新摘要后才提交 | 仅补哪张、新计划摘要、一次调用；保留其他图及原失败历史 |
| 本地处理暂停 | 明确的确定性 resume 操作 | 失败节点、可恢复范围、无新增模型；工具/来源变更另建任务 |
| 组件包可用 | 获取包清单/预览/下载 | 16 类试玩、材质与槽位、技术检查和原图警告、外观待验收、完整包下载 |

材质不新增交互组件。当前修订 3 五图=32 基础部件+3 材质；显示数字读取冻结合同。历史四图、旧修订 2、补图来源不能被前端替换成统一 35。

## 状态与错误处理

HTTP 200/202、图片已返回、`received`、技术检查通过与人工接受是不同结果。保留单图 `inspection` 和整批 `originalChecksPassed`；允许 rejected 候选定位不等于消除了原始失败。最终核心状态 `awaiting-visual-review` 和 `productionReady: false` 应显示为“技术检查通过，待外观验收”，不显示“已发布”。

`failed` / `indeterminate` 不自动重发模型请求。网络错误后重新查询已有任务；不要将浏览器刷新、fetch 重试或用户重复点击变成第二次确认。对提交类请求按宿主合同提供幂等键，并复用相同操作的既有任务 ID；查询请求可以重试，生成请求须遵守合同禁止自动重投。补图必须是新单图计划、新摘要与新确认。

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

按部署方实例回放准备、取消、确认、重复确认、缺图、unknown、单图新确认、接收恢复和本地恢复；核对每次调用数及实际状态。浏览器离线/刷新后应恢复同一任务，不生成重复项目/批次尝试。

消费包验收覆盖全部 16 类、最小/正常/伸展尺寸、中文长短文本、禁用与选中状态、鼠标/触摸/输入焦点、横竖预览、1:1 槽位普通/选中、S05 标题/分组/底纹绑定。检查控制台无错误、字体与所有资源可加载、无外部模型/CDN请求；Web 的真实设备 IME/触摸验收与核心离线检查分别记录。

把预览、技术证据与源风格参考并排交给用户人工验收。技术通过是进入这一步的条件，不能替用户签署美术接受，也不触发后续面板任务。

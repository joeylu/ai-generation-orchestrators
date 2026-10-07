# 任务与画质两例真实复验通过

状态：**PASS**。批准冻结摘要 `de0006cfbbcdf55b84a386d0068ba2b836cb2c87f35213e3624d7465a2adc44c` 后，原样任务需求与画质需求各实际调用一次 gpt-6-luna / xhigh，自动重试0；方案、业务、编译、Intent 0.8来源绑定均2/2通过。

任务原始返回的 panel.title 为“任务详情”，任务名称行的 text 保留“森林巡逻”，两个字段没有混用。三行只读标签、内容及追踪/关闭事件保持。画质本次调用成功完成；此前传输失败与未知用量记录保留，这一次成功不证明网络永久稳定。

23项真实Pixi交互及交付检查通过：整体标题、只读标签与内容实际渲染，画质选择、开关、默认恢复、按钮事件，以及两份Studio实际下载ZIP的CRC、大小、SHA和共同Pixi/Unity来源。两份包均展开后断网打开、试玩状态重新导入通过。后处理模型调用0。

改任何冻结源码之前独立核验209份源码、根/子消费记录、2份原始Intent与proposal、9处来源引用、Bundle、浏览器报告、ZIP及全部展开文件通过。两份回执用量均已知：输入57036、缓存0、输出1428 Token。

原16次14/16和FAIL保持，未运行的第二轮及组合/交付没有补写成功，也没有把两例结果拼接进去。五份更早FAIL及删除确认一次PASS原字节保持。

- 两例真实预览与ZIP入口（本地产物：`../output/panel-title-recheck-accepted-v1/index.html`）
- 独立真实审计（本地产物：`../output/panel-title-recheck-accepted-v1/acceptance.json`）
- 真实生产报告（本地产物：`../output/panel-title-recheck-run-v1/quote-recheck-report.json`）
- 23项实际浏览器/离线交付检查（本地产物：`../output/panel-title-recheck-run-v1/browser/browser-report.json`）

## 修复Studio入口

当前修复版Studio：`http://127.0.0.1:4197/`。启动时验证209份源码与上述真实PASS证据、静态构建摘要以及登录可见性，通过隐藏本地进程启动。旧4196及其它服务保持，全局设置未改变。

13项零模型入口检查通过：两份本次真实Bundle精确导入、Pixi可见、整体标题实际渲染、任务的三个只读值/标签和两个仅通知按钮、需求/修改输入就绪、390宽度无横向溢出及无外部请求/浏览器异常。
检查阻断全部非GET和外部请求，生成/修改没有点击；新运行目录为空或不存在。独立入口审计通过。

- Studio启动回执（本地产物：`../output/panel-studio-panel-title-live-v1/launch.json`）
- 13项入口浏览器检查（本地产物：`../output/panel-studio-panel-title-live-browser-v1/browser-report.json`）
- Studio独立审计（本地产物：`../output/panel-studio-panel-title-live-accepted-v1/acceptance.json`）

这里只证明两个原样失败输入的新单次复验通过；完整16条独立两轮及同轮组合尚未完成新的真实验收。原生Unity/其它引擎及人工视觉认证本次NOT_RUN。

下一份[完整16类两轮计划](panel-title-stability-plan-2026-10-06.md)已零模型准备，最多32次的新摘要需独立授权。

# 同名按钮：单次真实编辑结果

用户对冻结摘要`c8f2741a11aa3b4d23cb216ec262ea0191d4f7e0897401fe1f1b566e464c213d`回复“你来吧”后，完成一次Codex CLI / gpt-6-luna / xhigh真实编辑，119563ms，自动重试0。声音与显示两个分组的同名按钮分别准确改成“仅恢复声音”“仅恢复显示”，只变化两处buttonLabel；其余Spec、行为、绑定和35/81试玩值保持。

入口：`output/scoped-copy-real-edit-plan-v1/review/index.html`。左侧为人工编写的基础协议夹具，右侧为真实模型编辑方案经现有Workbench直接接受的结果。基础面板不是模型生成结果；本次没有重新设计美术，不作为新的美术样本或真实生成与编辑整链路验收。

完整需求：

> 声音分组里的恢复默认按钮文字改为“仅恢复声音”，显示分组里的恢复默认按钮文字改为“仅恢复显示”，其他保持不变。

## 验收结果

| 项目 | 结果及证据 |
| --- | --- |
| 真实调用 | 唯一一次，119563ms，gpt-6-luna/xhigh，自动重试0；输入42911、输出324、缓存输入0 tokens |
| 原运输回执 | `real-call/codex-edit-a41da08c-1956-4b83-9f4b-d9d8de4d7494/codex-edit-receipt.json`，READY_TO_APPLY |
| 原生草稿 | CodexEditDraft0.3，只有两条set-button-label，分别绑定row1/row3；各自引用原需求的精确分组限定句，unresolved为空，noChange=null |
| 公共核对 | EditContext0.14 / explicit-properties-v4，两处明确文案与完整“其他保持不变”检查MATCHED |
| 独立预期 | 全Spec只有`sections[0].rows[1].buttonLabel`和`sections[1].rows[1].buttonLabel`变化；目录、布局、动作、绑定、素材、编译器和试玩值保持 |
| 保存包 | `panel.bundle.json`，Bundle SHA-256 `cb323972d23e61ee72edf35a5d7e0126f06335cfa442d6f7dd999ff724e74027` |
| 轮次及撤销 | 成功修改计1/10；撤销恢复原包，已用轮次仍为1 |
| 浏览器 | 5组PASS；桌面和390px下两组独立reset/事件、编辑前状态独立、无截断和严格即时导出通过 |
| 实际下载 | 1份ZIP的CRC/文件摘要、无图库导入导出、file URL离线Pixi打开通过；错误和外部请求0 |
| 来源审计 | 24份冻结输入及284份源码/协议/提示/锁定依赖指纹保持；唯一真实目录，原生草稿重新物化与原方案一致，原方案Patch结果等于交付Spec |
| 汇总 | `acceptance.json`为TECHNICAL_PASS；`provenance-audit.json`为PASS；humanVisualReview、nativeUnity、gameIntegration均NOT_RUN |

浏览器实际点击“仅恢复声音”后得到70/81，恢复试玩状态再点击“仅恢复显示”后得到35/40；两个按钮各自发出原有panel.row1/panel.row3事件。桌面与390px均检查通过。390px是固定画布缩放容纳，不代表响应式重排。

已查看真实结果对比截图，文字未截断；这里没有评价新的审美方案。字体与基础布局保持，未新增字体内嵌或高DPI验收。

## 来源、授权与范围

原生结构化草稿、公共方案、上下文、检查报告和运输回执原样保存；既有传输层不落盘CLI原会话日志。本次没有手工修补模型输出，也没有用程序预演替代真实结果。`audit-result.mjs`仅重放保存产物，不发起新模型请求；本轮审计调用0。

冻结plan、准备README、预演文件及prepared-review保持授权前状态，不回填成功。执行事实由新增dispatch-claim、原生草稿/方案/回执、terminal-result、acceptance和provenance-audit表达。terminal-result的browser=NOT_RUN是浏览器验收前历史阶段，后续以acceptance为准。[准备记录](scoped-copy-real-edit-plan-2026-10-09.md)中的失败及只读登录预检证据保持。

原基础包及两份历史真实暂停菜单包的字节摘要复核保持。本轮没有新的生产代码改动，没有重跑无关全量回归；先前1370项程序回归与19组替身页面检查仍按其原证据记录。未启动、停止或替换4951服务，未修改其他Harness、接入游戏或推送GitHub。Unity只生成UGUI导出工具包，编辑器原生导入及交互未验收。

这只证明两个精确分组限定的同名按钮在本样本中一次改对，不代表模糊指代、长段混合需求、所有同名情况、素材保留或全部自然语言已覆盖。本次单次授权已消费，不继续调用生成或编辑模型。

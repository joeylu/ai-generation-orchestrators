# 面板与游戏业务绑定

PanelSpec 描述面板；业务绑定表描述游戏方如何接收值和动作，独立于面板美术、文字与引擎。
运行时使用明确的 fieldId/rowId，不按中文标签猜音量或提交行为。表中的 panelSha256 锁定来源包；
修改或重新导出来源后需要重新核对绑定，不静默沿用失效字段。

## 游戏端口

游戏提供四个方法：

| 方法 | 合同 |
| --- | --- |
| getSnapshot() | 同步返回业务状态快照 |
| subscribe(listener) | 状态变化时通知，返回解绑函数；状态订阅不产生玩家事件 |
| update(patch) | 同步、原子地校验并更新映射字段；业务拒绝时保留已有业务状态 |
| invoke(command, payload, {signal, instanceId}) | 执行业务动作，返回 Promise；提交前检查取消信号 |

端口可以接游戏已有设置、角色或加载系统。核心不会自行调用游戏全局对象、联网或写存档。
createMemoryGamePort 是本地参考实现/测试替身，不是数据库或持久化层。
如果业务值拒绝玩家修改，输入草稿保留并报告错误，不会把未提交值描述成业务成功。

```js
const binding = {
  gameBindingVersion: '0.1', panelId: bundle.spec.id, panelSha256: bundle.sha256,
  states: [{ fieldId: 'volume', key: 'masterVolume', direction: 'two-way' }],
  commands: [],
};
const bridge = attachPanelGameBinding({host, instanceId: 'settings-main', bundle, binding,
  port: gameSettingsPort,
  onError(problem) { showGameError(problem.code); },
});
// 销毁顺序：先取消业务绑定，再销毁对应视图。业务端口由游戏所有者释放。
bridge.destroy();
host.get('settings-main').destroy();
```

业务键和示例字段 ID 须换成实际来源定义。结构见 schemas/game-binding.schema.json；
validateGameBinding 进一步验证来源摘要、字段存在性、唯一性和提交字段范围。
该 JSON 格式可供其他引擎读取，本轮业务执行适配已实现 JS/Pixi，尚未实现 C# 业务绑定解释器。

states.direction 支持 two-way、from-game、to-game。进度字段只允许 from-game，避免把只读进度当玩家输入。
from-game/two-way 在接入时从游戏快照静默恢复；to-game 保留面板当前输入。
宿主重置动作只回写声明重置的映射字段，其他业务字段不变。

commands 按按钮 rowId 映射显式动作名，payload 将业务参数名映射到已有字段；
提交按钮只能读取自己声明的提交字段，保留原始 Unicode 字符串，不自动 trim 或改名。
必填校验失败不执行业务提交。drop 在同一路由未完成时丢弃重复操作；replace 取消旧任务并启动新任务。
失败不自动重试，用户再次明确点击才能重提。端口负责取消信号后的业务提交规则，外部已经发生的副作用不能由 UI 撤销。

关闭视图保留绑定，因此后台进度仍可更新保留状态；重开读取当前进度。
销毁绑定会取消其任务、解绑宿主与业务订阅，迟到的参考任务无法写回。
业务数据的生命周期独立于 UI，新视图从业务快照恢复草稿和设置；不把业务当前值改成 PanelSpec 默认值。

## 可运行示例与 SDK

```sh
node scripts/build-game-demo.mjs --bundles <COM01-COM03-directory> --output output/<fresh-game-demo>
node scripts/check-game-browser.mjs --demo output/<fresh-game-demo> --output test-results/<fresh-game-check>
node scripts/export-game-sdk.mjs --output output/<fresh-game-sdk>
```

示例模板在 examples/game-integration-v1/bindings.mjs，明确针对已有三份验收包，不是任意需求的自动业务猜测。
构建导出五个独立 .game-binding.json，每份和面板来源摘要绑定；改标签不会改变字段路由。
SDK 只复制允许的模块，核心无引擎、文件系统、网络、数据库或模型依赖；导出有文件摘要和独立导入检查。
它是工作区开发交付，尚未打不可变生产标签或发布 npm。

Web 参考端口包括三条实际 Web Audio GainNode 总线，用户点击才启用 AudioContext；
可连接游戏现有 AudioNode。本页没有音源、不自动播放，也不把 Gain 参数验证称为完整听感测试。
角色确认写入本页内存，取消不删除草稿；“已存在”用于固定业务拒绝用例，失败后保留已有角色。
本地加载读取两张内嵌 PNG，核对 SHA-256、解码并关闭 ImageBitmap；按已完成字节更新进度。
700 ms 分步等待仅帮助观察/取消演示，进度不按时间伪造；它不是网络下载吞吐测试。

scripts/check-host-integration.mjs 同时覆盖这份业务演示。[首次 Web 业务接入验收](game-integration-acceptance-2026-10-06.md)
保留了当时原生业务 NOT_RUN 的记录。后续已补 [Unity 业务绑定 SDK](unity-game-binding.md)，
原生业务 21 项通过；可复核其源码摘要与独立原生证据，见 [原生业务验收](unity-game-integration-acceptance-2026-10-06.md)。

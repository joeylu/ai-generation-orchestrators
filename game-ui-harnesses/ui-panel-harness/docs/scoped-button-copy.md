# 同名按钮的分组定位

Studio新增[本地选择同名目标](local-edit-target-choice.md)：一个精确改名请求遇到重复原名时先列分组，不调用模型；用户选择后再点击才提交。它是客户端帮助，本文的公共核对语义及版本保持。

后续[单次真实编辑](scoped-copy-real-edit-results-2026-10-09.md)已完成：两个分组的同名按钮一次精确改名，其他字段和试玩值保持；5组浏览器及1份实际ZIP通过，授权已消费。基础面板是程序夹具，不作真实生成或新美术验收。

沿用当前菜单视觉，本轮只补按钮文案编辑中的定位缺口。Studio 新的 modern-v3 编辑采用 EditContext 0.14 / `explicit-properties-v4`，在[精确文案核对](button-copy-checks.md)上增加分组限定和已选中按钮的原名定位。

当“声音”和“显示”分组各有一个“恢复默认”按钮时，可以输入：

> 声音分组里的恢复默认按钮文字改为“恢复声音”，其他不变。

程序先在基础面板中匹配唯一的分组标题，再匹配组内唯一的按钮名称，将结果绑定到稳定 row ID。修改后只检查该ID，不会把另一组的同名按钮一起改掉。两个分组都要改时，可分别写完整要求；漏改其中一项或交换两个新文案都会整轮拒绝。

也可以先点选显示分组的按钮，再输入：

> 恢复默认按钮文字改为“恢复显示”，其他不变。

已有的程序点选ID可消除名称重复，不必强制改写成“这个按钮”。选中后明确指定其他分组不会覆盖点选范围；需要改其他对象时应先取消选择或重新选择。

## 确定性范围

- 分组限定支持 `分组里的`、`分组中的`、`分组内的`、`分组的`；名称可使用前一版支持的成对引号，新文案仍须带引号。
- 匹配使用当前Spec中的精确分组标题与按钮文字；唯一按钮、未加引号的点选指代和原有文案检查继续支持。
- 完整名称放在引号中时按字面名称处理。例如名叫“声音分组里的恢复默认”的按钮不会被拆成分组限定；引号中的“这个”也不是指代词。
- 重名分组、同一组内多个同名按钮、未点选的全局同名按钮、未知名称与无法识别的表达保留为未核对，不由程序选择第一个对象。此时模型仍需解释或澄清；未核对不等于自动拒绝所有方案，也不等于已验证自然语言语义。
- 本次只为按钮文案提供分组限定，未扩展到字号、默认值或页签别名。复杂改口、排除条件、任意口语和整页修改仍保留原边界。

完整识别的“其他不变”继续保护其余属性，包括原来的事件、绑定、reset/submit作用范围、素材、布局和样式。成功改名保留当前试玩值，点击后的实际行为保持；失败不替换面板、不新增历史或成功轮次。最多10轮及撤销不返还轮次的规则保持。

EditContext0.11–0.13和已保存摘要继续按原解释重算；0.14有独立Schema及模型提示，Spec/Bundle、编译器、素材和交付格式没有变更。旧0.13对分组限定和选中后原名重复的判断不会被静默更新。

## 验证 · 2026-10-09

| 项目 | 结果与证据 |
| --- | --- |
| 新增回归 | `tests/scoped-button-copy.test.mjs`：15项，覆盖四种分组表述、双目标完整性、歧义与选中范围、字面名称、状态/轮次、上下文篡改和CLI替身提示接入 |
| 对应回归 | `output/scoped-copy-targeted-v2.txt`：114/114 PASS；最终引号边界由后续全量回归覆盖 |
| 最终全量回归 | `output/scoped-copy-full-regression-v2.txt`：1370/1370 PASS |
| 最终静态构建 | `output/scoped-copy-studio-v2/`，仍使用modern-menu目录与12个内置素材 |
| 实际页面 | `output/scoped-copy-browser-v2/browser-report.json`：19组PASS，13次程序替身编辑，模型调用0、自动重试0，错误/外部请求/意外请求均0 |
| 页面新增覆盖 | 夹具返回同名澄清且不修改；改错分组、跨组重置、漏改第二项均拒绝；点选后原名定位；声音/显示各自实际点击仅重置本组；撤销、实际JSON下载、严格重编译、重导入及已用轮次保持 |
| 旧版与来源 | `output/scoped-copy-compatibility-v1/audit.json`：7份保存的0.13上下文内容/摘要原样通过，2份原真实菜单包文件SHA保持并严格重编译通过 |

19组页面检查包含前一版11组文案边界的当前源码重放，以及本次8组分组场景。13次编辑全部来自明确注入的固定程序替身；澄清问题同样由夹具预先指定。它们证明UI、协议核对和状态行为，不能证明真实模型会正确理解全部同名、纠正或混合输入。通用语义及Unity编辑器验收均为 `NOT_RUN`，未重跑ZIP验收。

实施前的14项检查全部失败，记录保留于 `output/scoped-copy-before-v1.txt`。落地后v1对应检查87项通过；补提示替身检查并纳入已有输入场景后v2为114项。首轮全量1370项及页面19组通过后，复查收紧了引号内“这个”的字面语义，最终新构建重复对应全量与页面验证通过；两轮报告分别保留。

重现时使用新的输出目录：

```sh
node --test tests/scoped-button-copy.test.mjs tests/button-copy-checks.test.mjs tests/edit-property-review.test.mjs tests/point-selection.test.mjs tests/layout-details.test.mjs tests/input-coverage-v2.test.mjs
node scripts/build-workbench.mjs --catalog examples/modern-menu.catalog.json --assets builtin --output output/my-scoped-copy-studio
node scripts/check-button-copy-browser.mjs --workbench output/my-scoped-copy-studio --output output/my-scoped-copy-browser
```

原真实方案、回执、包与失败证据保持。既有计算授权已消费，本轮模型/媒体调用0；新真实调用仍需新的冻结计划与明确授权。未启动、停止或替换4951服务，未接入游戏、修改其他Harness或推送GitHub。当前代码将在下一次正常Studio构建启动时生效。

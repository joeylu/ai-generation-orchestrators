# 精确按钮文案修改

新菜单真实样本获得用户“还可以”的反馈后，保留这一视觉方向，先补输入和编辑中的一个高频缺口。本页记录 EditContext 0.13 / `explicit-properties-v3` 在原属性检查上加入按钮文案的独立核对。后续Studio新修改已采用[0.14同名按钮分组定位](scoped-button-copy.md)，保存的0.13规则保持。

例如已有唯一的“继续游戏”按钮时，可以输入：

> 把“继续游戏”按钮文字改为“返回游戏”，其他保持不变。

也可点选按钮后输入：

> 这个按钮文字改为“返回游戏”，其他不变。

程序将原始按钮名称绑定到基础面板的稳定 row ID，随后检查最终文案；改名后不会再用新名称寻找对象。少改一个指定按钮、改错对象、缩短文案，或声称无需修改但实际不满足要求，都以 `EDIT_REQUEST_INCOMPLETE` 整轮拒绝。“其他不变”被完整识别时，还会保护其余控件、布局、样式、事件及 reset/submit 作用范围。失败不替换当前面板、不消耗成功轮次，也不自动重试。

## 支持与边界

- 支持“文字/文案 + 改为/改成/设为”等明确赋值，新文字须以成对的 `“”`、`「」`、`""` 或 `''` 包围；多个要求可用逗号、句号、分号或换行分隔。
- 完整保留引号内的否定词、内部空格、标点和 emoji。名称必须唯一，或由程序拥有的点选 ID 明确指定；点选后不能暗中改其他对象。
- 同名未点选、改口、举例、重复赋值、未闭合引号、同类嵌套引号及无法拆分的连写要求保留为未核对。存在未核对短句时，不强制宣称“其他不变”已完整验证。模型仍需解释或澄清；通用语义审核保持 `NOT_RUN`。
- 精确核对不放宽原 Spec 和组件文本合同。例如文案前后带空格时，核对阶段保留原值，但组件会以 `STRING_REQUIRED` 拒绝编译；Studio 保留原面板和轮次，不偷偷 trim。模型提示要求对此澄清。
- 该功能只核对最终文案和明确修改范围，不能保证任意长度的文字都排得好看。

0.11 的几何检查及 0.12 的属性策略保持原规则与摘要，不将已保存上下文升级。新增版本使用独立 Schema 和编辑提示，Draft 0.3、Proposal 0.1/0.2、PanelSpec/Bundle、编译器和最多10轮成功修改规则没有变更。

## 本地验证 · 2026-10-09

| 检查 | 结果与证据 |
| --- | --- |
| 新增回归 | `tests/button-copy-checks.test.mjs`：16项，包括多个按钮、Unicode原文、歧义、选中范围、未指定样式/行为、假无需修改及上下文篡改 |
| 对应回归 | `output/button-copy-targeted-v4.txt`：99/99 PASS |
| 全量回归 | `output/button-copy-full-regression-v2.txt`：1355/1355 PASS |
| 当前 Studio 构建 | `output/button-copy-studio-v2/`，沿用 modern-menu 目录与12个内置素材 |
| 真实页面操作 | `output/button-copy-browser-v5/browser-report.json`：11组 PASS；7次显式注入的程序编辑替身，模型调用0、自动重试0、错误/外部请求/意外请求均0 |
| 页面覆盖 | 漏改、少改第二项、额外样式及重置范围拒绝；前后空格的组件拒绝；有效中英/emoji文案渲染和原按钮事件；实际JSON下载、严格重编译和重导入；撤销与轮次；点选改名及真实点击重置两个字段 |

浏览器检查通过真实 Studio 输入和按钮操作，经本地测试服务及公共校验器处理。替身只按测试预先指定的 operations 返回，不解释自然语言，不启动 Codex 进程。以上结果不计入真实模型成功次数。本轮没有重新验收ZIP或Unity编辑器，也没有接入游戏。

重现时使用新的输出目录：

```sh
node --test tests/button-copy-checks.test.mjs tests/edit-property-review.test.mjs tests/point-selection.test.mjs tests/layout-details.test.mjs tests/input-coverage-v2.test.mjs
node scripts/build-workbench.mjs --catalog examples/modern-menu.catalog.json --assets builtin --output output/my-copy-studio
node scripts/check-button-copy-browser.mjs --workbench output/my-copy-studio --output output/my-copy-browser
```

失败证据保持：实施前 `button-copy-targeted-v1.txt` 为1 PASS/14 FAIL；v2测试误用了无效submit空字段夹具，52 PASS/1 FAIL；修正夹具后的v3为98 PASS，追加连写/嵌套引号边界后v4为99 PASS。浏览器v1发现前后空格触发原组件合同拒绝；v2为测试读取响应体的时序失败；v3误读了事件字段（应为name）；修正测试后v4通过，随后最终源码与新构建的v5通过。没有改写模型输出或降低门禁。

原真实菜单方案、回执和包只读保留。当前源码已有意变更，原冻结计划的源码指纹只证明执行当时的版本，不代表此版本已完成真实复验。既有计算授权已消费；新真实调用仍需新的冻结计划与明确授权。4951服务进程没有启动、停止或替换，修改将在下一次正常Studio构建启动时生效。

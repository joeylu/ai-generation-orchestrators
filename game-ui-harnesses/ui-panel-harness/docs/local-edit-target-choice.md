# 同名按钮：本地选择修改对象

Studio在提交真实编辑前增加一个有界的本地提示。例如声音/显示分组各有“恢复默认”，输入：

> 恢复默认按钮文字改为“恢复声音”，其他不变。

点击“修改面板”后先列出“声音 · 恢复默认”和“显示 · 恢复默认”。用户选择一个，目标栏显示其分组；再点击“修改面板”才提交一次编辑。鼠标、Tab和Enter均可使用，也可直接在原文中补充分组。显示提示和选择对象都不调用编辑接口、不改需求原文，不替换面板、不消耗成功轮次。

## 范围

仅处理当前modern-v3、支持点选的Spec、EditContext0.14 / explicit-properties-v4中，一个精确按钮改名请求因原名重复而无法定位的情况，可附“其他不变”。复用现有明确文案语法，候选来自当前Spec全部精确同名按钮，不猜第一个。分组标题重复时显示组序号，同组重复时显示行位置；候选选择仍绑定现有稳定row ID。

已点选、精确分组限定及唯一名称继续走原路径。混合要求、多条赋值、未知名称、未闭合引号、示例/改口与不支持的口语不由这个提示推断。它们继续交给原有模型解释或澄清。本提示不代表通用自然语言语义已验证。

这是Studio客户端的提交前帮助，不改变公共方案接受规则。高级工具仍可导出上下文或导入Agent方案；未核对条目仍按原协议处理。没有新增协议字段、上下文版本、Spec/Bundle、编译器或保存格式，旧上下文解释不变。

改变描述或更换面板会清除选项，旧按钮即使被保留在DOM外也不能选择新目标。选择候选不自动提交；修改仍需显式点击，最多10轮及撤销不返还轮次保持。

## 验证 · 2026-10-09

| 项目 | 证据 |
| --- | --- |
| 新增回归 | tests/edit-target-choices.test.mjs，6项；涵盖精确重复、旧策略、选择/限定、未知/错误表达、混合要求、字面名称及位置标签 |
| 对应回归 | output/edit-target-choices-targeted-v1.txt，37/37 PASS |
| 全量回归 | output/edit-target-choices-full-regression-v1.txt，1376/1376 PASS |
| 当前静态构建 | output/edit-target-choices-studio-v1，构建摘要e15a953f00e80eaa5fe889b98a25ddabf1389bc24c064adaace86607bf5a92d0，目录及12个内置素材保持 |
| 页面 | output/edit-target-choices-browser-v1/browser-report.json，23组PASS、12次明确注入的程序编辑替身；模型调用0，错误/外部请求/意外请求0 |
| 页面重点 | 歧义提示和键盘/鼠标选定均无编辑请求；390px容纳；修改描述/更换面板清除旧选项；选定后再点击编辑实际只改/重置显示组；撤销、JSON下载/严格重编译/重导入及轮次保持 |
| 兼容与来源 | output/edit-target-choices-compatibility-v1/audit.json，7份旧0.13及1份真实0.14上下文原样重算通过，3份原真实包严格重编译/字节保持，真实草稿→方案→交付Spec一致 |

实施前缺少本地提示函数导致新测试文件加载FAIL，保留于output/edit-target-choices-before-v1.txt；没有删除失败记录或将其当作模型失败。已查看真实Studio程序验收截图，尚未将本轮判断当成用户美术确认。

最新真实编辑计划的24份冻结输入和原生草稿/方案/回执/交付/验收文件保持。新增功能使该历史计划的三份源码指纹发生变化，历史冻结不再代表当前源码；原授权已消费，不复用旧计划执行真实调用。当前源码未重新调用模型。

本轮未启动、停止或替换4951日常服务，当前代码在下一次正常构建启动时生效；未改其他Harness、接入游戏或推送GitHub。原生Unity和本轮ZIP未复验；前次真实ZIP证据保持。

重现时使用新的输出目录：

```sh
node --test tests/edit-target-choices.test.mjs tests/scoped-button-copy.test.mjs tests/button-copy-checks.test.mjs
node scripts/build-workbench.mjs --catalog examples/modern-menu.catalog.json --assets builtin --output output/my-target-choice-studio
node scripts/check-button-copy-browser.mjs --workbench output/my-target-choice-studio --output output/my-target-choice-browser
```

# 三次真实生成复验、交付和组合验收

状态：**PASS**，范围为本次三份独立真实方案。画质、角色、背包真实生成/业务/编译3/3，
109项浏览器与交付检查通过，三个实际下载ZIP均可离线运行并重新导入Studio。
当前4191服务未切换；原16条同轮结果仍13/16、总体FAIL，原全16组合尚未通过来源门禁。

## 执行绑定

用户明确批准根计划`8cf2578876300bb6a2c6369058a8596109ad8019ae8b69befacdf8bdb2ff6478`，
冻结计划（本地产物：`../output/ordinal-intent-recheck-plan-v6/intent-recheck-plan.json`）和父/子唯一消费记录保留。
宿主执行环境可见CLI登录；系统已有代理只通过当前进程及子进程的临时变量传递，结束后恢复。
未改全局代理、登录状态或CLI配置。模型本身仍为只读、禁工具、禁自动重试的调用配置。

实际3次gpt-6-luna / xhigh，每项一次，Harness自动重试0；没有第四次探测或后处理模型调用。
本轮3份回执用量均已知：输入85990、缓存输入0、输出4090 Token。
[前一批三次连接失败](ordinal-intent-recheck-2026-10-06.md)及其三份未知用量保持，不能把未知用量写成0，也不计入本轮已知合计。
这次请求完成说明所用路线在本轮可用，不证明长期连接稳定或唯一解释前一批所有失败原因。

| 新用例 | 模型/业务/编译 | 校验重点 |
| --- | --- | --- |
| 画质设置 | PASS | 原生Intent 0.7不填写身份，程序分配全局唯一行/分组身份，默认值与重置范围保持 |
| 角色信息 | PASS | 本次输入明确写标题“角色信息”，两列内容、属性和关闭行为保持 |
| 背包筛选 | PASS | 完整保留“仅收藏”、分类与排序选项、默认值和重置范围 |

角色的新输入明确了标题，原含歧义的输入、期望和FAIL没有被修改。
三次均保存原始接受的Intent 0.7、完整Context、公开Proposal、生产回执和Bundle。
独立程序重新materialize原始Intent，逐份深比较生产Proposal与Bundle，没有修补模型返回。
原计划181份源码/协议文件在执行后审计仍匹配，包括相关Component源码；旧动态提示字节保持。

## 浏览器与实际下载

- 三个独立面板的离线Pixi检查（本地产物：`../output/ordinal-intent-recheck-browser-v2/panel-evaluation-browser-report.json`）：30项通过，覆盖可见文字、布局、每行交互/事件、禁用行为、重置、状态导出和文件重开。
- Studio与实际ZIP检查（本地产物：`../output/ordinal-intent-recheck-studio-browser-v1/browser-report.json`）：28项通过。点击生成按钮时只重放本次保存的真实Proposal和原回执，完整Context必须相同；重放3次、额外模型调用0。
- 实际下载的三个交付ZIP校验独立CRC和全部文件SHA，Pixi与Unity导入工具包使用同一源规格；解包后断网打开Pixi，再导入Studio，规格、默认值和试玩值保持。
- 三种新来源组合浏览器检查（本地产物：`../output/ordinal-intent-recheck-composition-browser-v1/panel-evaluation-browser-report.json`）：51项通过，横排、双列、背包双实例均使用本轮来源。每次交互比较完整状态，重置按来源隔离，事件、导出及重开通过。

109项为30+28+51，后处理模型调用0。390×844检查页面横向溢出，不能称移动端视觉重排或触摸易用性已验收。
Unity本轮交付为导入工具包，新的原生导入、运行与人工视觉验收仍NOT_RUN；没有写真实Unity游戏工程。
首轮独立审计误用了浏览器报告文件名，在读取阶段停止；修正审计输入路径后通过，未更改生产报告或重跑模型。

## 产物与后续范围

- 独立完整验收报告（本地产物：`../output/ordinal-intent-recheck-acceptance-v2/acceptance.json`）
- 三个真实面板预览（本地产物：`../output/ordinal-intent-recheck-preview-v2/index.html`）
- 三个新面板的组合预览（本地产物：`../output/ordinal-intent-recheck-composition-v1/index.html`）
- 画质交付ZIP（本地产物：`../output/ordinal-intent-recheck-studio-browser-v1/eval-graphics.panel-delivery.zip`）、角色交付ZIP（本地产物：`../output/ordinal-intent-recheck-studio-browser-v1/eval-character.panel-delivery.zip`）、背包交付ZIP（本地产物：`../output/ordinal-intent-recheck-studio-browser-v1/eval-inventory.panel-delivery.zip`）

可复用[真实方案Studio重放脚本](../scripts/check-ordinal-recheck-browser.mjs)和[三来源组合构建脚本](../scripts/build-ordinal-recheck-composition.mjs)，
均不调用模型，且严格复验真实来源。旧全16组合脚本的16个同轮成功来源门禁保持，未用本轮结果替换旧失败项。
本轮不是重复生成稳定性测试；要证明全16多轮稳定，仍需新的同轮完整样本与独立重复运行验收。
切换Studio版本和下一轮模型测试未在本轮执行。

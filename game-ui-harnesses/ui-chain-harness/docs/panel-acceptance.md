# 面板真实批量验收

`scripts/panel-acceptance.mjs` 将单次真实规划和离线验收分开。普通测试只使用确定性夹具和假 transport；不会启动真实模型。正式 SDK 必须已通过 `panel-sdk:check`，开发源码模式不能运行本批验收。

默认清单为 9 种当前 Studio 预设各横竖两版，加 30 条 custom，共 48 个独立计划。`configs/panel-acceptance-cases.json` 中的文案、字段初值、目标和几何期望先于模型响应冻结，禁止根据输出回填期望来取得通过。

默认分配为 18 条预设和 C01–C10 使用像素皮肤，C11–C20 使用木林皮肤，C21–C30 使用烘焙皮肤。六张样式参考图逐字节冻结，供视觉层次比较；它们不代表已存在六套生成皮肤。旧无材质皮肤用于兼容验收，不能冒称覆盖 S05 材质。

先在本地准备 skin mapping JSON，路径相对于 Harness 根目录：

```json
{
  "pixel": {"packageDirectory":"work/.../skin","contractsDirectory":"work/.../contracts"},
  "woodland": {"packageDirectory":"work/.../skin","contractsDirectory":"work/.../contracts"},
  "bakery": {"packageDirectory":"work/.../skin","contractsDirectory":"work/.../contracts"}
}
```

准备阶段不调用模型，冻结每条 request、expected、aliases、三合同原始字节、完整规划 bundle、实际皮肤 manifest SHA、SDK 身份，及 src/scripts/configs/prompts/schemas/fixtures、package.json、package-lock.json 和 Node 版本共同构成的源码身份。准备前后源码变化会拒绝该批；未完成的准备目录不能作为运行入口。

```text
node scripts/panel-acceptance.mjs prepare --skins <mapping.json> --evidence <仓库外证据目录>
node scripts/panel-acceptance.mjs run --batch <输出目录> --authorize <完整批次SHA256> --concurrency 2
```

只有收到用户对这一批真实调用的明确授权后才能执行 run。参数本身不创造人工授权。run 启动时要求当前源码和 SDK 身份完全等于冻结版本，每条以批次确认绑定自己的计划摘要；提交委托现有 action/settings CLI。每条独占 claim 与 SDK 计划目录均只允许一次提交。外层超时为 1020 秒，长于 SDK 的 900 秒上限。

重复执行 run 只处理尚未保留 claim、也没有 SDK 调用目录的其他独立 case。已有调用、失败、超时、结果不明、claim 后中断都不会自动重投，也不会为凑齐成功数自动改请求、换摘要或调用新计划。所有这些状态应保留并如实统计。run 不启动浏览器检查。

```text
node scripts/panel-acceptance.mjs check --batch <输出目录>
node scripts/panel-acceptance.mjs check --batch <输出目录> --case C20
node scripts/panel-acceptance.mjs replay --batch <输出目录> --case C20
node scripts/panel-acceptance.mjs report --batch <输出目录>
```

check/replay/report 不调用模型。重放先验证冻结 bundle 和皮肤/合同，再验证原始 plan、SDK dispatch、receipt、response.txt、intent.json 的单次身份与摘要。原始五份证据逐字节复制到新的派生目录；原调用目录不会修改。派生记录绑定原 response、receipt、dispatch SHA 和当前修复代码 SHA。转换复用同一语义适配器及严格版本化 presentation，旧产物和旧失败仍保留。

check 从重放结果构建预览，独立检查冻结文案、类型、初值、禁用/只读、提交和重置目标、明确的行列结构、按钮尺寸/对齐及面板尺寸上限。浏览器检查文字完整、组件最小尺寸、安全区、流式重叠、实际 surface 层及材质遮罩，并操作可用输入、开关、滑条、下拉、提交/重置、本地按钮、库存选格与详情。桌面和手机截图、结构结果与失败分类写入仓库外证据目录。未成功转换、需要澄清、浏览器错误或任何断言失败均不能标记通过。

语义名称匹配只放宽有证据的语法后缀：switch 可省略末尾“开关”，slider 可省略末尾“音量”或“滑块”，section 标题可省略末尾“组”。每次只处理一个后缀，剩余基名必须非空且精确一致；不删除前缀、否定词或任意子串。候选必须唯一，重复或冲突名称仍失败。类型、初值、范围、步长和行为目标继续精确检查。某个 expected field 设置 `labelExact: true` 可强制名称逐字匹配；`sectionTitlesExact: true` 可强制分组标题逐字匹配。主标题 `expected.title` 始终逐字匹配。明确要求逐字名称的未来用例应在准备前设置对应 exact 策略。

`textPairs` 检查只读文本的标签和值，允许同一字段直接提供精确标签/值，也允许由唯一的非空 section 标题经 `rowIds` 明确绑定到对应字段。值必须精确，不能用全局正文里分散出现的标签和值拼配，重复归属或错分组也不能通过。`sectionTitles` 必须实际存在于唯一、非空、归属无冲突的 section；正文中提到组名不能替代标题。

`progressValues` 只比较百分比集合，不能证明值属于哪个卡片。需要归属验收时使用 `progressPairs`：例如 `{"label":"森林巡逻","percent":60}`，或 `{"label":"体力","value":30,"max":60,"display":"percent"}`。它采用相同的字段/section 归属约束；前者只要求用户给定的百分比，不额外发明 `max=100`，后者逐项检查明确给定的数值与上限。默认清单的 C21/C22 已根据原需求增加该断言，适用于以后准备的新批次；已冻结批次的 expected 文件不变。旧批次若没有归属断言，须另存人工逐项核验记录或带作者来源 SHA 的补充检查证据，不能回写旧报告，或把集合检查说成已覆盖归属。

画布和桌面截图取自作者初始状态；手机截图取自检查器执行本地交互后的试玩状态。手机中的开关、下拉选项或选中格位变化不代表作者默认值丢失。独立预览会按整张固定逻辑画布缩放，因此没有横向溢出不能当作手机可读性通过；截图的比例保持完整，不通过裁切掩盖留白或小字问题。

report 汇总同一批各 case 最近一次确定性检查，同时保留检查历史目录。它不会把缺失调用、未检查条目或未经人工审阅的视觉候选称为完成美术验收；皮肤和面板仍保持 `visualAcceptance: unreviewed`、`productionReady: false`。几何与绑定断言不能替代截图的材质丰富度、视觉层次和审美复核。

离线回归：

```text
node --test tests/panel-acceptance.test.mjs
node --test tests/browser/panel-acceptance.test.mjs
```

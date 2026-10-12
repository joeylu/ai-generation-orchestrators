# SDK 0.1.0-rc.4

此版本在 rc.3 的单控件分组尺寸修复上增加静态图片槽，并将合格图片卡片的名称和缺图提示与按钮居中。默认目录为 `modern-centered-cards@0.1.0`，主题 0.21.0／0.21.1，PanelSpec/Bundle 0.15、编译器 0.30.0、UGUI adapter 0.1.6。底层 Component 依赖仍固定为 0.2.0-rc.3。

- 八种内容行：Slider、Switch、Select、Button、Text、Progress、Input、Image。分组、组合布局、垂直溢出和 Tabs 沿用既有合同；Component 的 16 类节点不等于 Panel 的 16 种内容行。
- 图片支持占位、固定 PNG、contain／cover／stretch，保留精确素材身份和内嵌资源。没有自动生成人物美术、图片点击选择或任意 URL 加载。
- 新生成提示约束角色卡片的文案层级；编译器保留用户明确指定的文本，不自动删除重复文案。局部编辑、合法试玩状态、绑定、动作、素材及最多十次成功修改的规则不变。
- 旧版本 Bundle 使用自身目录和编译器重放。普通编辑不迁移；旧图片包的标题切换也不顺带采用新卡片排版。rc.3 的 recipe 最小高度、无标题首行 y=0、多组与 Tabs 标题规则保留。
- `package/src/sdk.mjs` 的 `loadPanelSdk()` 入口及返回合同保持；包包含固定 Component 闭包、12 个核心图标、prompts/schemas、配套 ES/IIFE runtime 和 UGUI 源码。安装时解压整个 ZIP，不依赖相邻工作树、npm install、Vite 或 TypeScript loader。

正式入口：[ui-panel-harness-v0.1.0-rc.4](https://github.com/joeylu/ai-generation-orchestrators/releases/tag/ui-panel-harness-v0.1.0-rc.4)。精确 ZIP 字节数、SHA-256、源提交、ES/IIFE 摘要及验收见发布附件 `release-receipt.json`、`runtime-digests.json` 和 `SHA256SUMS`。旧 rc.1／rc.2／rc.3 标签及资产不覆盖。

本次发布验证只使用确定性夹具和明确 CLI 测试替身，真实模型与图片生成调用为 0。上一轮角色生成是独立的一次授权结果，其原始输出和回执保留，不能把本次程序重放当成新模型验收。

发布前完整回归、仓库外安装、六次显式运输替身、Web/UGUI ZIP 逐文件摘要、旧包重放、实际离线 Pixi 和独立 ES 模块均由程序验证；附件记录实际检查数量和结果。浏览器检查包括绑定图片、浅深色占位卡片的实际文字中心及独立选择事件，不代表所有自然语言输入都已覆盖。

本次只提交 Panel 目录，其他链路的工作区改动保留。不修改或部署 Docker/Web 消费项目，不重启日常 Studio。上游浏览器结果不等于消费方 Web 验收；UGUI ZIP 和源码校验不等于 Unity 原生导入通过。Unity 原生导入、消费方部署／Web 验收和用户美术认可仍为 NOT_RUN。

发布源码以仓库已通过 CI 的 `09d4299e7f7d9fc1d120de1a3ffb9ee924d2663b` 为基线，只附加 Panel 目录的提交；rc.3 仍作为旧包兼容与 runtime 摘要对照版本。

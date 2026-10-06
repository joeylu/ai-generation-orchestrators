# 第一版使用入口

先打开本工作区的[统一交付目录](../output/ui-panel-closeout-v1/index.html)，可以离线查看16类真实面板、5种同轮组合、连续修改10步，并下载当时实际取得的ZIP。
源代码和使用说明由Git保存；`output/`中的本地产物不随克隆产生。

## 已运行的Studio

本工作区当前地址是`http://127.0.0.1:4198/`，使用`output/panel-studio-visual-v3`构建。
新版Modern Mint主题说明及前后对照见[视觉主题](panel-visual-style.md)。旧4197服务和第一版交付记录保留。
现有服务保留。另开工作区或重启时按下面的命令构建，使用程序打印的地址。

1. 填写需求描述，点击「生成面板」。初值、范围和操作含义要明确；缺少业务信息时逐项回答，再点击生成。
2. 在右侧试玩。面板尚未连接真实游戏，事件通过显式宿主接口接线。
3. 填写修改要求，点击「修改面板」。存活字段的试玩值保留；新默认值通过面板的恢复默认操作生效。
4. 「面板操作」提供撤销、打开面板、下载交付包和共享SDK。关闭或刷新前下载PanelBundle，重开后可继续修改。

首次可粘贴：

> 生成声音设置面板：主音量范围0到100，步长1，默认70；静音开关默认关闭，开启表示静音；增加恢复默认按钮，恢复这两项初值。

随后修改：

> 在主音量之后、静音之前新增音效音量滑条，范围0到100，步长1，默认40，只通知宿主。恢复默认按钮同时重置主音量、音效音量和静音。其他保持不变。

点击一次生成或修改会提交一次真实CLI请求。失败不自动重试，用户重新点击属于新请求；批量验收另须绑定冻结计划授权。

## 从源码重新构建

需要Node >=22.18，保留同仓库`ui-component-harness`源码。
Vite/Pixi/Playwright等依赖由该相邻Harness的锁定依赖提供；如果尚未安装，在相邻目录执行`npm ci`。
这两个Harness是开发依赖关系，不把组件源码复制到本项目。

以下命令从`ui-panel-harness`目录运行：

```sh
node --test tests/*.test.mjs
node scripts/build-workbench.mjs --catalog examples/modern-mint-polished.catalog.json --output output/my-studio
node scripts/serve-workbench.mjs --workbench output/my-studio --output-root output/my-codex-runs --port 0
```

目录已存在时换一个新名字，程序不会覆盖。`--port 0`选择空闲端口，启动不会调用模型或改动其他服务。
`index.html`和`workbench.js`应一起移动；构建清单记录二者摘要，本地服务启动时重新校验。

上述最小构建使用程序控件，不需要本地纹理归档。
需要自有图标和背景池时，在同一构建命令添加`--assets <已验证资源库目录>`；必要时添加`--sharp-module <已安装的模块目录>`。
本工作区现有库为`output/generic-library-migrated-v1`，264条记录/221份去重PNG；新增资源见[增量入库](asset-import.md)。
完整库的原始路径和机器模块位置不用写进面板文件，选中PNG随PanelBundle内嵌。

本地生成需要已安装并登录Codex CLI；若PATH无法发现，可对启动命令加`--codex <本机exe绝对路径>`。
需要代理时由启动进程继承用户自己的网络设置，本项目不会自动更改全局设置。详情见[Codex接入](codex-planner.md)。

## 下载后使用

完整交付ZIP中的`pixi/index.html`离线试玩，`pixi/panel.bundle.json`可回到Studio重新打开。
游戏通过导出的字段/事件合同显式接线，见[Web业务绑定](game-binding.md)；不根据按钮名称猜测业务调用。
Unity导入工具统一位于`Assets/PanelHarness/`：共享Runtime和接入SDK安装一次，每个面板有独立子目录。
原生控件使用UGUI，适配脚本负责状态/事件和有限外观，导入及升级预检见[Unity导出](unity-export.md)。

普通下载不代表已经在目标Unity项目运行。本轮31份整理交付均保留原清单的原生`NOT_RUN`；先前隔离验证见[历史记录](tasks.md)。
本版已完成的固定范围及保留边界见[收尾说明](first-version-closeout-2026-10-07.md)。

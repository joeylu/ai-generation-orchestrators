# Panel SDK 锁定依赖

默认运行模式为 `locked`，使用官方发布 `ui-panel-harness-v0.1.0-rc.8`，源码 commit `514bc98c9bcf699e094e7d9b4bfb0ab9474c79ff`。唯一维护源是 [panel-sdk-lock.json](../configs/panel-sdk-lock.json)。锁定 ZIP 为 5,004,044 字节，SHA-256 为 `94163e227a3f924f84fe41adbea9470e151bcafc4069a7d1a1051f7a77fb49b6`。

在本 Harness 目录执行：

```powershell
# 用户授权安装后，从官方 GitHub release 下载完整归档与校验文件。
# 需要可用的 GitHub CLI；私有仓库访问沿用本机已有 gh 授权。
npm run panel-sdk:install

# 只校验本地安装，不下载、不调用模型。
npm run panel-sdk:check
```

也可先下载官方 ZIP、`release-receipt.json` 和 `SHA256SUMS`，再显式安装已有文件：

```powershell
node scripts/panel-sdk.mjs install --archive <官方ZIP> --receipt <release-receipt.json> --checksums <SHA256SUMS>
node scripts/panel-sdk.mjs verify
```

安装只写入被忽略的 `work/dependencies/panel-sdk/<archive-sha256>/`。该目录保留官方归档、发布回执、发布校验表与完整 `package/`，另有程序生成的 `installation.json`；不运行安装脚本、不写系统 PATH、不调用模型。已有有效安装可重复核验复用，损坏安装不会被静默覆盖。

安装前验证归档字节数和 SHA-256、官方校验表及回执、干净源码 commit、内部 `release-manifest.json` 的身份、每项文件字节数和摘要，以及包内 `SHA256SUMS` 的完整覆盖。ZIP 只接受有界 STORE 格式的普通文件，拒绝路径越界、重复或大小写冲突、符号链接和不一致索引。运行时首次加载公开 API 前复核完整安装，目录 JSON 每次读取都核对发布原字节。

`src/panel/sdk.mjs` 统一提供 `loadPanelSdkApi()`、`readPanelSdkJson()` 与依赖身份。正式默认不会读取邻接 Harness 源码。设置、通用预设和自定义继续显式使用 `modern-all-components` 的 context 0.11 / intent 0.12；仓库独立使用 `modern-readable-game-grid-layout` 的 0.12 / 0.13，不把 SDK 默认 seed 目录替换到所有入口。Chain 的 PixiUI/Layout 渲染和皮肤绑定继续由原运行时负责。

## 显式开发模式

仅调试上游工作区时，显式设置：

```powershell
$env:UI_CHAIN_PANEL_SDK_MODE = 'development'
```

该模式允许从相邻 `ui-panel-harness/` 加载，身份明确标记为 development，不能作为已锁定发布安装的验收证据。删除该环境变量或设为 `locked` 后，重新启动 Studio/测试进程才能切回正式依赖。未知模式直接拒绝，缺失正式安装不会自动启用开发模式。

升级依赖应更新锁文件、核验新官方资产并运行协议、语义和真实皮肤回归；保留旧包、旧计划、原始响应、交付和编辑快照。版本化旧消费者配置使用对应旧提示词核验，不把旧计划内容替换成新默认值。

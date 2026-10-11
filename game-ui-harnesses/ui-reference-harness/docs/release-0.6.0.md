# UI Reference Harness 0.6.0

源码预览标签：`ui-reference-harness-v0.6.0`。本次发布包含面板原型到统一风格参考图的本地链路，以及可选的 loopback Studio；不是 npm 包或线上站点发布。

## 本版内容

- 六种默认 UI 风格、自定义参考 PNG／风格描述、项目统一风格修订与可选的已接受项目锚点。
- 自定义风格不继承之前选择的默认风格；没有高级基础风格或 JSON 包上传入口。CLI／核心的数据风格包合同保留。
- 原型导入后一次点击生成；可选面板补充、逐面板持久化 session、最多三轮修改、生成阶段与耗时提示。
- 一次生成决定绑定冻结计划，只派发一次；失败、未知结果和刷新不会自动重投。技术 QA 与人工布局／风格／文案验收保持独立。
- 示例按 SDK 对应 UI 整理为五类、八个状态；加载、暂停和结算的不同状态名称可区分。设置示例仅保留一个面板标题，关闭按钮在底部居中，不含关闭分组标题。
- 本地项目回收与恢复、按面板名导出 PNG ZIP，以及可验证的来源交付包。Studio 采用黑白蓝配色。
- 上游 `ui-panel-harness` 的必要新增支持为 `fixed-reference-1` 只读坐标原型及完整重放校验；没有单独升级或发布 Panel SDK。

提交不包含其他链路的未提交改动。发布源码只携带参考图 Harness 和它调用的公开面板／组件源码、目录与测试夹具；不携带 UI Layer 运行时、用户项目、参考图片、生成结果、会话、授权或本机提供商配置。

## 下载和启动

下载发布附件中的源码 ZIP、Studio ZIP、`release-manifest.json` 和 `SHA256SUMS`。先按 `SHA256SUMS` 校验附件字节，再将两个 ZIP 解压到同一目录，合并同名的 `ui-reference-harness-v0.6.0/` 根目录。保留其中三个兄弟 Harness 的目录关系。

使用 Node.js >= 22.18.0，推荐 Node.js 24。在解压出的根目录运行：

```powershell
node game-ui-harnesses/ui-reference-harness/ui-reference.mjs doctor
node game-ui-harnesses/ui-reference-harness/ui-reference.mjs self-test
node game-ui-harnesses/ui-reference-harness/web/server.mjs
```

打开 `http://127.0.0.1:4186/`。静态附件已经编译好，启动无需安装 npm 依赖；核心和本地 host 直接使用公开源码。运行数据默认写入解压目录下的 `work/ui-reference-studio/data`，也可以通过 `--workspace` 指定新目录。

仅使用源码附件时，先构建 Studio：

```powershell
npm --prefix game-ui-harnesses/ui-reference-harness/web ci --ignore-scripts --no-audit --no-fund
npm --prefix game-ui-harnesses/ui-reference-harness/web run build
```

默认六种风格提供规则，没有随源码附带真实样本图片。可显式传入经过校验的外部 `--sample-catalog`；没有提供商适配器时保留手动生成交换。可选的 Codex CLI 适配器及本机设置见 [Studio 说明](../web/README.md)，其模型和运行配置不进入核心计划合同。

## 固定版本与已有工作区

生产消费者固定本标签及附件 SHA-256，不从浮动分支复制代码。以源码附件中的原始字节作为运行时身份，避免编辑器或 Git 行尾转换改变源码指纹。`release-manifest.json` 记录发布源码的运行时摘要。

本版不执行旧工作区自动迁移、图片重生成或历史记录改写。旧作业继续使用原来固定的运行时；已知旧源码指纹仅按核心合同支持只读检查、人工复核及交付，不允许重新派发旧计划。不要将来源未知或本机开发版的 session 直接搬到新运行时。已有项目导入的旧示例也不自动替换；需要新版设置结构时重新导入设置示例。

## 验证范围

本版发布前使用程序夹具与模型替身：参考图核心 65 项、Studio 58 项、上游面板 1462 项全部通过，Studio 格式检查和生产构建通过。源码附件另进行解压后验证；实际检查结果与附件摘要见 `release-manifest.json`。

此前六种默认样本及概念图风格同项目三面板已按参考图用途验收。发布过程不调用生图／视频工具，也不将离线测试视为新的真实视觉验收。仍不承诺像素级布局、字体或跨面板控件完全一致；所有新成图需用户验收。

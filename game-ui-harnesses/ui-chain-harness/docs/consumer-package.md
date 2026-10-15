# 独立组件消费包（候选）

目的：复用已验证的真实皮肤和全部 16 类组件，让浏览器消费不依赖本仓库源码、work 目录、node_modules 或 CDN。当前只完成离线候选交付，尚无不可变标签发布或生产项目接入验收。

## 维护与构建

日常统一入口（在本 Harness 目录执行）：

```text
npm run consumer -- build --package <皮肤包目录>
npm run consumer -- check
npm run consumer -- status
npm run consumer -- preview
```

已有消费包可用 `npm run consumer -- select --directory <work内消费包目录>` 选中；预览端口可用 `--port 4190` 覆盖。默认端口 4189，只监听 127.0.0.1；按 Ctrl+C 停止前台预览。无需每次填写生成目录。

输出根目录、当前选择文件、证据目录和默认端口只维护 `configs/consumer-workflow.json`。当前选择及通过的检查摘要由程序写入 `work/consumer-workflow/current.json`，不要手改。build/select 只选择完整包，不标记检查通过；check 成功后才归档证据并绑定该包摘要。status/preview 重新验证文件完整性，文件或清单变化会拒绝，检查记录损坏也会报错。重新选择会清除当前指针的检查状态，历史证据保留。

preview 使用启动时已验证的包快照，运行中替换目录不会热加载；重新构建后需重启预览。只提供清单文件、正确模块 MIME 与本机访问，未检查包也可预览，但会明确显示“尚未执行”。这些状态不等于正式发布或美术接受。

资产和组件仍维护原有 skin-pack、注册表、usage、template 源 JSON。生成的 kit.json 不是第二套维护源；不能在消费项目复制源码继续修改。

```text
node scripts/consumer-pack.mjs --package <验证过的皮肤包> --out work/consumer-pack
node scripts/consumer-check.mjs <上一步输出目录>
```

构建使用已安装的锁定依赖，不下载依赖，不调用模型。输出到新目录，文件摘要写入 manifest.json；失败目录不得作为成功交付。

| 文件 | 用途 |
| --- | --- |
| runtime.mjs | 自包含 ESM 运行时；导出 Pixi 类型、createComponentKit、createRuntime 和 loadPngSkin |
| kit.json | 冻结的组件配置及已验证资源数据，供便捷加载 |
| skin/ | 独立 PNG、字体、原始清单及其来源资源，保留原皮肤包验证能力 |
| example.mjs | 最小宿主接入示例，创建一个按钮并说明销毁方式 |
| index.html / gallery.mjs / examples.json | 本地验收示例，使用随包 runtime.mjs；不是另一份组件实现 |
| manifest.json / source.json | 包文件摘要、运行时源码身份及依赖锁摘要 |
| dependencies.json / licenses/ / LICENSE | 实际打包依赖版本、第三方及项目许可说明 |

从本机静态服务打开 index.html（需支持 .mjs 的 JavaScript MIME）。不要双击 file://；资源校验需要浏览器安全上下文。宿主应从该 runtime.mjs 导入 Application 等 Pixi 类型，当前候选内置 Pixi，尚未验证与宿主另一份 Pixi 实例混用。

createComponentKit 接收宿主 app、kit 数据和 onEvent，返回 runtime、skin、dispose。宿主负责 Application 初始化/销毁及游戏行为；组件包负责组件和皮肤资源释放。上游规划器、模型入口、面板布局及画布编辑不属于这个包。

## 验收与限制

checker 先核对每个文件摘要，再复制到系统临时目录，重新验证分离皮肤包。浏览器只允许访问该复制目录内 manifest 列出的文件；复用 62 项组件交互/状态/尺寸检查，检查 16 类覆盖、横竖截图及独立工厂加载与销毁。测试驱动仍运行于仓库，但浏览器运行代码和资源来自移出的包。

当前最终候选：`work/consumer-pack/8ae60e39-0dc8-40b8-a92e-c928843ac893/`。

证据归档：`work/consumer-evidence/d1A6UF/`，保留程序生成的 checks.json 和两张截图；62 项通过，工厂 smoke test 通过，包外网络请求为 0。

统一入口新增验收证据：`work/consumer-evidence/3bd3a5cb-0510-40aa-9e13-08e38442b10e/`；62 项通过。2 项入口回归覆盖文件变更、清单摘要、重复/越界路径、服务快照和 Host/方法/路径限制。实际 4189 页面加载及横竖切换验证通过，16 类组件，无浏览器脚本错误。

候选保留资源数据和独立资产两种形态，存在体积重复；压缩、按需加载、外置 Pixi、通用发布验证命令及不可变版本发布仍待后续。manifest 是完整性清单，不是签名；正式生产安装仍须按仓库合同使用不可变发布摘要。美术接受和 productionReady 状态没有因技术验证而改成成功。

新组件包额外携带 text-readability.json；正式角色字色固定在 skin/skin-pack.json 的 theme.textColors 中。消费检查新增状态切换字色与宿主文字隔离验证。规则、旧包升级及采样限制见 [文字可读性](text-readability.md)。

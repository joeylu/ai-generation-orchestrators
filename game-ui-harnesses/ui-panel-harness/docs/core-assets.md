# 常用自有素材集

Studio 默认使用随源码提供的 `assets/core-v1/`：12 个图标、语义索引、源 SVG、最终 PNG、预览和原始交付清单。
播放/继续、暂停、设置、返回、主菜单、音量、音乐、静音、角色、确认、取消和恢复默认的键为
`panel-core/<name>@1.0.0`，风格为 `modern-core`。保留已有像素与摘要，只补充中文语义标签。
使用现有 `lexical-v1` 检索，不引入向量数据库，也不改变已保存规划的排序协议。

## 默认使用

```sh
npm run studio
```

无需指定图库，也不需要 Sharp。启动先核对代码固定的交付清单摘要，再逐份验证索引、源图、PNG 和预览的字节摘要；
最后通过现有资源池协议核对完整索引和图片。缺失或改动均拒绝启动，不静默降级。
构建证据 `sourceReplay: PINNED_BUNDLED_ASSETS` 表示加载已完成源图重放验证的固定版本；
本次启动没有重新渲染 SVG 或分析 alpha，不能声称 `VERIFIED_AT_BUILD`。
服务器仅对固定库摘要与资源池摘要接受此证据，其他库不能借用。

独立静态构建需显式选择：

```sh
node scripts/build-workbench.mjs --catalog examples/modern-navigation.catalog.json --assets builtin --output output/my-studio
npm run studio -- --assets none
```

`builtin` 和 `none` 是保留模式，均不接受 `--sharp-module`。
未带 `--assets` 的独立构建仍是程序化界面；日常 Studio 的默认值为 `builtin`。
图标是可选行装饰，不改变字段绑定、动作、按钮文字、主题或布局。
底板与控件保留主题绘制，不强行用图标替换背景。
显式横排/圆形动作布局仍遵守现有协议限制。

## 替换与补充

外部库仍需完整验证源图重放、PNG alpha、预览及交付清单：

```sh
npm run studio -- --assets <verified-library> --sharp-module <installed-module>
node scripts/assets.mjs import --manifest <assets.json> --base assets/core-v1 --output output/my-extended-assets --sharp-module <installed-module>
npm run studio -- --assets output/my-extended-assets --sharp-module <installed-module>
```

Sharp 必须与库声明的渲染器一致；省略模块参数时使用本地 `sharp`，不自动安装或下载。
补充资源生成新库，不覆盖内置版本。同键同版本内容必须一致；改图使用新版本，新增语义使用新键。
既有面板继续固定引用旧键和 PNG，选中图片随 PanelBundle 内嵌，离线打开和重导入无需原图库。
外部库参数替换本次启动的完整池；若需保留核心图标，先用 `--base` 扩充，详见[增量入库](asset-import.md)。

从完整自有库重新筛选核心集的开发工具仍可使用：

```sh
node scripts/prepare-studio-assets.mjs --source <verified-library> --output output/my-core-assets --sharp-module <installed-module>
```

工具完整验证源库，按 `src/core-asset-profile.mjs` 的固定键选择并发布新库。
旁边的 `<output>.selection.json` 记录源库、源键、目标键和源文件/PNG 摘要。
内置版本升级需要完整重放、资源池与浏览器验收，并更新代码固定摘要；不得直接修改旧交付清单掩盖差异。

## 验收

```sh
node --test tests/bundled-core-assets.test.mjs tests/core-asset-profile.test.mjs
node scripts/assets.mjs verify --library assets/core-v1 --sharp-module <installed-module>
node scripts/check-core-assets-browser.mjs --assets assets/core-v1 --output output/my-core-review --sharp-module <installed-module>
node scripts/check-studio-start-browser.mjs --output output/my-studio-start-review
```

浏览器夹具检查声音设置、角色命名和暂停菜单的浅/深色程序样例、自然语言候选命中、实际图片挂载、
交互、窄屏、真实下载 ZIP 校验、无图库重导入和离线打开。这些检查不调用模型。
本地证据保存在忽略的 `output/`，不随源码提交。

本轮真实调用另有记录：`core-assets-resume-run-v1` 的角色命名、暂停菜单与声音设置修改共 3 次通过，
结合此前通过的声音生成，形成 `core-assets-real-accepted-v3` 四个页面。
真实下载包、离线打开和无图库重导入已检查；原批次失败记录保留，未自动重试。
这说明上述具体样本通过，不能推断任意输入均稳定。Unity 适配包已生成，原生编辑器验收为 `NOT_RUN`。

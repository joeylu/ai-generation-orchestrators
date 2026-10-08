# 常用自有素材集

完整图库保留几何变体、效果和其他用途资源。Studio 可以另外加载一个经过明确筛选的小型素材集，
减少同一语义的填充/描边变体竞争，补充玩家常说的“继续游戏”“恢复默认”“角色命名”等标签。
现阶段仍使用已有 `lexical-v1` 检索，不引入向量数据库，也不改变已保存规划的排序协议。

## 准备与使用

```sh
node scripts/prepare-studio-assets.mjs --source <verified-library> --output output/my-core-assets --sharp-module <sharp-module>
npm run studio -- --assets output/my-core-assets --sharp-module <sharp-module>
```

Sharp 模块需要与源库声明的渲染器版本一致；可使用本地已安装模块，不自动安装或下载。
省略 `--sharp-module` 时使用本地 `sharp`。启动和准备均不调用模型。
`npm run studio` 不带资源参数时仍使用程序化界面；资源参数仅对本次启动生效。

准备工具先完整验证源库，再按 `src/core-asset-profile.mjs` 中的固定来源键选择 12 个图标：
播放/继续、暂停、设置、返回、主菜单、音量、音乐、静音、角色、确认、取消和恢复默认。
目标键采用 `panel-core/<name>@1.0.0`，风格为 `modern-core`。
保留源 SVG/PNG 和最终 PNG 的字节摘要，只调整语义元数据，不修改像素。
工具使用标准入库程序发布新的独立库，不覆盖完整库，不编辑已有交付清单。
旁边的 `<output>.selection.json` 记录源库摘要、源键、目标键和源文件/PNG 摘要。

这个版本不把描边、径向线条、超大九宫格或白色填充图强行用作面板背景。
底板与控件保留已有主题绘制，明确的颜色、圆角和按钮层级继续生效。
图标是可选的行装饰，不改变字段绑定、动作或按钮文字。
显式横排/圆形动作布局仍遵守现有协议限制，不能为不支持的排列附加外部行图标。

## 验收

```sh
node --test tests/core-asset-profile.test.mjs
node scripts/check-core-assets-browser.mjs --assets output/my-core-assets --output output/my-core-review --sharp-module <sharp-module>
```

浏览器脚本创建声音设置、角色命名和暂停菜单的浅/深色程序样例，并比较资源接入前后。
画布、布局声明、业务内容、默认值、绑定、动作和主题相同；两侧均可交互。
验证自然语言候选命中、图片实际挂载、滑条/开关/重置、输入提交、菜单点击、窄屏、
真实下载 ZIP 的校验和、无图库重导入，以及下载 ZIP 解包后的离线打开。
同时导出 Unity 适配包；Unity 编辑器验收单独标为 `NOT_RUN`。
这些检查不声称完成真实模型生成验收，也不消耗模型调用。

本地验收产物位于忽略的 `output/`，不会随源码提交。当前检查记录：
`core-assets-review-v6`：48 项浏览器/交付检查通过；单元回归 1139 项通过。
`core-assets-studio-live-v1`：固定地址 Studio 的完整池加载、三类口语需求准备上下文、
带图面板重导入和窄屏 6 项检查通过。生成与修改端点在检查中被拦截，模型请求为 0。
真实模型是否按这些候选选择素材，仍需单独授权后验证，不能以本轮夹具结果代替。

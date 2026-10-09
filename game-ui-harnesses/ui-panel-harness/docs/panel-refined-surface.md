# 面板视觉收敛 · refined-v1

此页记录前一版0.18。用户仍认为视觉不满意，当前日常主题已更新为[简约面板美术 minimal-v1](panel-minimal-art.md)；下面的验收计数与默认说明属于当时的构建。

本轮优化生成出来的面板。参考早期 Modern Mint 重绘的深蓝底、薄荷色强调、细边框和留白，重新统一程序控件的视觉层次；没有引入原 MUIP 运行时依赖或复制另一套 Harness。

`examples/modern-refined.catalog.json` 是新的日常 Studio 默认目录。八个主题的 ID 保持原色系名称，版本升级为 `0.8.0`，新增 `surfaceStyle: "refined-v1"`，固定编译器 `0.18.0`。PanelSpec、业务动作、绑定和资源协议不变。

- 面板使用统一的中性浅色或深蓝底色，保留四种强调色；标题、分组文字、内容和操作区形成层级。
- 删除与面板名重复的首个分组标题；保留不同的分组标题与页签内的分组。
- 设置行不再铺成一条条独立色块；输入框、次要按钮仍有自己的底色和细边框。主按钮继续使用强调色，危险操作保留显式危险角色。
- 面板增加有限、较浅的底部阴影及标题短线。阴影完全容纳于画布才输出；已有面板底图或明确指定背景色时不叠加阴影。
- 白色图标原图不改色，默认徽章底色按对比度收敛；图标选择仍由方案决定，建议不会自动改写面板。
- 明确指定的颜色、圆角、按钮样式、尺寸、标题底板与操作布局继续优先。

## 兼容与更新

`modern-navigation@0.7.0 / compiler 0.17.0` 及更早的已保存面板仍按原版本回放，不自动换主题或替换素材。新主题编译器不会接受旧主题伪装成新版本。

新日常服务允许使用**完整内容精确匹配**的上一份 `modern-navigation` 目录编辑旧面板。修改上下文继续绑定旧 Spec、旧主题与旧目录；生成只接受当前构建目录。改过一个 token、仅名称相同的目录、其他目录，以及自定义的新目录都不会取得这条兼容权限。图库匹配、选中范围、单次调用与整批校验保持原规则。

现有 4951 进程继续保留，本次检查 HTTP 200。它不会因源码更新自动切换构建。下一次按日常流程停止并运行 `npm run studio` 后，新生成默认采用新目录；同地址本机存档继续保留。已准备的含12图标静态构建为 `output/refined-studio-v2/`，构建摘要 `32d88c6271c3aab9c7bc2ac26b79253437974c35939755b40607448240fbe597`。

## 本地验证 · 2026-10-09

```sh
node --test tests/*.test.mjs
node scripts/check-asset-usage-browser.mjs --output output/my-refined-review --catalog examples/modern-refined.catalog.json --baseline-catalog examples/modern-navigation.catalog.json
node scripts/build-workbench.mjs --catalog examples/modern-refined.catalog.json --assets builtin --output output/my-refined-studio
node scripts/check-selection-workbench-browser.mjs --workbench output/my-refined-studio --output output/my-refined-selection
```

| 检查 | 结果与本机证据 |
| --- | --- |
| 全量回归 | 1209/1209，`output/refined-regression-v2.log` |
| 八主题 × 六种用途 | 新旧业务、资源和布局声明一致；新版本重编译、正文及按钮对比度、显式覆盖和UGUI导出数据通过，`tests/refined-surface.test.mjs` |
| 六类面板浅深色浏览器 | 84项通过，实际Pixi操作、390宽度、12份实际下载ZIP摘要、离线打开及无图库重导入，`output/refined-surface-browser-v2/asset-usage-browser-report.json` |
| 新构建编辑旧目录面板 | 17项通过，注入2次夹具编辑（失败一次后显式再次点击），模型0次；`output/refined-selection-browser-v2/selection-browser-report.json` |
| 输入覆盖 | 新24场景及独立期望、反例检查通过；仅夹具，见[输入覆盖说明](input-coverage-v2.md) |

本机可交互前后对照：[六类面板](../output/refined-surface-browser-v2/index.html)。左侧为原主题，右侧为新主题；素材和业务语义相同，两侧可试玩，右侧可下载交付包。本页为程序化夹具，不能描述为新的真实模型生成结果。

保留的中间记录：视觉v1的84项通过后继续收敛浅色阴影和深色输入底色，v2为最终样式；点选浏览器v1的FAIL暴露新旧目录编辑阻断，修复后v2通过；全量回归v1的唯一失败为新增测试误把原夹具默认80写成70，修正测试后v2全部通过。没有改写历史报告。

本轮新增真实模型调用0次，浏览器外部请求与页面错误0。UGUI结构和打包通过，Unity编辑器原生验收与游戏接入均为NOT_RUN。未嵌入字体，跨设备字形不保证一致；浅色输入占位文字仍由共享组件固定，未作全控件可访问性认证。截图已供本地视觉检查，最终美术偏好仍待用户审阅。

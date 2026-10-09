# 暂停与退出排版对比

用户对声音设置对齐版反馈“好多了”，并询问下一步。本轮将内容边界、间距和操作主次延伸到暂停菜单与退出确认，保持小范围的程序样本对比。

入口：`output/compact-actions-review-v3/review/index.html?panel=pause-dark`。两类各有浅深色，共四份历史候选；左右可独立试玩、下载，并可进入同模式的声音设置参考。生成时报告的用户美术状态为 `NOT_RUN`，默认未切换。

**后续结论：不采用本组为设计基线。** 用户反馈“感觉不如上一版”。暂停/退出的参考版本恢复到本组的before来源，声音设置保留对齐版；具体来源见[当前排版参考](visual-baseline.md)。已通过的技术检查证明功能与交付可用，不代表美术效果改善；原报告和未采用样本保留。

## 调整

| 面板 | 调整 |
| --- | --- |
| 暂停 | 标题左对齐；按钮区取消额外居中缩进，沿内容左右边界铺开。继续为蓝色主按钮，设置为中性次按钮，返回主菜单改为灰色文字。按钮高48→44px，列布局间隔12→8px，外板高298→296px。 |
| 退出 | 去掉“离开之前”小标题；将原说明第一句作为Text行标签，第二句作为正文，原两句说明逐字保持。取消76px、退出112px，右下角并排，间隔12px，按钮高44px。外板高269→244px，保留完整底板、细边及原有投影。 |

两类标题24→22px，标题槽32px，面板宽428px、内边距28px、外板圆角20px保持。复用现有0.24.0与0.18.0编译器、PanelSpec布局参数、Pixi渲染和交付链，没有更改生产源码、编译器、默认主题或其他Harness。

同类前后对照的字体族、主题及配色保持：暂停来源为整套精修版，保留Segoe UI / Microsoft YaHei UI；退出来源为字体试稿的Noto版，保留Segoe UI / Noto Sans SC。此轮未宣称完成跨类型字体统一。仅按钮边线/尺寸、返回文字颜色、标题位置和内容结构调整；事件、动作、顺序、状态、绑定、素材、画布和按钮字号保持。

参考本机ui-ux-pro-max中可验证的触控间隔、视觉层级与留白分组规则；定向查询命中的触控间隔适用，未使用无关的面包屑建议。没有安装新Skill或字体，没有模型、图像或媒体调用。

## 验证

- `output/compact-actions-targeted-v3.txt`：44项对应回归通过，含新增16项。覆盖来源对象不变、原编译器/主题保持、原两句说明保持、标题与操作区几何、44px按钮、完整底板、UGUI字段/控件业务保持及非法来源拒绝。
- `review/review-report.json`：20组浏览器检查通过，覆盖浅深色、桌面与390px、无文字截断、全部按钮事件、左右独立状态与严格实时导出。
- 四份实际下载ZIP完成CRC及逐文件摘要检查、无图库Studio导入/导出和离线打开。
- `review/compact-actions-report.json`：14组检查通过，核对标题/内容/操作边界、整数外板高度、原两句说明完整可见、类型/模式导航和四份离线包的实际几何。浏览器错误及外部HTTP请求均为0。
- 四份来源包严格重放且源文件SHA保持。`study-report.json` 绑定来源与执行源码摘要。浅深色桌面截图已查看，尚未将程序检查当作用户审美验收。

v1尝试空Text行标签，被现有协议拒绝，停止并保留日志，没有放宽协议。v2改为第一句作标签、第二句作正文，实际自然高度249px与预估248px不符，局部测试及浏览器报告FAIL保留。v3使用现有60px行槽与12px间距，使退出外板收为244px；更新几何断言后通过，没有裁字或修改旧结果。

字体未内嵌，高DPI仍为既有1倍画布限制；390px为等比缩放。Unity编辑器、游戏接入为 `NOT_RUN`，不能宣称原生导入或真实自然语言生成通过。此前真实计算授权不复用，后续若要真实验证生成/编辑，仍须先冻结具体计划并获得新的授权。

```sh
node --test tests/compact-actions.test.mjs tests/apple-typography.test.mjs tests/apple-suite-polish.test.mjs tests/apple-dialog-polish.test.mjs
node scripts/build-compact-actions.mjs --suite output/apple-suite-polish-v2/review --typography output/apple-typography-review-v2/review --output output/compact-actions-review-new
```

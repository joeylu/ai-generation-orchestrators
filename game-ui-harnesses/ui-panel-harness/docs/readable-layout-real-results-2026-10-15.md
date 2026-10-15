# 混合设置排版4条真实复测

用户批准冻结计划 `output/readable-layout-real-plan-v1`，SHA-256 `c5e5d861834a9aa6ef66a65ab86c636d2b309ae2b0e1dbb004f26de575619c18`。本批4次gpt-6-luna／xhigh，串行各一次、自动重试0，4份原始交付通过全部检查。该授权已消费，不得重新执行原计划。

| 原短口令 | 原始交付与观察 |
| --- | --- |
| 做个背包面板 | List与两按钮，宽420；没有额外分组标题 |
| 帮我做个设置面板 | 两Slider、两Switch、Select及两按钮，宽420；保留“音频／画面”，隐藏操作标题，首屏操作完整可见 |
| 做个角色选择面板 | 中性图片占位、Select及确认按钮，宽420；选择状态和事件通过，占位未假称真实角色美术 |
| 做个退出游戏确认框 | 完整正文和两个普通Button，宽420；短正文及操作组居中，两个选择分别从初始状态实测可点击 |

用户口令没有追加组件、主题、尺寸或排版清单；使用完整16主题、12自有图标和日常共享生产提示，不注入外部skill。4份实际输出均采用 `modern-readable-game-layout`／主题0.26.0、`game-readable-v2`、Compiler 0.39.0，正文／按钮24、主标题32、逻辑画布宽452。

本次设置自然拆成音频、画面和操作三组，与[上批失败的同组混合设置](content-heading-real-results-2026-10-15.md)结构不同。因此本批证明这4条新样本实际交付通过，不声称重现了相同模型答案；此前原失败意图的离线重放与15项混合布局回归仍单独保留。上批3／4和CONTROL_WIDTH原FAIL未改写。

## 实际验收

| 验收 | 结果 |
| --- | --- |
| 原始交付常规浏览器 | 4份／34项PASS，实际ZIP下载、初始状态、居中主标题、控件、宿主状态和离线重开 |
| 原生分组标题 | 1100、390、375像素，共12屏PASS |
| 实际字号 | 12屏PASS；390像素最小约17.26px，375像素最小约16.46px，无横向溢出 |
| 首屏与实际操作 | 12组PASS；按钮未裁切，Slider及Select改变状态，背包操作和退出两选择发出正确事件 |
| 完整性 | PASS；491份冻结来源、唯一授权消费、4份原生调用收据、发送提示与实际ZIP摘要匹配 |
| 结果对照页 | 桌面1600及390窄屏、图片解码、详情展开及原始设置试玩链接PASS |

Browser plugin not available，使用本机Playwright／Edge。原始交付和结果页无相关浏览器错误或警告；Agent查看设置、角色和退出的390像素原生截图。没有人工改主题、补排版、改内容、补造收据或覆盖旧失败。用户美术确认尚未记录。

已有未发布SDK候选保持4,544,601字节，SHA-256 `353af861420d6494c2c2961e5e480fc8f85934d8964ba36a307f457c16d60888`。另核对224份冻结Panel来源与候选归档一致，其中89份为Node运行源码；工作区开发适配器读取兄弟项目TypeScript，固定依赖的全部编译库不是整树同字节，不以目录版本号推断等价。用实际候选SDK逐份严格验证、导入和导出4份原始PanelBundle，完整包摘要、状态与素材均精确保持；另行重打包交付并通过4份／34项实际浏览器检查，新增模型调用0。

SDK补充检查首轮把新ZIP命名为 `sdk-panel.zip`，常规检查工具按标准 `panel.zip` 查找，导致下载超时；该失败保留。随后由生产工具在新目录按标准名称重新打包，4份严格包往返和34项浏览器通过，未修改原始模型交付。

源码延续此前2028项离线回归，以及本地候选39项安装、17＋12＋24项SDK浏览器验收。本轮只增加4次已授权真实调用与只读验收，未修改运行源码。SDK补充交付是同一真实包的另行打包，不增加真实成功样本数。有限样本不证明所有口令必定成功；游戏服务、Unity原生运行和用户美术验收需单独验证。rc.7尚未发布，已发布rc.6保持原字节。

## 本地证据

原始结果 `output/readable-layout-real-v1`；对照页 `output/readable-layout-real-review-v1/index.html`；34项浏览器 `output/readable-layout-real-browser-v1`；标题、字号和操作分别为 `output/readable-layout-real-headings-v1`、`output/readable-layout-real-readability-v1`、`output/readable-layout-real-interactions-v1`；完整性审计 `output/readable-layout-real-audit-v1`；491份来源留存 `output/readable-layout-plan-source-v1`。

SDK来源比较 `output/readable-layout-sdk-plan-parity-v2`；SDK包往返 `output/readable-layout-real-sdk-v2`；SDK补充浏览器 `output/readable-layout-real-sdk-browser-v2`；首轮文件名失败 `output/readable-layout-real-sdk-browser-v1`；对照页检查 `output/readable-layout-real-gallery-browser-v1`。本地产物不随Git提交。

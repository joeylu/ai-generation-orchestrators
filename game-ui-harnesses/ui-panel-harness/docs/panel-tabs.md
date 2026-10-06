# Tabs 分页 v1

支持一个面板内 2–8 个横向页签。每页有独立分组，可混合滑条、开关、下拉、按钮、只读文字和加载条。
切页只改变显示，各页试玩值、加载进度和滚动位置保留；隐藏页不接收用户输入。页签固定在滚动内容之外，
页面共享测量后的面板高度。下拉菜单在离开页面时关闭，键盘 Tab 跳过隐藏页控件，方向键切换页签。

新目录 `examples/modern-mint-tabs.catalog.json` 增加 `navigation.tabs@0.1.0`，
生成使用 Context/Proposal/Spec/Bundle 0.6、PanelIntent 0.5、编译器 0.6.0。
普通需求继续输出普通容器，Spec 0.6 的 `tabs` 为 null。旧目录、协议和编译器版本保留原样复验。
生成只允许根节点为 Tabs，不支持嵌套、纵向页签或分页自动执行游戏动作。

Spec 的 `tabs` 声明稳定 ID、recipe、enum 状态绑定、宿主事件、enabled 和有序 pages。
page 包含 ID、标签及 section ID 列表；每个分组必须恰好属于一页。enum 的选项 ID/标签/顺序必须
与 pages 完全一致。每行和每个业务默认值仍须提供精确需求依据，程序确定绑定、布局和原文区间。
未指定初始页时，生成 Agent 使用第一个声明页作为导航呈现约定；明确指定时保留原请求。

自然语言修改可改页签文字、禁止切页、改导航创作默认值，以及对已有页的控件执行原有十类有限编辑。
新操作为 `set-tab-label(pageId,label)` 和 `set-tabs-enabled(enabled)`；更名同步更新 enum 标签。
应用保留当前试玩值与当前打开页，新的创作默认页在恢复对应状态时生效。新增、删除、重排整个页签
暂未提供有限操作，须返回具体澄清，不可隐式改变页面归属或重写完整 Spec。

确定性组合器新增 `layout:"tabs"`：把 2–8 个已验证的普通来源面板各放一页，初始打开首个来源。
来源须使用完全相同目录和主题，目录必须有 Tabs recipe。命名空间隔离字段、事件和重置范围，
相同资源字节去重，所有现有状态保留。已含 Tabs 的来源明确拒绝 `COMPOSITION_NESTED_TABS_UNSUPPORTED`，
不把已有导航状态展平丢掉。

Unity 适配器 0.1.3 使用原生 Button 作为页签、GameObject 显隐作为分页、每页独立 ScrollRect。
原生方向键移动页签按钮焦点，确认键切页；Pixi 的导航控件直接用方向键切页。
现有共享 PanelController 映射 enum 状态和事件，不增加逐面板脚本。全部文件仍在 `Assets/PanelHarness/`。
旧 managed Runtime 与新版本的自动迁移尚未实现，安装预检继续拒绝不同版本/摘要混装。

确定性夹具准备与构建（不调用模型）：

```sh
node scripts/write-tabs-fixture.mjs --output output/tabs-example
node scripts/build-workbench.mjs --catalog examples/modern-mint-tabs.catalog.json --example-context output/tabs-example/planning-context.json --example-proposal output/tabs-example/proposal.json --output output/tabs-studio
node scripts/check-tabs-workbench-browser.mjs --workbench output/tabs-studio --output test-results/tabs-browser
```

可用同一条分页需求测试真实模型；`--real` 明确发起两次不同默认页的生成及一次编辑，每个上下文只调用一次，
失败不自动重试。程序夹具、真实模型、浏览器与原生引擎证据分别记录，见 [任务记录](tasks.md)。

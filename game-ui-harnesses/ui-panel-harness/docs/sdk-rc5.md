# UI Panel Harness 0.1.0-rc.5

本版完成PanelSpec/Bundle 0.16的组件生成、编辑与交付支持，补全CheckBox、RadioGroup、List和Dialog；组件节点覆盖不等于16种内容行。新增公开规划入口、输入名称边界诊断、动作引用检查，默认Compiler 0.32.0将主标题居中。旧包按其固定版本重放。

另附 `examples/modern-action-headings.catalog.json`，显式采用主题0.22.0/0.22.1与Compiler 0.33.0：自动模式隐藏无页签单组副标题和纯按钮操作区标题；内容分组与页签保留；显式显示模式保留全部标题。默认SDK/Studio目录仍为modern-all-components，不静默迁移已有面板。

`fitDraftPanelLayout` 是显式启用的草稿尺寸辅助，仅调整调用方授权为建议值的尺寸，不改变控件、文案、状态或动作。没有切换生产默认为draft-first，也没有将开源skill实验摘录设为默认规则。

Component依赖仍锁定0.2.0-rc.3，UGUI源码0.1.7。完整ZIP包含固定依赖、runtime、目录与规划schema；解压整个包使用。发布附件记录源码提交、干净状态、ZIP与ES/IIFE摘要以及安装和浏览器验收结果。

发布前源码回归1779项通过，操作区新规则6份真实方案双模式离线重放、114项浏览器检查通过。真实模型测试与程序验收分开：最近标题批次实际9次，5份交付、2次澄清、2次失败，27项未运行；连接不确定后没有重试。不得声称所有自然输入均成功或某个skill优胜。Unity原生运行、消费方部署及完整新规则模型复测未完成。

本版仅发布Panel目录。历史rc.4与其他Harness标签和资产不覆盖。

// Presentation sandbox only: never writes a project or changes authoring props.
// The selector is derived from the loaded component catalog; this table owns
// only the explanation and meaningful trigger for each supported control.
export const motionDemos={
 Button:{label:'按钮',description:'按下 → 松开，比较按压、回弹与下沉。',start:h=>h.adapter.view.onDown.emit(),release:h=>h.adapter.view.onUp.emit()},
 Switch:{label:'开关',description:'开启 → 关闭，比较滑块行程与停稳节奏。',start:h=>h.setState({checked:true}),end:h=>h.setState({checked:false})},
 CheckBox:{label:'复选框',description:'勾选 → 取消，比较标记弹出、渐显与短移。',start:h=>h.setState({checked:true}),end:h=>h.setState({checked:false})},
 RadioGroup:{label:'单选组',description:'切换选项，比较新旧标记的进入和退出。',start:h=>h.setState({selectedId:h.props.options[1].id}),end:h=>h.setState({selectedId:h.props.options[0].id})},
 Input:{label:'输入框',description:'示例文字 → 恢复；输入框不附加焦点金框，点击可正常输入。',start:h=>h.setState({value:'示例文字'}),end:(h,e)=>h.setState(e.initial.get(h))},
 Select:{label:'下拉框',description:'展开 → 收起，比较条目错峰、分层与方向滑入。',start:h=>h.adapter.view.open(),end:h=>h.adapter.view.close()},
 Slider:{label:'滑块',description:'程序赋值 80 → 20；可直接拖动，拖动不会附加延迟。',start:h=>h.setState({value:h.props.min+(h.props.max-h.props.min)*.8}),end:h=>h.setState({value:h.props.min+(h.props.max-h.props.min)*.2})},
 ProgressBar:{label:'进度条',description:'进度 90 → 25，数值立即提交，填充有界过渡。',start:h=>h.setState({value:h.props.min+(h.props.max-h.props.min)*.9}),end:h=>h.setState({value:h.props.min+(h.props.max-h.props.min)*.25})},
 ScrollView:{label:'滚动视图',description:'向下滚动 → 返回顶部；内容与滑条同步，直接拖动跟手。',start:h=>h.setState({initialOffsetY:Math.min(160,Math.max(0,h.adapter.box.contentHeight-h.adapter.box.height))}),end:h=>h.setState({initialOffsetY:0})},
 List:{label:'列表',description:'选择第二项 → 第一项，比较行反馈与入场编排。',start:h=>h.setState({selectedId:h.props.items[1].id}),end:h=>h.setState({selectedId:h.props.items[0].id})},
 Dialog:{label:'弹窗',description:'关闭 → 打开，比较中心弹出、分层渐显与横向滑入。',start:h=>h.setState({open:false}),end:h=>h.setState({open:true})},
 Tabs:{label:'页签',description:'第二页 → 第一页，比较弹入、交叉淡化与方向切换。',start:h=>h.setState({activeId:h.props.tabs[1].id}),end:h=>h.setState({activeId:h.props.tabs[0].id})},
 Image:{label:'图片',description:'重播入场，保持图片比例；无额外点击动作。',entrance:true},
 Text:{label:'文本',description:'重播入场，保持字形与字号；不改变文字内容。',entrance:true},
 Container:{label:'布局容器',description:'重播容器与子项入场，透明容器不增加底板。',entrance:true},
 Panel:{label:'面板',description:'重播底板与内容入场，不改变布局尺寸。',entrance:true},
};

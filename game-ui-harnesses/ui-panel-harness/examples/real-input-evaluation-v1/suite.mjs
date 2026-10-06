/** Human-reviewable input variants and independent expectations; never model outputs. */
import {PANEL_EVALUATION_SUITE} from '../panel-evaluation/suite.mjs';
const quote=value=>`“${value}”`;
function describe(row,missing=false){
 if(row.kind==='slider')return `${quote(row.label)}用能拖的条，最低${row.min}，最高${row.max}，每格${row.step}，${missing?'初始值还没定，先问我':`一开始在${row.initial}`}，能操作`;
 if(row.kind==='switch')return `${quote(row.label)}做开关，${missing?'一开始开还是关还没定，先问我':`一开始${row.initial?'开着':'关着'}`}，打开就表示启用${quote(row.label)}，可以切换`;
 if(row.kind==='select')return `${quote(row.label)}做下拉，选项顺序是${row.options.map(quote).join('、')}，${missing?'先选哪一项还没定，先问我':`先选${quote(row.initialLabel)}`}，能选`;
 if(row.kind==='text')return `${quote(row.label)}是一行只读文字，${missing?'具体显示什么还没定，先问我':`就显示${quote(row.text)}`}`;
 if(row.kind==='button')return `${quote(row.label)}做按钮，${row.enabled?'能点':'不可点击'}，${missing?'点它是通知宿主还是恢复初值还没定，先问我':row.action==='reset-initial'?`点击恢复初始值，只恢复${row.resetLabels.map(quote).join('、')}`:'点了只发一个事件通知宿主，不改任何值'}`;
 throw Error('INPUT_VARIANT_KIND');
}
function request(item,missing){
 const rows=item.expected.rows,target=rows.find(row=>['slider','switch','select'].includes(row.kind))??rows.find(row=>row.kind==='text')??rows[0];
 const describeLabel=label=>describe(rows.find(row=>row.label===label),missing&&label===target.label);
 const content=item.expected.groups?item.expected.groups.map((labels,index)=>`第${index+1}组里按顺序放这些：${labels.map(describeLabel).join('；')}。`).join('\n'):
  `从上到下按我说的顺序来：${rows.map(row=>describe(row,missing&&row===target)).join('；')}。`;
 const layout=item.expected.layout;
 const geometry=layout?.kind==='grid'?`两组并排，用两列grid，窄了再排成一列，不做点击折叠。逻辑画布宽${layout.canvasWidth}，面板宽${layout.width}。`:
  layout?.kind==='column'?`用单列column，面板最高${layout.maxHeight}，装不下的内容竖向滚动。`:'';
 return{targetLabel:target.label,text:`帮我弄个现代薄荷色的游戏UI，标题就叫${quote(item.title)}。\n${content}\n${geometry}只保留我写出来的这些控件和按钮，别加别的。只做面板交互，不执行真实游戏业务。${missing?'上面明确说还没定的事情不要替我决定，有缺失先提具体问题。':''}`};
}
export const COLLOQUIAL_SUITE={panelEvaluationSuiteVersion:'0.3',scope:'16 colloquial rewrites of the standard cases; explicit facts preserved, not a claim about arbitrary user inputs',cases:PANEL_EVALUATION_SUITE.cases.map(item=>{
 const id='casual-'+item.id.slice(5);return{...structuredClone(item),id,request:{requestVersion:'0.1',id,target:'pixi',text:request(item,false).text}};
})};
export const INCOMPLETE_SUITE={panelEvaluationSuiteVersion:'0.3',scope:'16 deliberately incomplete requests; correct clarification is success, fabricated defaults are failures',cases:PANEL_EVALUATION_SUITE.cases.map(item=>{
 const id='missing-'+item.id.slice(5),variant=request(item,true);return{...structuredClone(item),id,request:{requestVersion:'0.1',id,target:'pixi',text:variant.text},expected:{...structuredClone(item.expected),outcome:'NEEDS_INPUT',missingLabel:variant.targetLabel}};
})};

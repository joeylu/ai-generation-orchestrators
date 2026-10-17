import test from 'node:test';
import assert from 'node:assert/strict';
import {panelEditorError,panelEditorNodeLabel} from '../src/studio/panel-editor-errors.mjs';
import {editorData,presetDocument} from '../src/panel/data.mjs';
import {sizeEditDocument} from '../src/panel/size-edit.mjs';
import {assertSize} from '../src/runtime/geometry.mjs';

const ctx=await editorData(),document=presetDocument(ctx.presets.presets[0],ctx),failure=(code,message,extra={})=>Object.assign(new Error(message),{code,...extra});
const capture=action=>{try{action();}catch(error){return error;}assert.fail('Expected the real validator to reject the edit');};

test('real resize errors use the exact failing node and readable labels while preserving the safety failure',()=>{
  const error=capture(()=>sizeEditDocument(document,{nodeId:'settings',height:100},ctx)),before=structuredClone(document),message=error.message,result=panelEditorError(error,document,ctx);
  assert.ok(result.message.length);assert.deepEqual(document,before);assert.equal(error.message,message);
  const prefix=/^([A-Za-z][A-Za-z0-9_.-]*): /u.exec(message);
  if(prefix){assert.equal(result.nodeId,prefix[1]);assert.ok(result.message.includes(panelEditorNodeLabel(document.nodes.find(node=>node.id===prefix[1]),document,ctx)));}
  else assert.equal(Object.hasOwn(result,'nodeId'),false);
});

test('precise node and existing slot prefixes translate without confusing IDs or arbitrary prose',()=>{
  const source={rootId:'root',nodes:[{id:'root',name:'root',recipeRef:'container@1.0.0',props:{},slots:{children:['body','row1','row10']}},{id:'body',name:'body',recipeRef:'container@1.0.0',props:{},slots:{children:['row1']}},{id:'row1',name:'row1',recipeRef:'button@1.0.0',props:{label:'确定'},slots:{}},{id:'row10',name:'row10',recipeRef:'button@1.0.0',props:{label:'取消'},slots:{}}]};
  const flow=panelEditorError(failure('panel.overflow','body: 流式区域内容放不下，请增大容器或使用滚动区域。'),source,ctx);
  assert.equal(flow.nodeId,'body');assert.match(flow.message,/“内容布局”：流式区域内容放不下/);assert.doesNotMatch(flow.message,/至少\s*\d/);
  assert.equal(panelEditorError(failure('panel.slot','body/children: 内容槽数量不合法。'),source,ctx).nodeId,'body');
  assert.equal(panelEditorError(failure('edit.text-capacity','row10: 文案放不下。'),source,ctx).nodeId,'row10');
  for(const error of [failure('NETWORK','row1: save failed'),failure('edit.size','missing: 尺寸错误。'),failure('skin.minimum','skin.item.normal: below declared skin minimum.'),failure('panel.slot','body/unknown: 未知槽。'),failure('edit.size','修改 row1 后出错。')])assert.equal(Object.hasOwn(panelEditorError(error,source,ctx),'nodeId'),false);
});

test('structured renderer identity and exact JSON pointer evidence locate only one known node',()=>{
  const result=panelEditorError(failure('edit.text-render','intro · 文案：当前字体超出安全区。',{nodeId:'intro'}),document,ctx);assert.equal(result.nodeId,'intro');assert.match(result.message,/当前字体超出安全区/);
  const index=document.nodes.findIndex(node=>node.id==='intro');
  for(const extra of [{path:'/nodes/'+index+'/size/width'},{issues:[{instancePath:'/nodes/'+index+'/props/text'}]}])assert.equal(panelEditorError(failure('panel.schema','尺寸不合法',extra),document,ctx).nodeId,'intro');
  assert.equal(panelEditorError(failure('panel.schema','/nodes/'+index+'/size/width must be >= 24'),document,ctx).nodeId,'intro');
  for(const error of [failure('edit.text-render','intro: 字体错误。',{nodeId:'removed'}),failure('panel.schema','多节点错误',{issues:[{instancePath:'/nodes/0/size'},{instancePath:'/nodes/1/size'}]}),failure('panel.schema','/nodes/0/size/width wrong; /nodes/1/size/height wrong')])assert.equal(Object.hasOwn(panelEditorError(error,document,ctx),'nodeId'),false);
  const duplicate=structuredClone(document);duplicate.nodes.push(structuredClone(duplicate.nodes[index]));assert.equal(Object.hasOwn(panelEditorError(failure('edit.size','intro: 尺寸错误。'),duplicate,ctx),'nodeId'),false);
});

test('only the authoritative geometry error supplies numerical minimums; a component type never guesses a node',()=>{
  const error=capture(()=>assertSize('Switch',{label:'开关'},ctx.profile,0,0)),minimum=/at least ([\d.]+)x([\d.]+)/u.exec(error.message),result=panelEditorError(error,document,ctx);
  assert.equal(Object.hasOwn(result,'nodeId'),false);assert.match(result.message,new RegExp(minimum[1]+' × '+minimum[2]));assert.match(result.message,/开关/);assert.ok(result.details.some(text=>text.includes('父级布局')));
  const noNumber=panelEditorError(failure('edit.text-capacity','intro: 调整后的尺寸无法容纳现有文字。'),document,ctx);
  assert.equal(noNumber.nodeId,'intro');assert.ok(noNumber.details.every(text=>!text.includes('至少')));
  const malformed=panelEditorError(failure('node.size','Switch requires at least NaNx30 logical pixels for this fixture content.'),document,ctx);assert.match(malformed.message,/NaN/);assert.equal(malformed.details,undefined);
  const fraction=panelEditorError(failure('node.size','Text requires at least 24.0004x30.55554 logical pixels for this fixture content.'),document,ctx);assert.match(fraction.message,/24\.0004 × 30\.55554/);
});

test('declared bounds and verified skin metadata are explicitly partial limits, never a calculated complete minimum',()=>{
  const source=structuredClone(document),node=source.nodes.find(node=>node.id==='intro');node.sizing={minWidth:80,maxHeight:200};
  const result=panelEditorError(failure('edit.size-managed','intro: 该轴受布局控制。'),source,ctx);
  assert.ok(result.details.some(text=>text.includes('宽度 ≥ 80')&&text.includes('高度 ≤ 200')));assert.ok(result.details.some(text=>text.includes('还可能要求更多空间')));
  const context={...ctx,skinGeometry:{version:'1.0',roles:[{role:'skin.item.normal',assetId:'item'}],assets:[{assetId:'item',minSize:{width:49,height:32}}]}};
  const error=failure('skin.minimum','intro: skin.item.normal: below declared skin minimum.'),skin=panelEditorError(error,source,context);
  assert.equal(skin.nodeId,'intro');assert.match(skin.message,/尺寸低于皮肤/);assert.ok(skin.details.some(text=>text.includes('49 × 32')));
  const stale=panelEditorError(error,source,{...context,binding:{sha256:'different'}});assert.equal(stale.details.some(text=>text.includes('49 × 32')),false);
});

test('labels are literal plain text and unknown failures remain usable without context or node guesses',()=>{
  assert.equal(panelEditorNodeLabel({id:'body',name:'body',props:{},recipeRef:'container@1.0.0'},document,ctx),'内容布局');
  assert.equal(panelEditorNodeLabel({id:'x',name:'x',props:{label:'<b>标签</b> & 图标'},recipeRef:'button@1.0.0'},document,ctx),'<b>标签</b> & 图标');
  for(const [error,message]of [[undefined,'画布调整未通过检查。'],[new Error(''),'画布调整未通过检查。'],['用户原始错误','用户原始错误'],[new Error('无法连接本地 Studio。'),'无法连接本地 Studio。']])assert.deepEqual(panelEditorError(error),{message});
  assert.deepEqual(panelEditorError(new Error('原始文档不合法'),{nodes:{}},{registry:{recipes:{}}}),{message:'原始文档不合法'});
});

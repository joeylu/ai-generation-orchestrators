import {appearanceApplicationFixture} from './appearance-application-fixture.ts';
import {createBundle} from '../../src/bundle.ts';
import {appearanceDocumentSha256} from '../../src/appearance-binding.ts';
import type {ButtonLabelLines} from '../../src/button-label-lines.ts';
export async function buttonLinesFixture() {
 const f=await appearanceApplicationFixture();
 const button=f.document.root.children!.find(n=>n.type==='Button')!;
 if(button.type!=='Button')throw Error('fixture');
 button.props.label='返回\nBACK';button.props.style={...button.props.style,fontFamily:'Arial'};
 const lines:ButtonLabelLines={version:'1.0',coordinateSpace:'target-component-local',lines:[
  {text:'返回',fontSize:14,fontWeight:'bold',align:'center',layout:{x:4,y:1,width:92,height:20}},
  {text:'BACK',fontSize:9,fontWeight:'normal',align:'center',layout:{x:4,y:23,width:92,height:14}}
 ]};
 (f.binding.bindings[0].states!.button as any).labelLines=lines;
 f.binding.documentSha256=await appearanceDocumentSha256(f.document);
 const target=await createBundle(f.document,[],{kind:'programmatic-fixture',description:'Explicit two-line button; no media calls'});
 return {...f,target,lines};
}

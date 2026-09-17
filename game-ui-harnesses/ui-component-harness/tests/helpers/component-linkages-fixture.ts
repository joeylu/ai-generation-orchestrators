import {listTextDocument,listTextHandoffFixture} from './list-text-fixture.ts';
import type {UiDocument,UiNode} from '../../src/tree-contract.ts';
export function linkageFixture():UiDocument {
 const d=listTextDocument(),style=d.root.props.style;d.id='linkages-procedural';
 const layout=(x:number,y:number,width:number,height:number)=>({x,y,width,height});
 const button=(id:string,label:string,x:number,y:number):UiNode=>({id,type:'Button',layout:layout(x,y,65,35),props:{label,enabled:true,style:{...style,fontSize:14}},children:[]});
 const text=(id:string,x:number,y:number,width:number):UiNode=>({id,type:'Text',layout:layout(x,y,width,35),props:{text:'fallback',drawBackground:false,wrap:'none',overflow:'error',lineHeight:20,style:{...style,fontSize:14}}});
 if(!('children'in d.root))throw Error('fixture');
 d.root.children.push(
 {id:'search',type:'Input',layout:layout(430,20,160,35),props:{value:'',placeholder:'Search',inputType:'text',readOnly:false,maxLength:32,enabled:true,style:{...style,fontSize:14}}},
 {id:'category',type:'Tabs',layout:layout(430,70,160,60),props:{activeId:'all',tabs:[{id:'all',label:'All',contentId:'all-content'},{id:'a',label:'A',contentId:'a-content'}],enabled:true,style:{...style,fontSize:14}},children:['all-content','a-content'].map(id=>({id,type:'Container' as const,layout:layout(0,40,160,20),props:{style},children:[]}))},
 {id:'sort',type:'Select',layout:layout(430,150,160,35),props:{selectedId:'low',options:[{id:'low',label:'Price low'},{id:'high',label:'Price high'}],enabled:true,style:{...style,fontSize:14}}},
 button('minus','-',430,205),button('plus','+',520,205),text('quantity',430,250,160),text('total',430,285,165),button('purchase','Buy',430,335));
 const list=d.root.children.find(n=>n.id==='skill-list');if(list?.type!=='List')throw Error('fixture');
 d.componentLinkages={version:'1.0',pipelines:[{listId:'skill-list',items:list.props.items.map((i,index)=>({itemId:i.id,searchText:i.label,category:index%2?'B':'A',unitPrice:[10,20,20,40,50,60][index]})),search:{inputId:'search',match:'contains',caseSensitive:false},category:{tabsId:'category',map:[{optionId:'all',category:null},{optionId:'a',category:'A'}]},sort:{selectId:'sort',map:[{optionId:'low',field:'unitPrice',direction:'asc'},{optionId:'high',field:'unitPrice',direction:'desc'}]},selectionOnFilter:'clear',quantity:{decrementId:'minus',incrementId:'plus',textId:'quantity',initial:1,min:1,max:3,step:1,onSelectionChange:'reset'},total:{textId:'total',operation:'multiply',fractionDigits:0,grouping:'comma',prefix:'',suffix:' gold',emptyText:'No selection'},purchase:{buttonId:'purchase',emptySelection:'disabled'}}]};return d;
}
export const linkageHandoffFixture=()=>listTextHandoffFixture(linkageFixture());


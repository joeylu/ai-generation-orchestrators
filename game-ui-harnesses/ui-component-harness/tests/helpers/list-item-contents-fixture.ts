import {linkageFixture} from './component-linkages-fixture.ts';
import {listTextHandoffFixture} from './list-text-fixture.ts';
import type {ResourceInput} from '../../src/bundle.ts';
import type {UiNode} from '../../src/tree-contract.ts';
export function compositeListFixture(){
 const document=linkageFixture(),list='children'in document.root?document.root.children.find(n=>n.type==='List'):undefined;
 if(list?.type!=='List')throw Error('fixture');const resources:ResourceInput[]=[];
 const svg=(path:string,color:string,index:number)=>{const shapes=[`<circle cx="16" cy="16" r="12" fill="${color}"/>`,`<rect x="4" y="4" width="24" height="24" fill="${color}"/>`,`<path d="M16 3L30 29H2Z" fill="${color}"/>`];resources.push({path,mime:'image/svg+xml',bytes:new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">${shapes[index%3]}</svg>`)});};
 svg('fixture/coin.svg','#e6aa22',0);
 list.props.itemContents={version:'1.0',coordinateSpace:'item-local',labelMode:'children',items:[]};
 list.props.items.forEach((item,index)=>{
  const icon=`fixture/icon-${index}.svg`;svg(icon,['#e34040','#2196de','#45a55c','#a155d1','#ef8522','#336475'][index],index);
  const style={...list.props.style,fontSize:12};
  const image=(suffix:string,source:string,x:number,y:number,width:number,height:number):UiNode=>({id:item.id+'-'+suffix,type:'Image',layout:{x,y,width,height},props:{source,fit:'contain',drawBackground:false,style}});
  const text=(suffix:string,value:string,x:number,y:number,width:number):UiNode=>({id:item.id+'-'+suffix,type:'Text',layout:{x,y,width,height:18},props:{text:value,drawBackground:false,wrap:'none',overflow:'error',lineHeight:15,style}});
  const children=[image('icon',icon,8,9,30,30),text('name',item.label,50,3,245),text('description',`Description ${index+1}`,50,27,245),image('coin','fixture/coin.svg',305,17,16,16),text('price',String(document.componentLinkages!.pipelines[0].items[index].unitPrice),330,16,60)];
  list.children.push(...children);list.props.itemContents!.items.push({itemId:item.id,childIds:children.map(c=>c.id)});
 });return{document,resources};
}
export const compositeListHandoffFixture=()=>{const f=compositeListFixture();return listTextHandoffFixture(f.document,f.resources);};

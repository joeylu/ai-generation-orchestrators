import type { UiDocument, UiNode, ListNode } from './tree-contract.ts';
export interface LinkagePipeline {
 listId:string; items:{itemId:string;searchText:string;category:string;unitPrice:number}[];
 search:{inputId:string;match:'contains'|'startsWith';caseSensitive:boolean};
 category:{tabsId:string;map:{optionId:string;category:string|null}[]};
 sort:{selectId:string;map:{optionId:string;field:'unitPrice'|'searchText';direction:'asc'|'desc'}[]};
 selectionOnFilter:'clear'|'first';
 quantity:{decrementId:string;incrementId:string;textId:string;initial:number;min:number;max:number;step:number;onSelectionChange:'retain'|'reset'};
 total:{textId:string;operation:'multiply';fractionDigits:number;grouping:'none'|'comma';prefix:string;suffix:string;emptyText:string};
 purchase:{buttonId:string;emptySelection:'disabled'|'enabled'};
}
export interface ComponentLinkages {version:'1.0';pipelines:LinkagePipeline[]}
export interface LinkageState {version:'1.0';quantities:{listId:string;value:number}[]}
function fail(code:string):never {throw Error(`COMPONENT_LINKAGE_${code}`);}
function exact(v:any,keys:string[]){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail('SCHEMA');}
function text(v:any,empty=false){if(typeof v!=='string'||(!empty&&!v.length)||v.length>256||/[\u0000-\u001f]/.test(v))fail('TEXT');}
function one(v:any,values:unknown[]){if(!values.includes(v))fail('ENUM');}
function integer(v:any,min=0,max=Number.MAX_SAFE_INTEGER){if(!Number.isSafeInteger(v)||v<min||v>max)fail('NUMBER');}
export function linkageNodes(document:UiDocument):Map<string,UiNode>{const map=new Map<string,UiNode>();function visit(n:UiNode){map.set(n.id,n);if('children'in n)n.children.forEach(visit);}visit(document.root);return map;}
export function validateComponentLinkages(document:UiDocument):void {
 const c=document.componentLinkages,s=document.linkageState;if(!Object.hasOwn(document,'componentLinkages')){if(Object.hasOwn(document,'linkageState'))fail('STATE_WITHOUT_CONFIG');return;}if(!c)fail('SCHEMA');
 exact(c,['version','pipelines']);if(c.version!=='1.0')fail('VERSION');if(!Array.isArray(c.pipelines)||!c.pipelines.length||c.pipelines.length>32)fail('LIMIT');
 const nodes=linkageNodes(document),participants=new Set<string>(),textTargets=new Set((document.valueTextBindings?.bindings??[]).map(b=>b.targetId));
 const ref=(id:string,type:string)=>{const n=nodes.get(id);if(!n||n.type!==type)fail('REFERENCE_TYPE');if(participants.has(id))fail('CONFLICT');participants.add(id);return n!;};
 for(const p of c.pipelines){
  exact(p,['listId','items','search','category','sort','selectionOnFilter','quantity','total','purchase']);
  const list=ref(p.listId,'List') as ListNode;
  if(!Array.isArray(p.items)||!p.items.length||p.items.length>1000||p.items.length!==list.props.items.length)fail('ITEM_COVERAGE');
  const itemIds=new Set(list.props.items.map(i=>i.id)),seen=new Set();
  for(const i of p.items){exact(i,['itemId','searchText','category','unitPrice']);if(!itemIds.has(i.itemId)||seen.has(i.itemId))fail('ITEM_REFERENCE');seen.add(i.itemId);text(i.searchText);text(i.category);integer(i.unitPrice);}
  exact(p.search,['inputId','match','caseSensitive']);ref(p.search.inputId,'Input');one(p.search.match,['contains','startsWith']);if(typeof p.search.caseSensitive!=='boolean')fail('BOOLEAN');
  exact(p.category,['tabsId','map']);const tabs=ref(p.category.tabsId,'Tabs');
  exact(p.sort,['selectId','map']);const select=ref(p.sort.selectId,'Select');
  const checkMap=(map:any[],ids:string[])=>{if(!Array.isArray(map)||map.length!==ids.length)fail('MAP_COVERAGE');const seen=new Set();for(const m of map){if(!ids.includes(m.optionId)||seen.has(m.optionId))fail('MAP_REFERENCE');seen.add(m.optionId);}};
  checkMap(p.category.map,tabs.type==='Tabs'?tabs.props.tabs.map(i=>i.id):[]);
  for(const m of p.category.map){exact(m,['optionId','category']);if(m.category!==null){text(m.category);if(!p.items.some(i=>i.category===m.category))fail('CATEGORY_REFERENCE');}}
  checkMap(p.sort.map,select.type==='Select'?select.props.options.map(i=>i.id):[]);
  for(const m of p.sort.map){exact(m,['optionId','field','direction']);one(m.field,['unitPrice','searchText']);one(m.direction,['asc','desc']);}
  one(p.selectionOnFilter,['clear','first']);const q=p.quantity;
  exact(q,['decrementId','incrementId','textId','initial','min','max','step','onSelectionChange']);ref(q.decrementId,'Button');ref(q.incrementId,'Button');ref(q.textId,'Text');
  integer(q.min);integer(q.max,q.min);integer(q.initial,q.min,q.max);integer(q.step,1);if((q.initial-q.min)%q.step||(q.max-q.min)%q.step)fail('STEP');one(q.onSelectionChange,['retain','reset']);
  const t=p.total;exact(t,['textId','operation','fractionDigits','grouping','prefix','suffix','emptyText']);ref(t.textId,'Text');one(t.operation,['multiply']);integer(t.fractionDigits,0,6);one(t.grouping,['none','comma']);text(t.prefix,true);text(t.suffix,true);text(t.emptyText,true);
  if(textTargets.has(q.textId)||textTargets.has(t.textId))fail('TEXT_CONFLICT');for(const i of p.items)if(!Number.isSafeInteger(i.unitPrice*q.max))fail('PRODUCT_OVERFLOW');
  exact(p.purchase,['buttonId','emptySelection']);ref(p.purchase.buttonId,'Button');one(p.purchase.emptySelection,['disabled','enabled']);
 }
 if(Object.hasOwn(document,'linkageState')){if(!s)fail('STATE_SCHEMA');exact(s,['version','quantities']);if(s.version!=='1.0')fail('STATE_VERSION');if(!Array.isArray(s.quantities)||s.quantities.length!==c.pipelines.length)fail('STATE_COVERAGE');const seen=new Set();for(const q of s.quantities){exact(q,['listId','value']);const p=c.pipelines.find(p=>p.listId===q.listId);if(!p||seen.has(q.listId))fail('STATE_REFERENCE');seen.add(q.listId);integer(q.value,p!.quantity.min,p!.quantity.max);if((q.value-p!.quantity.min)%p!.quantity.step)fail('STATE_STEP');}}
}
export function visibleLinkageItems(document:UiDocument,p:LinkagePipeline){
 const nodes=linkageNodes(document),input=nodes.get(p.search.inputId)!,tabs=nodes.get(p.category.tabsId)!,select=nodes.get(p.sort.selectId)!;
 const query=input.type==='Input'?input.props.value:'';const category=p.category.map.find(m=>tabs.type==='Tabs'&&m.optionId===tabs.props.activeId)!.category;
 const rule=p.sort.map.find(m=>select.type==='Select'&&m.optionId===select.props.selectedId);
 const fold=(s:string)=>p.search.caseSensitive?s:s.toLowerCase();
 const items=p.items.filter(i=>(category===null||i.category===category)&&fold(i.searchText)[p.search.match==='contains'?'includes':'startsWith'](fold(query)));
 if(rule)items.sort((a,b)=>{const x=a[rule.field],y=b[rule.field];const d=x<y?-1:x>y?1:0;return rule.direction==='asc'?d:-d;});
 return items;
}
export function quantityValue(document:UiDocument,p:LinkagePipeline){return document.linkageState?.quantities.find(q=>q.listId===p.listId)?.value??p.quantity.initial;}
/** Pure bounded state transition; the renderer only applies the result. */
export function linkageTransition(p:LinkagePipeline,visibleIds:string[],selectedId:string|null,previousSelection:string|null|undefined,quantity:number,activationId?:string){
 const selected=visibleIds.includes(selectedId??'')?selectedId:p.selectionOnFilter==='first'?(visibleIds[0]??null):null;
 let next=quantity;
 if((previousSelection!==undefined?previousSelection!==selected:selectedId!==selected)&&p.quantity.onSelectionChange==='reset')next=p.quantity.initial;
 if(selected!==null){if(activationId===p.quantity.incrementId)next=Math.min(p.quantity.max,next+p.quantity.step);if(activationId===p.quantity.decrementId)next=Math.max(p.quantity.min,next-p.quantity.step);}
 return {selectedId:selected,quantity:next};
}
export function writeQuantity(document:UiDocument,p:LinkagePipeline,value:number){document.linkageState??={version:'1.0',quantities:document.componentLinkages!.pipelines.map(p=>({listId:p.listId,value:p.quantity.initial}))};document.linkageState.quantities.find(q=>q.listId===p.listId)!.value=value;}
export function linkageTotal(document:UiDocument,p:LinkagePipeline){const list=linkageNodes(document).get(p.listId) as ListNode;const item=p.items.find(i=>i.itemId===list.props.selectedId);if(!item)return p.total.emptyText;let [a,b]=(item.unitPrice*quantityValue(document,p)).toFixed(p.total.fractionDigits).split('.');if(p.total.grouping==='comma')a=a.replace(/\B(?=(\d{3})+(?!\d))/g,',');return p.total.prefix+a+(b===undefined?'':'.'+b)+p.total.suffix;}



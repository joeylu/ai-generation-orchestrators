import type {UiDocument,UiNode} from './tree-contract.ts';
export type ValueTextPart = string
 | {field:'value'|'max';fractionDigits:number;grouping:'none'|'comma'}
 | {field:'selectedId';items:Array<{itemId:string;text:string}>;emptyText:string};
export interface ValueTextBindings {version:'1.0'|'1.1';bindings:Array<{sourceId:string;targetId:string;parts:ValueTextPart[]}>}
function exact(v:any,keys:string[],code:string){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==keys.sort().join(','))throw Error(code);}
function literal(v:unknown): asserts v is string {if(typeof v!=='string'||v.length>128||/[\u0000-\u001f\u007f]/.test(v))throw Error('VALUE_TEXT_LITERAL');}
export function validateValueTextBindings(value:unknown,document:UiDocument):asserts value is ValueTextBindings {
 const v=value as any;exact(v,['version','bindings'],'VALUE_TEXT_SCHEMA');if(!['1.0','1.1'].includes(v.version)||!Array.isArray(v.bindings)||v.bindings.length>256)throw Error('VALUE_TEXT_VERSION_OR_LIMIT');
 const nodes=new Map<string,UiNode>();const visit=(n:UiNode)=>{nodes.set(n.id,n);if('children'in n)n.children.forEach(visit);};visit(document.root);const targets=new Set();
 for(const b of v.bindings){exact(b,['sourceId','targetId','parts'],'VALUE_TEXT_BINDING');const source=nodes.get(b.sourceId),target=nodes.get(b.targetId);
 if(!source||!['Slider','ProgressBar',...(v.version==='1.1'?['List']:[])].includes(source.type)||target?.type!=='Text')throw Error('VALUE_TEXT_REFERENCE_TYPE');if(targets.has(b.targetId))throw Error('VALUE_TEXT_TARGET_CONFLICT');targets.add(b.targetId);
 if(!Array.isArray(b.parts)||!b.parts.length||b.parts.length>16)throw Error('VALUE_TEXT_FORMAT');let fields=0;
 for(const p of b.parts){
  if(typeof p==='string'){literal(p);continue;}
  if(source.type==='List'){
   exact(p,['field','items','emptyText'],'VALUE_TEXT_SELECTION_FORMAT');
   if(p.field!=='selectedId')throw Error('VALUE_TEXT_FIELD');
   literal(p.emptyText);
   if(!Array.isArray(p.items)||p.items.length!==source.props.items.length)throw Error('VALUE_TEXT_ITEM_COVERAGE');
   const ids=new Set(source.props.items.map(item=>item.id)),seen=new Set<string>();
   for(const item of p.items){exact(item,['itemId','text'],'VALUE_TEXT_ITEM_FORMAT');
    if(typeof item.itemId!=='string'||!ids.has(item.itemId)||seen.has(item.itemId))throw Error('VALUE_TEXT_ITEM_REFERENCE');
    seen.add(item.itemId);literal(item.text);
   }
  }else{
   exact(p,['field','fractionDigits','grouping'],'VALUE_TEXT_FORMAT');
   if(p.field!=='value'&&!(source.type==='ProgressBar'&&p.field==='max'))throw Error('VALUE_TEXT_FIELD');
   if(!Number.isInteger(p.fractionDigits)||p.fractionDigits<0||p.fractionDigits>6||!['none','comma'].includes(p.grouping))throw Error('VALUE_TEXT_FORMAT');
  }
  fields++;
 }if(!fields)throw Error('VALUE_TEXT_SOURCE_REQUIRED');
 }
}
export function formatValueText(binding:ValueTextBindings['bindings'][number],props:{value?:number;max?:number;selectedId?:string|null}):string {
 return binding.parts.map(p=>{if(typeof p==='string')return p;
  if(p.field==='selectedId'){
   if(props.selectedId===null)return p.emptyText;
   const item=p.items.find(item=>item.itemId===props.selectedId);
   if(!item)throw Error('VALUE_TEXT_ITEM_REFERENCE');
   return item.text;
  }
  const value=props[p.field];if(typeof value!=='number'||!Number.isFinite(value))throw Error('VALUE_TEXT_NUMBER');const fixed=value.toFixed(p.fractionDigits);const [integer,decimal]=fixed.split('.');return (p.grouping==='comma'?integer.replace(/\B(?=(\d{3})+(?!\d))/g,','):integer)+(decimal===undefined?'':'.'+decimal);}).join('');
}

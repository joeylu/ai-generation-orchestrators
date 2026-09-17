import type { UiDocument, UiNode } from './tree-contract.ts';
export interface ListItemContents {version:'1.0';coordinateSpace:'item-local';labelMode:'children';items:{itemId:string;childIds:string[]}[]}
function fail(code:string):never{throw Error(`LIST_ITEM_CONTENTS_${code}`);}
function exact(v:any,keys:string[]){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail('SCHEMA');}
export function validateListItemContents(document:UiDocument):void {
 const linked=new Set(document.componentLinkages?.pipelines.map(p=>p.listId)??[]);
 function visit(node:UiNode){
  if(node.type==='List'){
   if(!Object.hasOwn(node.props,'itemContents')){if(linked.has(node.id)&&node.children.length)fail('OWNERSHIP_REQUIRED');}
   else{
    const c=node.props.itemContents!;exact(c,['version','coordinateSpace','labelMode','items']);
    if(c.version!=='1.0')fail('VERSION');if(c.coordinateSpace!=='item-local'||c.labelMode!=='children')fail('MODE');
    if(!Array.isArray(c.items)||c.items.length!==node.props.items.length)fail('ITEM_COVERAGE');
    const items=new Set(node.props.items.map(i=>i.id)),seen=new Set<string>(),children=new Map(node.children.map(n=>[n.id,n])),owned=new Set<string>();
    for(const row of c.items){exact(row,['itemId','childIds']);if(!items.has(row.itemId)||seen.has(row.itemId))fail('ITEM_REFERENCE');seen.add(row.itemId);
     if(!Array.isArray(row.childIds)||!row.childIds.length||row.childIds.length>node.children.length)fail('CHILD_COVERAGE');
     for(const id of row.childIds){const child=children.get(id);if(!child||owned.has(id))fail('CHILD_REFERENCE');owned.add(id);if(child.type!=='Image'&&child.type!=='Text')fail('CHILD_TYPE');
      const {x,y,width,height}=child.layout;if(![x,y,width,height].every(Number.isFinite)||x<0||y<0||width<=0||height<=0||x+width>node.layout.width||y+height>node.props.itemHeight-(node.props.rowGap??0))fail('CHILD_BOUNDS');
     }
    }if(owned.size!==children.size)fail('CHILD_COVERAGE');
   }
  }
  if('children'in node)node.children.forEach(visit);
 }visit(document.root);
}

// Reuse layer buttons so routine renderer updates keep keyboard focus and scroll.
export function createPanelEditorTree(container, choose) {
 const buttons=new Map();let previousSelection;
 return {
  update(items, selected, {disabled=false,pending=new Set()}={}) {
   const wanted=new Set(items.map(item=>item.id));
   for(const[id,button]of buttons)if(!wanted.has(id)){button.remove();buttons.delete(id);}
   items.forEach((item,index)=>{
    let button=buttons.get(item.id);
    if(!button){button=container.ownerDocument.createElement('button');button.type='button';button.dataset.node=item.id;button.onclick=()=>choose(item.id);buttons.set(item.id,button);}
    button.disabled=disabled;button.setAttribute('aria-pressed',String(item.id===selected));button.style.paddingLeft=8+item.depth*9+'px';
    button.textContent=item.label;button.dataset.draft=String(pending.has(item.id));button.title=item.label+(pending.has(item.id)?' · 有尚未应用的输入':'');
    if(container.children[index]!==button)container.insertBefore(button,container.children[index]??null);
   });
   if(selected!==previousSelection)buttons.get(selected)?.scrollIntoView?.({block:'nearest',inline:'nearest'});
   previousSelection=selected;
  },
  button(id){return buttons.get(id);}
 };
}

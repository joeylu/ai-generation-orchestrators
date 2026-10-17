// One shared, accessible in-page confirmation. This module never submits work.
let active=null;
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
export function confirmAction({title,description,facts=[],details,confirmLabel='确认',cancelLabel='暂不生成',signal}){
 if(active||signal?.aborted)return Promise.resolve(false);
 return new Promise(resolve=>{
  const previous=document.activeElement,dialog=el('dialog',undefined,'confirm-dialog');dialog.id='confirm-dialog';
  dialog.setAttribute('aria-labelledby','confirm-title');dialog.setAttribute('aria-describedby','confirm-description');
  dialog.append(el('span','操作确认','eyebrow'));
  const heading=el('h2',title);heading.id='confirm-title';const text=el('p',description,'muted');text.id='confirm-description';dialog.append(heading,text);
  const list=el('dl',undefined,'confirm-facts');for(const [label,value]of facts){list.append(el('dt',label),el('dd',value));}dialog.append(list);
  if(details){const disclosure=el('details');disclosure.append(el('summary','查看计划标识'),el('code',details));dialog.append(disclosure);}
  const actions=el('div',undefined,'confirm-actions'),cancel=el('button',cancelLabel),accept=el('button',confirmLabel,'primary');
  cancel.id='confirm-cancel';cancel.autofocus=true;accept.id='confirm-accept';actions.append(cancel,accept);dialog.append(actions);
  let settled=false;
  const finish=value=>{
   if(settled)return;settled=true;active=null;window.removeEventListener('hashchange',navigated);signal?.removeEventListener('abort',navigated);dialog.close();dialog.remove();resolve(value);
   queueMicrotask(()=>{
    if(previous?.isConnected&&!previous.disabled&&!previous.closest('[hidden]'))previous.focus({preventScroll:true});
    else{const heading=document.querySelector('[data-view]:not([hidden]) h1');if(heading){heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true});heading.addEventListener('blur',()=>heading.removeAttribute('tabindex'),{once:true});}}
   });
  };
  const navigated=()=>finish(false);active=dialog;cancel.onclick=()=>finish(false);accept.onclick=()=>finish(true);
  dialog.addEventListener('cancel',e=>{e.preventDefault();finish(false);});
  dialog.addEventListener('click',e=>{const r=dialog.getBoundingClientRect();if(e.target===dialog&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))finish(false);});
  window.addEventListener('hashchange',navigated);signal?.addEventListener('abort',navigated,{once:true});document.body.append(dialog);dialog.showModal();cancel.focus();
 });
}

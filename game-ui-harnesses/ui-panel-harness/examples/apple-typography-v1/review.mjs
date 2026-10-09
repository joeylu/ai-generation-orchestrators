import {createPanelHost} from '../../src/panel-host.mjs';
import {pixiPanelCore,mountPixiPanelInstance} from '../../src/pixi-panel-instance.mjs';
const seed=JSON.parse(document.getElementById('review-seed').textContent);
const key=new URL(location.href).searchParams.get('panel')??'audio-dark-noto',entry=seed[key],events=[],errors=[];
const host=createPanelHost({core:pixiPanelCore,mount:mountPixiPanelInstance,onEvent:event=>{events.push(event);document.getElementById('feedback').textContent=`已触发 ${event.event.name}`;},onError:error=>errors.push(error.code)});
window.applePanelReview=Object.freeze({get:id=>host.get(id),source:id=>structuredClone(entry[id]),events:()=>structuredClone(events),errors:()=>structuredClone(errors)});
async function start(){
  if(!entry)throw new Error('TYPOGRAPHY_REVIEW_PANEL');
  document.getElementById('name').textContent=entry.title;
  document.getElementById('caption').textContent=entry.caption;
  document.getElementById('candidate-name').textContent=entry.face.title;
  const font=bundle=>bundle.catalog.themes.find(theme=>theme.id===bundle.spec.theme.id&&theme.version===bundle.spec.theme.version).tokens.fontFamily;
  document.getElementById('specimen-before').style.fontFamily=font(entry.before);
  document.getElementById('specimen-after').style.fontFamily=font(entry.after);
  for(const link of document.querySelectorAll('[data-purpose]')){link.href=`?panel=${link.dataset.purpose}-${entry.mode}-${entry.face.id}`;link.setAttribute('aria-current',String(link.dataset.purpose===entry.id));}
  for(const link of document.querySelectorAll('[data-mode]')){link.href=`?panel=${entry.id}-${link.dataset.mode}-${entry.face.id}`;link.setAttribute('aria-current',String(link.dataset.mode===entry.mode));}
  for(const link of document.querySelectorAll('[data-font]')){link.href=`?panel=${entry.id}-${entry.mode}-${link.dataset.font}`;link.setAttribute('aria-current',String(link.dataset.font===entry.face.id));}
  await document.fonts.ready;
  for(const id of ['before','after'])await host.add(id,entry[id],{container:document.getElementById(id)});
  document.getElementById('download').href=`${key}.zip`;
  document.documentElement.dataset.ready='true';
}
window.addEventListener('pagehide',()=>host.destroy(),{once:true});
start().catch(error=>{errors.push(error.code??error.message);document.documentElement.dataset.ready='error';});

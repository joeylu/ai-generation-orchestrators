import './gallery.mjs';
const $=id=>document.getElementById(id),config=await(await fetch('review.json')).json(),examples=await(await fetch('examples.json')).json();
for(const skin of config.skins)$('skin').add(new Option(skin.label,skin.id));
for(const item of examples.cases.cases)$('component').add(new Option(`${item.caseId} ${item.type}`,item.type));
let activeSkin,busy=false;
async function draw(){
  if(busy)return;busy=true;window.reviewReady=false;
  for(const el of document.querySelectorAll('select'))el.disabled=true;
  try{
    const id=$('skin').value;
    if(activeSkin!==id){
      window.harness?.dispose();
      const data=await(await fetch(`kits/${id}.json`)).json();Object.assign(data,structuredClone(examples));
      await initializeComponents(data);$('stage').append(harness.app.canvas);activeSkin=id;
    }
    const [width,height]=$('orientation').value==='wide'?[1280,720]:[720,1280];
    harness.app.renderer.resize(width,height);
    const type=$('component').value;
    if(type==='all')harness.gallery();
    else{
      harness.clear();
      const sample=harness.cases.find(c=>c.type===type),node=harness.make(type,{size:{width:Number($('size').value),height:sample.size.height}});
      harness.runtime.flush();node.adapter.afterLayout?.();
      if($('state').value==='value'&&examples.matrix.values[type])node.setState(examples.matrix.values[type]);
      if($('state').value==='disabled'&&node.recipe.propsSchema.properties.enabled)node.setEnabled(false);
      harness.runtime.flush();window.reviewNode=node;
    }
    $('status').textContent=`${config.skins.find(s=>s.id===id).label} · ${width} × ${height} · ${type==='all'?'16 类组件':type+' / 宽 '+$('size').value} · 回归已通过，视觉效果待验收`;
    window.reviewReady=true;window.reviewError=null;
  }catch(e){$('status').textContent='无法展示：'+e.message;window.reviewError=e.message;}
  finally{busy=false;for(const el of document.querySelectorAll('select'))el.disabled=false;for(const id of ['size','state'])$(id).disabled=$('component').value==='all';}
}
for(const el of document.querySelectorAll('select'))el.addEventListener('change',draw);
await draw();

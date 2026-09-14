// Public visibility setup isolates child paint; user input remains in the main driver.
export async function checkListChildren({page,children,resources,saveScreenshot}) {
 if(!children?.length)return [];
 const nodes=await page.evaluate(()=>window.uiHarness.inspect().nodes);
 const checks=[];
 for(const child of children){
  const n=nodes.find(n=>n.id===child.nodeId),r=child.rect;
  checks.push({slot:'list-child/'+child.nodeId+'/geometry',visible:true,expected:r,actual:n?.bounds,
   pass:Boolean(n?.visible&&[n.bounds.x,n.bounds.y,n.bounds.width,n.bounds.height].every((v,i)=>Math.abs(v-r[i])<.05))});
  if(child.kind==='Text'){
   const labels=n?.renderedTextBounds??[],label=labels[0];
   const textOK=label&&(label.text===child.text||(child.overflow==='ellipsis'&&label.text.endsWith('…')&&child.text.startsWith(label.text.slice(0,-1))));
   checks.push({slot:'list-child/'+child.nodeId+'/text',visible:true,expectedText:child.text,actual:labels,
    pass:child.text===''&&labels.length===0||Boolean(labels.length===1&&textOK&&label.fontFamily===child.fontFamily&&label.fontSize===child.fontSize)});
  }
 }
 let hidden;
 try {
  await page.evaluate(ids=>{for(const id of ids)window.uiHarness.setVisible(id,false);},children.map(c=>c.nodeId));
  hidden=await saveScreenshot('children-hidden');
 }finally{await page.evaluate(ids=>{for(const id of ids)window.uiHarness.setVisible(id,true);},children.map(c=>c.nodeId));}
 const shown=await saveScreenshot('children-restored');
 const pixels=await page.evaluate(async({children,resources,hidden,shown})=>{
  const decode=async data=>{const im=new Image();im.src='data:image/png;base64,'+data;await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const g=c.getContext('2d');g.drawImage(im,0,0);return {image:im,width:im.width,height:im.height,data:g.getImageData(0,0,c.width,c.height).data};};
  const base=await decode(hidden),actual=await decode(shown);
  const inside=(x,y,r)=>x>=Math.floor(r[0])&&y>=Math.floor(r[1])&&x<Math.ceil(r[0]+r[2])&&y<Math.ceil(r[1]+r[3])&&r[2]>0&&r[3]>0;
  const rows=[];let leaked=0;
  for(let y=0;y<actual.height;y++)for(let x=0;x<actual.width;x++){
   const o=(y*actual.width+x)*4;
   if(!children.some(c=>inside(x,y,c.visibleRect))&&[0,1,2].some(k=>Math.abs(actual.data[o+k]-base.data[o+k])>12))leaked++;
  }
  rows.push({slot:'list-children/clip-leak',visible:true,changedPixelsOutsideDeclaredClips:leaked,pass:leaked===0});
  for(const child of children){
   const r=child.visibleRect;let seen=0,bad=0,changed=0,colored=0;let expected;
   if(child.kind==='Image'){
    const im=await decode(resources[child.image]);const c=document.createElement('canvas');c.width=actual.width;c.height=actual.height;
    const g=c.getContext('2d');g.drawImage(base.image,0,0);g.drawImage(im.image,...child.rect);expected=g.getImageData(0,0,c.width,c.height).data;
   }
   const rgb=child.kind==='Text'?child.color.slice(1).match(/../g).map(c=>parseInt(c,16)):null;
   for(let y=Math.max(0,Math.ceil(r[1]));y<Math.min(actual.height,r[1]+r[3]);y++)for(let x=Math.max(0,Math.ceil(r[0]));x<Math.min(actual.width,r[0]+r[2]);x++){
    const o=(y*actual.width+x)*4;seen++;
    const different=[0,1,2].some(k=>Math.abs(actual.data[o+k]-base.data[o+k])>12);if(different)changed++;
    if(expected&&[0,1,2].some(k=>Math.abs(actual.data[o+k]-expected[o+k])>12))bad++;
    if(rgb&&different&&rgb.every((v,k)=>Math.abs(actual.data[o+k]-v)<=12))colored++;
   }
   const fullyClipped=r[2]===0||r[3]===0;
   rows.push({slot:'list-child/'+child.nodeId+'/pixels',visible:true,fullyClipped,checkedPixels:seen,badPixels:bad,changedPixels:changed,textColorPixels:colored,
    pass:fullyClipped?seen===0:child.kind==='Image'?seen>0&&bad/seen<=.05:child.text.trim()===''?changed===0:colored>=3});
  }
  return rows;
 },{children,resources,hidden:hidden.bytes.toString('base64'),shown:shown.bytes.toString('base64')});
 checks.push(...pixels.map(c=>({...c,hiddenScreenshot:hidden.path,hiddenSha256:hidden.sha256,screenshot:shown.path,screenshotSha256:shown.sha256})));
 return checks;
}

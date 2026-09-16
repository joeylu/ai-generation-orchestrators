// Bounded real-input acceptance for the consumer's componentLinkages 1.0.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
const [root,out]=process.argv.slice(2).map(p=>resolve(p)),dist=resolve(root,'dist');
const hash=b=>createHash('sha256').update(b).digest('hex');
const bytes=await readFile(resolve(out,'consumed.json')),bundle=JSON.parse(bytes),doc=bundle.document;
const matrix=JSON.parse(await readFile(resolve(out,'state-matrix.json'),'utf8'));
assert.equal(hash(bytes),matrix.bundleSha256);
const walk=n=>[n,...(n.children??[]).flatMap(walk)],nodes=new Map(walk(doc.root).map(n=>[n.id,n]));
const report={kind:'ui_linkage_browser_v1',status:'failed',bundleSha256:hash(bytes),handoffSha256:matrix.handoffSha256,human_visual_acceptance:false,checks:[],screenshots:[],coveredComponentIds:[],limitations:['direct Image/Text children only','image pixel checks sample opaque source pixels; not complete texture equivalence','at most 128 quantity steps per pipeline','all-category option required for exhaustive item coverage']};
const server=createServer(async(req,res)=>{try{const p=resolve(dist,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!p.startsWith(dist+sep))throw Error('path');res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[extname(p)]??'application/octet-stream');res.end(await readFile(p));}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser,page;let ordinal=0;
const check=(ok,name,detail={})=>{report.checks.push({name,pass:Boolean(ok),...detail});assert.ok(ok,name);};
try{
 const {chromium}=await import(pathToFileURL(resolve(root,'node_modules/playwright/index.mjs')));
 browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:process.env.UI_HARNESS_BROWSER||'msedge'}:{}),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 page=await browser.newPage({viewport:{width:2200,height:1800},deviceScaleFactor:1});page.setDefaultTimeout(10000);
 const origin=`http://127.0.0.1:${server.address().port}`,errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 await page.goto(origin+'/workbench.html');await page.waitForFunction(()=>window.uiHarness);
 await page.addStyleTag({content:'.workspace{display:block!important}.left-panel,.right-panel,.canvas-toolbar,.canvas-footer,.editor-panel,.motion-system-panel,.app-header,.pipeline,.app-footer{display:none!important}.canvas-area{max-height:none!important;overflow:visible!important;padding:0!important}#canvas-host{margin:0!important}'});
 const canvas=page.locator('#canvas-host canvas');
 const inspect=()=>page.evaluate(()=>window.uiHarness.inspect());
 // Step assertions read only document state. Keep unchanged resource base64
 // inside the browser instead of serializing the entire artwork on every click.
 const exported=()=>page.evaluate(async()=>({document:(await window.uiHarness.exportBundle()).document}));
 const node=async id=>(await inspect()).nodes.find(n=>n.id===id);
 const point=async(x,y)=>{const b=await canvas.boundingBox();return[b.x+x*b.width/doc.canvas.width,b.y+y*b.height/doc.canvas.height];};
 const click=async id=>{const n=await node(id);assert.ok(n?.visible,'LINKAGE_INPUT_NOT_VISIBLE');await page.mouse.click(...await point(n.bounds.x+n.bounds.width/2,n.bounds.y+n.bounds.height/2));};
 const focus=async id=>{await canvas.focus();for(let i=0;i<nodes.size*3+10&&await canvas.getAttribute('data-focused-component')!==id;i++)await page.keyboard.press('Tab');assert.equal(await canvas.getAttribute('data-focused-component'),id,'LINKAGE_FOCUS_UNREACHABLE');};
 const events=async()=>(await page.locator('#events li').allTextContents()).map(s=>JSON.parse(s));
 const clear=()=>page.evaluate(()=>document.querySelector('#events').replaceChildren());
 const settle=async()=>{await page.mouse.move(1,1);await page.waitForTimeout(100);};
 const shot=async name=>{
  // Capture the measured canvas without element-screenshot auto scrolling after
  // keyboard focus. Keep the full canvas and verify its geometry did not move.
  const before=await canvas.boundingBox();assert.ok(before&&before.width>0&&before.height>0,'LINKAGE_CANVAS_CAPTURE_BOUNDS');
  const scroll=await page.evaluate(()=>({x:window.scrollX,y:window.scrollY}));
  const path=`linkage-${String(++ordinal).padStart(4,'0')}.png`;
  const data=await page.screenshot({path:resolve(out,path),clip:{...before,x:before.x+scroll.x,y:before.y+scroll.y},timeout:30000});
  const after=await canvas.boundingBox();assert.ok(after&&['x','y','width','height'].every(k=>Math.abs(after[k]-before[k])<.1),'LINKAGE_CANVAS_MOVED_DURING_CAPTURE');
  report.screenshots.push({name,path,sha256:hash(data)});return data;
 };
 const search=async(p,text)=>{await click(p.search.inputId);await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText(text);if(!text)await page.keyboard.press('Backspace');await settle();};
 const tab=async(p,id)=>{const n=nodes.get(p.category.tabsId),i=n.props.tabs.findIndex(t=>t.id===id);await focus(n.id);await page.keyboard.press('Home');for(let k=0;k<i;k++)await page.keyboard.press('ArrowRight');await settle();check((await node(n.id)).value===id,'category real keyboard');};
 const sort=async(p,id)=>{const n=nodes.get(p.sort.selectId),i=n.props.options.findIndex(t=>t.id===id);await focus(n.id);await page.keyboard.press('Enter');await page.keyboard.press('Home');for(let k=0;k<i;k++)await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await settle();check((await node(n.id)).value===id,'sort real keyboard');};
 const verify=async(p,name)=>{
  await settle();const state=await inspect(),byId=new Map(state.nodes.map(n=>[n.id,n])),list=byId.get(p.listId),data=await exported();
  const query=byId.get(p.search.inputId).value,category=p.category.map.find(m=>m.optionId===byId.get(p.category.tabsId).value).category;
  const rule=p.sort.map.find(m=>m.optionId===byId.get(p.sort.selectId).value),fold=s=>p.search.caseSensitive?s:s.toLowerCase();
  const visible=p.items.filter(i=>(category===null||i.category===category)&&(p.search.match==='contains'?fold(i.searchText).includes(fold(query)):fold(i.searchText).startsWith(fold(query))));
  if(rule)visible.sort((a,b)=>(a[rule.field]<b[rule.field]?-1:a[rule.field]>b[rule.field]?1:0)*(rule.direction==='asc'?1:-1));
  check(JSON.stringify(list.visibleItemIds)===JSON.stringify(visible.map(i=>i.itemId)),name+'/visible order',{expected:visible.map(i=>i.itemId),actual:list.visibleItemIds});
  const q=data.document.linkageState?.quantities.find(q=>q.listId===p.listId)?.value??p.quantity.initial;
  check(Number.isSafeInteger(q)&&q>=p.quantity.min&&q<=p.quantity.max&&(q-p.quantity.min)%p.quantity.step===0,name+'/quantity bounds');
  const texts=id=>(byId.get(id)?.renderedTextBounds??[]).map(t=>t.text).join('');
  check(texts(p.quantity.textId)===String(q),name+'/quantity text');
  const selected=p.items.find(i=>i.itemId===list.value);let total=p.total.emptyText;
  if(selected){let[a,b]=(selected.unitPrice*q).toFixed(p.total.fractionDigits).split('.');if(p.total.grouping==='comma')a=a.replace(/\B(?=(\d{3})+(?!\d))/g,',');total=p.total.prefix+a+(b===undefined?'':'.'+b)+p.total.suffix;}
  check(texts(p.total.textId)===total,name+'/total text');
  check(byId.get(p.purchase.buttonId).enabled===(nodes.get(p.purchase.buttonId).props.enabled&&(list.value!==null||p.purchase.emptySelection==='enabled')),name+'/purchase enabled');
  for(const binding of doc.valueTextBindings?.bindings??[])if(binding.sourceId===p.listId){const expected=binding.parts.map(v=>typeof v==='string'?v:v.items.find(i=>i.itemId===list.value)?.text??v.emptyText).join('');check(texts(binding.targetId)===expected,name+'/selected text');}
  const owner=nodes.get(p.listId),images=[];
  if(owner.props.itemContents){check((list.renderedTextBounds??[]).length===0,name+'/no duplicate List label');
   for(const row of owner.props.itemContents.items){const index=list.visibleItemIds.indexOf(row.itemId);for(const id of row.childIds){const child=nodes.get(id),actual=byId.get(id);check(actual.visible===(index>=0),name+'/visibility/'+id);if(index<0)continue;
    const r=child.layout,expected=[list.bounds.x+r.x,list.bounds.y+index*owner.props.itemHeight+r.y,r.width,r.height];check([actual.bounds.x,actual.bounds.y,actual.bounds.width,actual.bounds.height].every((v,i)=>Math.abs(v-expected[i])<.1),name+'/position/'+id);
    if(child.type==='Text')check(texts(id)===child.props.text,name+'/child text/'+id);
    else{assert.ok(!child.props.region,'LINKAGE_IMAGE_REGION_UNSUPPORTED');images.push({id,rect:expected,fit:child.props.fit,resource:bundle.resources.find(r=>r.path===child.props.source)});}
   }}
  }
  if(owner.props.appearance){
   const a=owner.props.appearance;
   for(const [index,itemId] of list.visibleItemIds.entries()){
    const key=itemId===list.value?a.selectedRowImage:a.rowImage;
    const owned=owner.props.itemContents?.items.find(r=>r.itemId===itemId)?.childIds??[];
    const excluded=owned.map(id=>byId.get(id).bounds);
    if(!owner.props.itemContents)excluded.push({x:list.bounds.x+a.labelLayout.x,y:list.bounds.y+index*owner.props.itemHeight+a.labelLayout.y,width:a.labelLayout.width,height:a.labelLayout.height});
    images.push({id:'row/'+itemId,rect:[list.bounds.x,list.bounds.y+index*owner.props.itemHeight,owner.layout.width,owner.props.itemHeight-(owner.props.rowGap??0)],fit:'stretch',resource:bundle.resources.find(r=>r.path===key),excluded});
   }
  }
  const picture=await shot(name);
  if(images.length){const pixels=await page.evaluate(async({images,shot,size})=>{
   const decode=async src=>{const i=new Image();i.src=src;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const g=c.getContext('2d');g.drawImage(i,0,0);return{w:i.width,h:i.height,p:g.getImageData(0,0,c.width,c.height).data};};
   const screen=await decode('data:image/png;base64,'+shot),sx=screen.w/size.width,sy=screen.h/size.height;const rows=[];
   for(const im of images){const src=await decode('data:'+im.resource.mime+';base64,'+im.resource.base64),[x,y,w,h]=im.rect;let fw=w,fh=h;if(im.fit!=='stretch'){const scale=(im.fit==='cover'?Math.max:Math.min)(w/src.w,h/src.h);fw=src.w*scale;fh=src.h*scale;}const ox=x+(w-fw)/2,oy=y+(h-fh)/2;let count=0,bad=0;
    const start=im.excluded?.length ? .02 : .2,step=im.excluded?.length ? .06 : .2;
    for(let fy=start;fy<.99;fy+=step)for(let fx=start;fx<.99;fx+=step){const px=Math.floor(fx*src.w),py=Math.floor(fy*src.h),a=(py*src.w+px)*4;if(src.p[a+3]<250)continue;const gx=ox+(px+.5)*fw/src.w,gy=oy+(py+.5)*fh/src.h;if(gx<x||gx>=x+w||gy<y||gy>=y+h||(im.excluded??[]).some(r=>gx>=r.x-2&&gx<r.x+r.width+2&&gy>=r.y-2&&gy<r.y+r.height+2))continue;const b=(Math.floor(gy*sy)*screen.w+Math.floor(gx*sx))*4;count++;if([0,1,2].some(k=>Math.abs(src.p[a+k]-screen.p[b+k])>24))bad++;}
    rows.push({id:im.id,count,bad});}return rows;
  },{images,shot:picture.toString('base64'),size:doc.canvas});for(const r of pixels)check(r.count>0&&r.bad===0,name+'/opaque image samples/'+r.id,r);}
  return{list,q,data};
 };
 assert.equal(doc.componentLinkages?.version,'1.0');
 for(const p of doc.componentLinkages.pipelines){
  assert.ok((p.quantity.max-p.quantity.min)/p.quantity.step<=128,'LINKAGE_QUANTITY_STEP_BUDGET');
  await page.evaluate(b=>window.uiHarness.importBundle(b),bundle);await verify(p,'initial');
  const all=p.category.map.find(m=>m.category===null);assert.ok(all,'LINKAGE_ALL_CATEGORY_REQUIRED');
  await search(p,'');await tab(p,all.optionId);
  for(const rule of p.sort.map)await sort(p,rule.optionId),await verify(p,'sort-'+rule.optionId);
  for(const category of p.category.map){await tab(p,category.optionId);for(const rule of p.sort.map){await sort(p,rule.optionId);await verify(p,'combined-'+category.optionId+'-'+rule.optionId);}}
  await tab(p,all.optionId);
  for(const item of p.items){await search(p,item.searchText);const list=await node(p.listId),index=list.visibleItemIds.indexOf(item.itemId);assert.ok(index>=0);await page.mouse.click(...await point(list.bounds.x+12,list.bounds.y+index*nodes.get(p.listId).props.itemHeight+20));check((await node(p.listId)).value===item.itemId,'real row selection');await verify(p,'item-'+item.itemId);}
  await search(p,'');await tab(p,all.optionId);
  for(const [id,direction] of [[p.quantity.incrementId,1],[p.quantity.decrementId,-1]]){
   let before=(await verify(p,'quantity-start')).q;const bound=direction>0?p.quantity.max:p.quantity.min;
   while(before!==bound){
    await clear();await click(id);
    const expected=direction>0?Math.min(bound,before+p.quantity.step):Math.max(bound,before-p.quantity.step);
    const changes=(await events()).filter(e=>e.id===p.quantity.textId&&e.type==='change');
    check(changes.length===1,'one quantity event');
    const after=changes[0]?.value;check(after===expected,'real quantity step');
    const rendered=(await node(p.quantity.textId)).renderedTextBounds.map(t=>t.text).join('');
    check(rendered===String(expected),'quantity visible text per step');
    before=after;
   }
   await clear();await focus(id);await page.keyboard.press('Space');check((await events()).filter(e=>e.id===p.quantity.textId&&e.type==='change').length===0,'no boundary quantity event');await verify(p,'quantity-boundary');
  }
  let missing='no-match';while(p.items.some(i=>i.searchText.toLowerCase().includes(missing)))missing+='x';assert.ok(missing.length<=nodes.get(p.search.inputId).props.maxLength,'LINKAGE_EMPTY_QUERY_BUDGET');
  await search(p,missing);let empty=await verify(p,'empty');check(empty.list.value===null&&empty.list.visibleItemIds.length===0,'empty selection');
  await focus(p.listId);await page.keyboard.press('ArrowDown');await clear();await click(p.purchase.buttonId);check(!(await events()).some(e=>e.type==='activate'&&e.id===p.purchase.buttonId)||p.purchase.emptySelection==='enabled','empty purchase input');
  const b=(await node(p.listId)).bounds;await page.mouse.click(...await point(b.x+10,b.y+10));await verify(p,'empty-input');check((await node(p.listId)).value===null,'hidden rows not selectable');
  await search(p,'');await focus(p.listId);await page.keyboard.press('Home');await verify(p,'restored');
  report.coveredComponentIds.push(p.listId,p.search.inputId,p.category.tabsId,p.sort.selectId,p.quantity.decrementId,p.quantity.incrementId,p.purchase.buttonId);
 }
 check(errors.length===0,'no runtime errors',{errors});report.status='passed';
}catch(e){report.error=e.message;process.exitCode=2;if(page)try{await page.screenshot({path:resolve(out,'linkage-failure.png')});}catch{}}
finally{await browser?.close();await new Promise(r=>server.close(r));await writeFile(resolve(out,'linkage-browser.json'),JSON.stringify(report,null,2),{flag:'wx'});}
console.log(JSON.stringify({status:report.status,checks:report.checks.length,error:report.error}));

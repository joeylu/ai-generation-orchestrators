import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {startHarness} from './harness.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<.1,`${a} != ${b}`);
test('all 16 real Pixi controls reflow, keep state and interaction; content fit and failure are safe',async()=>{
  const h=await startHarness({width:1440,height:1200});
  try {
    const grid=await h.page.evaluate(()=>{
      harness.clear();const r=harness.runtime;
      const children=harness.cases.map(c=>harness.make(c.type,{props:c.type==='Dialog'?{modal:false}:{}},false));
      window.layoutSamples=children;
      window.layoutRoot=r.create({id:'grid',recipeRef:'container@1.0.0',props:{},size:{width:1280,height:1160},layout:{direction:'grid',columns:4,cellHeight:270,gap:12,padding:16}},{children});
      r.mount(layoutRoot);const before=children.map(c=>c.readState());layoutRoot.resize(1440,1160);
      return {before,after:children.map(c=>c.readState()),children:children.map(c=>({type:c.recipe.type,size:c.size,hit:c.root.hitArea.width,position:layoutRoot.root.toLocal(c.root.toGlobal({x:0,y:0}))})),snapshot:layoutRoot.snapshot()};
    });
    assert.equal(grid.children.length,16);assert.deepEqual(grid.after,grid.before);
    for(const [i,c]of grid.children.entries()){near(c.size.width,343);near(c.size.height,270);near(c.hit,343);near(c.position.x,16+(i%4)*355);near(c.position.y,16+Math.floor(i/4)*282);}
    assert.equal(grid.snapshot.size.width,1440);
    if(process.env.UI_CHAIN_LAYOUT_EVIDENCE)await h.page.screenshot({path:join(process.env.UI_CHAIN_LAYOUT_EVIDENCE,'layout-grid-desktop.png')});
    // Button's hit region after reflow must be clickable at the resized right edge.
    const button=await h.page.evaluate(()=>{const n=layoutSamples[0],p=n.root.toGlobal({x:n.size.width-30,y:30});return {x:p.x,y:p.y,id:n.id};});
    await h.page.mouse.click(button.x,button.y);
    assert.ok(await h.page.evaluate(id=>harness.events.some(e=>e.nodeId===id&&e.event==='activate'),button.id));
    const flow=await h.page.evaluate(()=>{
      harness.clear();const r=harness.runtime;
      const input=harness.make('Input',{size:{width:120,height:44},sizing:{widthMode:'fill',minWidth:100},props:{value:'保持内容'}},false);
      const button=harness.make('Button',{size:{width:100,height:44}},false);
      const row=r.create({id:'row',recipeRef:'container@1.0.0',size:{width:600,height:80},layout:{direction:'row',padding:10,gap:10,align:'center'}},{children:[input,button]});
      r.mount(row);window.layoutRoot=row;window.layoutInput=input;window.layoutButton=button;
      const initial=input.size.width;row.resize(380,80);const narrow=input.size.width;
      button.setVisible(false);const hidden=input.size.width;button.setVisible(true);
      const before=JSON.stringify([row.snapshot(),input.size,button.size]);let failed=false;
      try{row.resize(180,80);}catch{failed=true;}
      const unchanged=JSON.stringify([row.snapshot(),input.size,button.size])===before;r.flush();
      return {initial,narrow,hidden,failed,unchanged,value:input.readState().value,width:input.size.width,hit:input.root.hitArea.width,authored:input.snapshot().size.width};
    });
    assert.deepEqual(flow,{initial:470,narrow:250,hidden:360,failed:true,unchanged:true,value:'保持内容',width:250,hit:250,authored:120});
    await h.page.setViewportSize({width:390,height:844});
    await h.page.evaluate(()=>harness.app.renderer.resize(390,844));
    if(process.env.UI_CHAIN_LAYOUT_EVIDENCE)await h.page.screenshot({path:join(process.env.UI_CHAIN_LAYOUT_EVIDENCE,'layout-flow-mobile.png')});
    const fit=await h.page.evaluate(()=>{
      harness.clear();const r=harness.runtime,children=Array.from({length:3},(_,i)=>harness.make('Button',{size:{width:140,height:44}},false));
      const root=r.create({id:'fit',recipeRef:'container@1.0.0',size:{width:370,height:200},sizing:{heightMode:'content'},layout:{direction:'wrap',padding:10,gap:10}},{children});r.mount(root);
      const first=root.size.height;root.resize(190,200);const narrow=root.size.height;children[1].setVisible(false);
      return {first,narrow,hidden:root.size.height,author:root.snapshot().size.height};
    });
    assert.deepEqual(fit,{first:118,narrow:172,hidden:118,author:200});
    const scroll=await h.page.evaluate(()=>{
      harness.clear();const r=harness.runtime,rows=Array.from({length:6},()=>harness.make('Button',{size:{width:180,height:40}},false));
      const body=r.create({id:'scroll-body',recipeRef:'container@1.0.0',size:{width:180,height:300},sizing:{heightMode:'content'},layout:{direction:'column',gap:8}},{children:rows});
      const view=r.create({id:'scroll',recipeRef:'scroll-view@1.0.0',size:{width:240,height:160},props:{axis:'vertical',scrollbar:'auto'}},{content:[body]});r.mount(view);
      const initial={height:body.size.height,bar:view.adapter.bar.visible};rows.slice(2).forEach(n=>n.setVisible(false));r.flush();
      return {initial,after:{height:body.size.height,bar:view.adapter.bar.visible},events:harness.events.length};
    });
    assert.deepEqual(scroll,{initial:{height:280,bar:true},after:{height:88,bar:false},events:0});
    assert.deepEqual(h.errors,[]);
  }finally{await h.close();}
});

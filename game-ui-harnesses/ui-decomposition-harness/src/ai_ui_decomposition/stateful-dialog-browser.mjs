export function outsideDialogPoint(b, d, canvas = {width: Infinity, height: Infinity}) {
  const right=Math.min(b.x+b.width,canvas.width),bottom=Math.min(b.y+b.height,canvas.height);
  b={x:Math.max(0,b.x),y:Math.max(0,b.y),width:right-Math.max(0,b.x),height:bottom-Math.max(0,b.y)};
  if(b.width<=0||b.height<=0)return undefined;
  const candidates = [
    [b.x + b.width / 2, b.y + b.height / 2],
    [b.x + b.width / 2, (b.y + Math.min(b.y + b.height, d.y)) / 2],
    [b.x + b.width / 2, (Math.max(b.y, d.y + d.height) + b.y + b.height) / 2],
    [(b.x + Math.min(b.x + b.width, d.x)) / 2, b.y + b.height / 2],
    [(Math.max(b.x, d.x + d.width) + b.x + b.width) / 2, b.y + b.height / 2],
  ];
  return candidates.find(([x,y]) => x > b.x && y > b.y && x < b.x+b.width && y < b.y+b.height &&
    (x < d.x || y < d.y || x >= d.x+d.width || y >= d.y+d.height));
}
// Real PixiJS Dialog checks. No generation and no invented business routing.
export async function prepareDialogContext(page, root, targetId) {
  const dialogs = [], ancestors = new Set();
  const walk = (node, parents = []) => {
    if (node.id === targetId) for (const id of parents) ancestors.add(id);
    if (node.type === 'Dialog') dialogs.push(node.id);
    for (const child of node.children ?? []) walk(child, node.type === 'Dialog' ? [...parents, node.id] : parents);
  };
  walk(root);
  await page.evaluate(({dialogs, ancestors}) => {
    for (const id of dialogs) window.uiHarness.setValue(id, ancestors.includes(id));
  }, {dialogs, ancestors: [...ancestors]});
}

export function logicalVisibility(root, targetDialog, open) {
 const visible=new Map();
 const walk=(n,parent=true)=>{
  const own=parent&&(n.type!=='Dialog'||(n.id===targetDialog?open:n.props.open));visible.set(n.id,own);
  for(const c of n.children??[])walk(c,own&&(n.type!=='Tabs'||n.props.tabs.find(t=>t.id===n.props.activeId)?.contentId===c.id));
 };walk(root);return visible;
}

export async function isolatedModalProbe({page,component,bundle,at,createBundle,saveFixture,saveScreenshot}) {
 const root=structuredClone(bundle.document),ids=new Set();const walk=n=>{ids.add(n.id);for(const c of n.children??[])walk(c);};walk(root.root);
 let id='acceptance-modal-probe';while(ids.has(id))id+='-probe';
 if(root.root.type!=='Container')throw Error('STATE_DIALOG_PROBE_ROOT_UNSUPPORTED');
 root.root.children.unshift({id,type:'Button',layout:{x:0,y:0,...root.canvas},props:{label:'',enabled:true,style:{backgroundColor:'#314253',borderColor:'#314253',borderWidth:0,cornerRadius:0,textColor:'#FFFFFF',fontFamily:'Arial',fontSize:16,fontWeight:'normal',opacity:1}},children:[]});
 const fixture=await createBundle(root,bundle.resources.map(r=>({path:r.path,mime:r.mime,bytes:Buffer.from(r.base64,'base64')})),{kind:'programmatic-fixture',description:'Acceptance-only clone with an explicit background hit probe; never a delivered business component or reference observation.'});
 const evidence=await saveFixture(fixture);const checks=[];
 try{
  await page.evaluate(b=>window.uiHarness.importBundle(b),fixture);await prepareDialogContext(page,root.root,component.componentId);
  const bounds=await page.evaluate(id=>window.uiHarness.inspect().nodes.find(n=>n.id===id).bounds,component.componentId);
  const point=outsideDialogPoint({x:0,y:0,...root.canvas},bounds,root.canvas);
  if(!point)throw Error('STATE_DIALOG_MODAL_PROBE_NO_EXTERIOR');
  for(const open of [false,true,false]){
   await page.evaluate(({id,open})=>window.uiHarness.setValue(id,open),{id:component.componentId,open});
   const before=await page.evaluate(id=>window.uiHarness.activationCount(id),id);
   await page.mouse.click(...await at(point));await page.mouse.move(1,1);
   const delta=await page.evaluate(id=>window.uiHarness.activationCount(id),id)-before;
   const shot=await saveScreenshot();checks.push({open,actualActivations:delta,pass:delta===(open?0:1),screenshot:shot.path,screenshotSha256:shot.sha256});
  }
 }finally{await page.evaluate(b=>window.uiHarness.importBundle(b),bundle);await prepareDialogContext(page,bundle.document.root,component.componentId);}
 return {slot:'modal/isolated-background-probe',visible:true,pass:checks.every(c=>c.pass),basis:'separate-programmatic-fixture',fixture:evidence,checks,deliveredBundleModified:false};
}

export async function acceptDialog({page, canvas, component, bundle, at, saveScreenshot,runModalProbe}) {
  const id = component.componentId;
  const inspect = () => page.evaluate(() => window.uiHarness.inspect().nodes);
  const set = value => page.evaluate(({id, value}) => window.uiHarness.setValue(id, value), {id, value});
  const click = async point => page.mouse.click(...await at(point));
  const count = id => page.evaluate(id => window.uiHarness.activationCount(id), id);
  const allNodes = [];
  const walk = n => { allNodes.push(n); for (const child of n.children ?? []) walk(child); };
  walk(bundle.document.root);
  const node = allNodes.find(n => n.id === id), childIds = component.states[0].dialog.children;
  const buttons = allNodes.filter(n => n.type === 'Button' && n.props.enabled && childIds.includes(n.id));
  await set(false); await page.mouse.move(1, 1);
  const closedNodes = await inspect();
  const dialogBounds = closedNodes.find(n => n.id === id).bounds;
  const center = b => [b.x + b.width / 2, b.y + b.height / 2];
  const behind = allNodes.filter(n => n.type === 'Button' && n.props.enabled && !childIds.includes(n.id)).find(n => {
    const q = closedNodes.find(v => v.id === n.id); if (!q?.visible) return false;
    return Boolean(outsideDialogPoint(q.bounds, dialogBounds, bundle.document.canvas));
  });
  const isolatedProbe=node.props.modal&&!behind?await runModalProbe():undefined;
  if (!buttons.length) throw Error('STATE_DIALOG_ACTION_PROBE_MISSING');
  const baseline = await canvas.screenshot();
  const results = [];
  for (const state of component.states) {
    await set(state.value); await page.mouse.move(1, 1);
    const nodes = await inspect(), actual = nodes.find(n => n.id === id);
    const actualOpen = await page.evaluate(id => {
      const find = n => n.id === id ? n : (n.children ?? []).map(find).find(Boolean);
      return find(window.uiHarness.getDocument().root).props.open;
    }, id);
    const checks = [{slot: 'dialog/visibility', visible: true, actual: actual.visible,
      pass: actual.visible === state.value && actualOpen === state.value}];
    const semanticRoot=await page.evaluate(()=>window.uiHarness.getDocument().root);
    const expectedVisibility=logicalVisibility(semanticRoot,id,state.value);
    for (const child of childIds) checks.push({slot: 'child/' + child, visible: true,
      expectedVisible:expectedVisibility.get(child),actualVisible:nodes.find(n=>n.id===child)?.visible,
      pass: nodes.find(n => n.id === child)?.visible === expectedVisibility.get(child)});
    if(isolatedProbe)checks.push(isolatedProbe);
    if (behind) {
      const before = await count(behind.id);
      await click(outsideDialogPoint(closedNodes.find(n => n.id === behind.id).bounds, dialogBounds, bundle.document.canvas));
      const delta = await count(behind.id) - before;
      checks.push({slot: 'modal/background-activation', visible: true, actualActivations: delta,
        pass: delta === (state.value && node.props.modal ? 0 : 1)});
    }
    for (const button of buttons) {
      const before = await count(button.id);
      await click(center(nodes.find(n => n.id === button.id).bounds));
      const delta = await count(button.id) - before;
      checks.push({slot: 'action/' + button.id, visible: true, actualActivations: delta,
        pass: delta === (expectedVisibility.get(button.id) ? 1 : 0), businessRouting: 'not-bound-by-public-contract'});
    }
    await page.mouse.move(1, 1);
    const shot = await saveScreenshot();
    const pixelChecks = await page.evaluate(async ({baseline, shot, state, resources, size, bounds}) => {
      const image = async data => { const i = new Image(); i.src = 'data:image/png;base64,' + data; await i.decode(); return i; };
      const make = () => { const c = document.createElement('canvas'); c.width = size.width; c.height = size.height; return c; };
      const expected = make(), ctx = expected.getContext('2d'); ctx.drawImage(await image(baseline), 0, 0);
      const mask = make(), mc = mask.getContext('2d');
      if (state.value) {
        if (state.dialog.modal && state.dialog.overlay === 'runtime-default') {
          ctx.save(); ctx.fillStyle = state.dialog.backdrop?.color ?? '#10233F'; ctx.globalAlpha = state.dialog.backdrop?.opacity ?? 0.28; ctx.fillRect(0, 0, size.width, size.height); ctx.restore();
          mc.fillStyle = '#fff'; mc.fillRect(0, 0, size.width, size.height);
        }
        for (const part of state.parts) if (part.visible) {
          const i = await image(resources[part.image]); ctx.drawImage(i, ...part.rect); mc.drawImage(i, ...part.rect);
        }
      } else { mc.fillStyle = '#fff'; mc.fillRect(0, 0, size.width, size.height); }
      const actual = make(), ac = actual.getContext('2d'); ac.drawImage(await image(shot), 0, 0);
      const a = ac.getImageData(0, 0, size.width, size.height).data;
      const e = ctx.getImageData(0, 0, size.width, size.height).data, m = mc.getImageData(0, 0, size.width, size.height).data;
      let seen = 0, bad = 0, overlaySeen = 0;
      for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) {
        const off = (y * size.width + x) * 4; if (!m[off + 3]) continue;
        if (state.value && state.exclude.some(r => x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3])) continue;
        seen++; if (x < bounds.x || y < bounds.y || x >= bounds.x + bounds.width || y >= bounds.y + bounds.height) overlaySeen++;
        if ([0,1,2,3].some(k => Math.abs(a[off+k] - e[off+k]) > 12)) bad++;
      }
      return [{slot: 'dialog/source-over-pixels', visible: true, checkedPixels: seen, badPixels: bad,
        overlayPixels: overlaySeen, pass: seen > 0 && bad / seen <= .05 && (!state.value || !state.dialog.modal || overlaySeen > 0)}];
    }, {baseline: baseline.toString('base64'), shot: shot.bytes.toString('base64'), state,
      resources: Object.fromEntries(bundle.resources.map(r => [r.path, r.base64])), size: bundle.document.canvas, bounds: dialogBounds});
    checks.push(...pixelChecks);
    results.push({componentId: id, state: state.name, actualValue: actualOpen,
      screenshot: shot.path, screenshotSha256: shot.sha256, checks});
    if (checks.some(c => !c.pass)) {
      const error = Error('STATE_DIALOG_BROWSER_MISMATCH'); error.results = results; throw error;
    }
  }
  return results;
}

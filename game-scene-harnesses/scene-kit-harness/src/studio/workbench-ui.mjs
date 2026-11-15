const paths={check:'M5 12l4 4L19 6',select:'M4 3l15 9-7 2-3 7z',paint:'M14 3l7 7-9 9-7-7z M5 12l-2 9 9-2',erase:'M4 14l8-10 9 7-8 10H9z M7 17l5-6',curve:'M3 18C4 2 20 22 21 6 M3 18h.01 M21 6h.01',pan:'M8 12V7a2 2 0 014 0v5-8a2 2 0 014 0v8-5a2 2 0 014 0v8c0 5-4 7-8 7-3 0-5-3-7-6l-2-3a2 2 0 013-2l2 2',undo:'M4 9h10a6 6 0 010 12 M4 9l5-5 M4 9l5 5',redo:'M20 9H10a6 6 0 000 12 M20 9l-5-5 M20 9l-5 5',copy:'M8 8h12v13H8z M4 16H3V3h13v1',trash:'M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7',eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M9 12a3 3 0 106 0 3 3 0 00-6 0',lock:'M6 10h12v11H6z M8 10V6a4 4 0 018 0v4',layers:'M3 8l9-5 9 5-9 5z M3 12l9 5 9-5 M3 16l9 5 9-5',folder:'M3 6h7l2 3h9v12H3z',more:'M5 12h.01 M12 12h.01 M19 12h.01',plus:'M12 4v16 M4 12h16',minus:'M4 12h16',reset:'M4 5v6h6 M5 10a8 8 0 111 8',expand:'M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5',library:'M3 4h7v7H3z M14 4h7v7h-7z M3 15h7v6H3z M14 15h7v6h-7z',close:'M5 5l14 14 M5 19L19 5'};
export function icon(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',paths[name]??paths.more);svg.append(p);return svg;}
export function iconize(button,name,label){button.replaceChildren(icon(name));button.title=label;button.setAttribute('aria-label',label);return button;}
export function button(name,label,action){const b=document.createElement('button');b.type='button';iconize(b,name,label);b.onclick=action;return b;}
export function arrangeWorkbench(){
  const $=id=>document.getElementById(id),shell=$('canvas-shell'),inspector=document.querySelector('.inspector');
  document.body.classList.add('canvas-workbench');inspector.setAttribute('aria-label','图层');
  const legacy=document.createElement('div');legacy.id='legacy-ui';legacy.hidden=true;document.body.append(legacy);
  const properties=document.createElement('div');properties.id='canvas-properties';properties.className='canvas-popover';properties.hidden=true;shell.append(properties);
  let propertiesTrigger;
  const toggleProperties = event => {
    properties.hidden = !properties.hidden;
    if (!properties.hidden) {
      propertiesTrigger = event.currentTarget;
      $('canvas-options').open = false;
      if (event.detail === 0) close.focus();
    }
  };
  const close = button('close', '关闭画布属性', () => {
    properties.hidden = true;
    propertiesTrigger?.focus();
  });
  close.className='popover-close';properties.append(close);
  for(const section of [...inspector.children]){if(section.contains($('layers')))continue;
    if(section.contains($('selection'))||section.id==='curve-panel')properties.append(section);else legacy.append(section);}
  inspector.querySelector('h2').textContent='图层';inspector.id='layer-panel';
  const floating=document.createElement('div');floating.id='selection-tools';floating.className='canvas-floating';floating.hidden=true;
  for(const [id,name,label]of [['duplicate','copy','复制'],['delete','trash','删除'],['expand','expand','展开组合']])floating.append(iconize($(id),name,label));
  for(const [id,name,label]of [['scale-down','minus','缩小对象'],['scale-up','plus','放大对象'],['scale-reset','reset','恢复对象尺寸']]){const b=button(name,label);b.id=id;floating.append(b);}
  const conversion=document.createElement('div');conversion.id='terrain-conversion';conversion.hidden=true;conversion.style.maxWidth='170px';
  const convert=document.createElement('button');convert.id='convert-terrain-skin';convert.type='button';convert.textContent='转为可刷地形';
  convert.title='替换完整平台外观，保留原格子和碰撞；可撤销恢复。';convert.setAttribute('aria-describedby','terrain-conversion-note');
  const conversionNote=document.createElement('p');conversionNote.id='terrain-conversion-note';conversionNote.textContent='替换整图外观，保留格子。一次撤销可恢复。';
  conversionNote.style.cssText='margin:3px 0 0;font-size:12px;line-height:1.4';conversion.append(convert,conversionNote);floating.append(conversion);
  const objectProperties=button('more','对象属性',event=>{
    toggleProperties(event);
    const appearance=$('object-appearance');
    if(!properties.hidden&&!appearance.hidden)appearance.open=true;
  });
  objectProperties.className='selection-properties';
  objectProperties.setAttribute('aria-controls',properties.id);
  objectProperties.append('对象属性');floating.append(objectProperties);shell.append(floating);
  const curve=document.createElement('div');curve.id='curve-actions';curve.className='canvas-floating';curve.hidden=true;
  const curveLabels={'add-curve':'新曲线','add-mixed':'混合地形','insert-curve-point':'加点','delete-curve-point':'删点','join-curves':'合并端点','connect-grid':'连接平台','disconnect-grid':'断开','remove-curve':'删除曲线'};
  for(const id of Object.keys(curveLabels)){const b=$(id);b.title=b.textContent;b.setAttribute('aria-label',b.textContent);b.textContent=curveLabels[id];b.classList.remove('full');curve.append(b);}
  curve.append(button('more','曲线属性',toggleProperties));shell.append(curve);
  const options=document.createElement('details');options.id='canvas-options';options.className='canvas-options';options.innerHTML='<summary aria-label="画布选项" title="画布选项">⋯</summary><div class="options-body"></div>';
  options.firstElementChild.addEventListener('click',()=>{if(!options.open)properties.hidden=true;});
  options.addEventListener('toggle',()=>{if(options.open)properties.hidden=true;});
  const content=options.lastElementChild;
  content.append($('collision').closest('label'));
  const brushPreview=document.createElement('details');brushPreview.id='brush-preview';brushPreview.innerHTML='<summary>拼接预览（高级）</summary><div id="brush-tiles"></div>';content.append(brushPreview);
  for(const id of ['terrain-appearance','curve-template']){const el=$(id),label=document.createElement('label');label.textContent={'terrain-appearance':'地形外观', 'curve-template':'曲线形状'}[id];label.append(el);content.append(label);}
  const extend=$('extend');extend.classList.remove('full');extend.textContent='扩建一屏';
  extend.setAttribute('aria-label','向右扩建一屏');extend.title='向右扩建一屏，可撤销';
  $('fit').after(extend);
  const precision=document.createElement('details');precision.id='precision-placement';precision.innerHTML='<summary>按格放置</summary>';
  const oldPlacement=$('apply-cell').closest('section');precision.append(oldPlacement);content.append(precision);shell.append(options);
  const exportButton=$('export-pack');exportButton.textContent='场景资源 ZIP';
  const downloads=document.createElement('details');downloads.id='download-menu';
  downloads.innerHTML='<summary>下载</summary><div class="download-options"></div>';
  const choices=downloads.lastElementChild, mapDownload=$('save');
  mapDownload.classList.remove('primary');mapDownload.textContent='地图 JSON';
  choices.append(mapDownload,exportButton);
  choices.addEventListener('click',event=>{if(event.target.closest('button'))downloads.open=false;});
  $('open').after(downloads);
  $('save-state').setAttribute('role','status');
  const previewCamera=document.createElement('button');previewCamera.id='preview-camera';previewCamera.className='play-camera-button';
  previewCamera.textContent='自由镜头';previewCamera.setAttribute('aria-pressed','false');
  document.querySelector('.file-actions').append(previewCamera,$('preview'));legacy.append($('game-frame').closest('label'));
  for (const [name, label] of Object.entries({ select: '选择 V', paint: '画刷 B', erase: '擦除 E', curve: '曲线 C', pan: '平移 H' })) {
    const tool = iconize(document.querySelector(`[data-tool="${name}"]`), name, label);
    const caption = document.createElement('span');
    caption.className = 'tool-caption';
    caption.textContent = label.split(' ')[0];
    tool.append(caption);
  }
  document.querySelector('[data-tool="curve"]').title='曲线 C：双击曲线边缘加点，拖动圆点调整地形';
  document.querySelector('[data-tool="select"]').title='选择 V：拖动物体或整块地形；已连接的地形一起移动。按住 Ctrl 拖动素材可按格移动。';
  $('insert-curve-point').title='在所选点右侧插入一点；也可直接双击曲线边缘加点';
  iconize($('undo'),'undo','撤销');iconize($('redo'),'redo','重做');
  document.querySelector('.toolbar').append(options);
  document.querySelector('.navigator')&&legacy.append(document.querySelector('.navigator'));
  document.querySelector('.canvas-help')?.remove();if(document.querySelector('.library-note'))legacy.append(document.querySelector('.library-note'));document.querySelector('.library>p')?.remove();
  const status=$('status');status.classList.add('canvas-toast');shell.append(status);legacy.append(document.querySelector('.statusbar'));
  const target=document.createElement('div');target.id='placement-target';target.hidden=true;shell.append(target);
  const tabs=document.querySelector('.palette-tabs'),curves=document.createElement('button');curves.id='tab-curves';curves.textContent='曲线';curves.setAttribute('aria-pressed','false');tabs.append(curves);
  $('tab-terrain').textContent='画刷';
  const files=document.querySelector('.file-actions'),libraryButton=button('library','模块库',event=>toggleDrawer('library',event)),layersButton=button('layers','图层面板',event=>toggleDrawer('layers',event));
  const library = document.querySelector('.library');
  library.id = 'module-library';
  const drawers = { library: { panel: library, trigger: libraryButton }, layers: { panel: inspector, trigger: layersButton } };
  const narrow = matchMedia('(max-width:900px)');
  for (const { panel, trigger } of Object.values(drawers)) {
    panel.tabIndex = -1;
    trigger.setAttribute('aria-controls', panel.id);
  }
  function setDrawer(name, open) {
    document.body.classList.toggle('show-' + name, open);
    drawers[name].trigger.setAttribute('aria-expanded', String(open));
  }
  function closeDrawers(){setDrawer('library',false);setDrawer('layers',false);}
  function toggleDrawer(name, event) {
    const open = !document.body.classList.contains('show-' + name);
    closeDrawers();
    setDrawer(name, open);
    if (open && event.detail === 0) drawers[name].panel.focus();
  }
  files.prepend(libraryButton);files.append(layersButton);closeDrawers();
  window.addEventListener('pointerdown',event=>{
    if(!downloads.contains(event.target))downloads.open=false;
    if(!narrow.matches||!document.body.matches('.show-library,.show-layers')||event.target.closest('.library,.inspector')||libraryButton.contains(event.target)||layersButton.contains(event.target))return;
    closeDrawers();if(event.target.closest('#canvas-host')){event.preventDefault();event.stopPropagation();}
  },true);
  window.addEventListener('focusin', event => {
    if (!narrow.matches || event.target.closest('dialog')) return;
    for (const [name, { panel, trigger }] of Object.entries(drawers)) {
      if (!panel.contains(event.target) && !trigger.contains(event.target)) setDrawer(name, false);
    }
  });
  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.isComposing || event.target.closest('dialog')) return;
    const drawer = Object.values(drawers).find(({ trigger }) => trigger.getAttribute('aria-expanded') === 'true');
    if (drawer || options.open || downloads.open || !properties.hidden) {
      event.preventDefault();
      const focus = drawer?.trigger ?? (options.open ? options.firstElementChild : downloads.open ? downloads.firstElementChild : propertiesTrigger);
      closeDrawers();
      properties.hidden = true;
      options.open = downloads.open = false;
      focus?.focus();
    }
  });
  narrow.addEventListener('change',closeDrawers);
  return {properties,floating,curve,legacy,closeDrawers,revealLibrary(){if(innerWidth<=900){closeDrawers();setDrawer('library',true);}}};
}
export function friendlyAsset(id){const s=id.replace(/^scene\./,'');const names={'foreground.left':'左侧前景','foreground.right':'右侧前景','middle.left':'左侧中景','middle.right':'右侧中景','sky.actual':'天空','hills.actual':'远山','citadel.actual':'古城','valley.actual':'谷地','platform.actual':'悬浮平台','platform.center':'中央平台','platform.platform.center':'中央平台组合','ground.flat':'平地组合','ground.steps':'台阶组合','ground.gap':'缺口组合'};return names[s]??s.replaceAll(/[._-]/g,' ');}

// Runs inside the acceptance page, with the same runtime used by all 16 types.
window.pilotGallery=(width,height,widths)=>{
  const h=window.harness;h.clear();h.app.renderer.resize(width,height);const portrait=width<height;
  const label=(value,x,y,size=16)=>{const t=h.skin.label(value,width-48,{fontSize:size});t.position.set(x,y);h.app.stage.addChild(t);};
  label('林野 UI · S03 组件试验',24,18,24);label('9 个真实候选纹理 · 4 类组件 · 状态与尺寸核对',24,52,14);
  const columns=portrait?1:3,cell=portrait?width-48:(width-72)/3;
  const gallery=[];
  for(const [i,requested]of widths.entries()){
    const x=24+(i%columns)*(cell+12),y=88+Math.floor(i/columns)*310,w=Math.min(requested,cell);
    label(`组件宽度 ${w}`,x,y);
    for(const[at,type,props,sizeY]of[[32,'Switch',{label:'音乐',checked:i%2===1},52],[100,'Slider',{showValue:false,value:25+i*25},64],[170,'ProgressBar',{showValue:true,value:25+i*25},56]]){
      const n=h.make(type,{props,size:{width:w,height:sizeY}});n.root.position.set(x,y+at);gallery.push({type,node:n,width:w});
    }
  }
  const y=portrait?1040:365,w=portrait?width-48:width-48;
  label('ScrollView · 滚轮与滚动条拖动',24,y);
  const scroll=h.make('ScrollView',{size:{width:Math.min(420,w),height:180}});scroll.root.position.set(24,y+32);gallery.push({type:'ScrollView',node:scroll,width:Math.min(420,w)});
  h.runtime.flush();window.pilotNodes=gallery;
  return gallery.map(x=>({type:x.type,width:x.width,state:x.node.readState()}));
};

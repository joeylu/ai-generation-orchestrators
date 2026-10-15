import {planningClient} from './planning-client.mjs';
// Explicit offline fixture producer, never a model response or model success record.
export async function actionFixture(example,catalog,config) {
  const session=await planningClient().prepare({request:{requestVersion:'0.1',id:example.id,target:'pixi',text:example.request},catalog});
  return {session,intent:{panelIntentVersion:'0.12',contextSha256:session.context.sha256,unresolved:[],panel:{id:example.id,title:example.title,
    themeKey:config.themeKey,panelSurface:null,layout:{width:null,canvasWidth:null,canvasHeight:null,maxHeight:null,overflow:example.overflow??'error'},
    body:{kind:'column',children:[{kind:'section',title:example.sectionTitle,actionLayout:null,
      rows:example.rows.map(r=>({...structuredClone(r),label:r.kind==='text'&&!r.label?r.text:r.label,sourceRef:'request',icon:null}))}]}}}};
}

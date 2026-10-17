import {panelOrientations} from './orientation.mjs';
import Ajv from 'ajv';
import {planningClient} from './planning-client.mjs';
import {settingsDocument} from './settings.mjs';

const fail=(code,message)=>{throw Object.assign(new Error(message),{code:`panel.intent-${code}`});};

// A deliberately bounded preset adapter. Unsupported semantics must not disappear.
export async function validateSettingsResponse(sessionInput,intentInput) {
  const session=await planningClient().verify(sessionInput);
  const intent=structuredClone(intentInput);
  const validate=new Ajv({strict:false,allErrors:true}).compile(session.responseSchema);
  if(!validate(intent))fail('schema',JSON.stringify(validate.errors));
  return {session,intent};
}
export async function settingsFromIntent(sessionInput,intentInput,policy,layout,ctx) {
  const {session,intent}=await validateSettingsResponse(sessionInput,intentInput);
  if(policy.version!=='1.0'||!['0.3','0.12'].includes(policy.intentVersion)||intent.panelIntentVersion!==policy.intentVersion)
    fail('version','Settings conversion supports explicitly mapped native intent 0.3 or 0.12.');
  if(intent.unresolved.length||!intent.panel)fail('unresolved','Resolve planning questions before compiling.');
  const p=intent.panel;
  if(p.themeKey!==policy.themeKey||p.panelSurface!==null)fail('theme','Explicit theme mapping required; asset overrides are unsupported.');
  if(typeof policy.closeLabel!=='string'||!policy.closeLabel.trim())fail('policy','Preset close label is required.');
  if(['width','canvasWidth','canvasHeight','maxHeight'].some(k=>p.layout[k]!==null)||!['error','scroll'].includes(p.layout.overflow))
    fail('layout','Use preset dimensions and overflow:error or scroll.');
  const modern=intent.panelIntentVersion==='0.12';
  const tabbed=modern&&p.body.kind==='tabs';
  if(tabbed&&(p.body.sourceRef!=='request'||p.body.pages.some(page=>page.sourceRef!=='request')||p.body.pages.filter(page=>page.initial).length!==1))fail('tabs','Invalid tab source or initial selection');
  const pages=tabbed?p.body.pages:null;
  if(tabbed&&pages.some(page=>page.body.kind!=='column'||page.body.children.some(section=>section.kind!=='section')))fail('layout','Tabs require columns of sections');
  const body=tabbed?{kind:'column',children:pages.flatMap(page=>page.body.children)}:p.body;
  if(body.kind!=='column'||!body.children.length||body.children.some(section=>section.kind!=='section')||(!modern&&(body.children.length!==1||body.children[0].title!=='')))
    fail('layout','This preset accepts a column of sections; legacy intents require one untitled section.');
  if(modern&&body.children.some(section=>section.actionLayout!==null))fail('layout','Explicit action layout is unsupported in this settings preset.');
  const ids=new Set();
  if(policy.shape){const shape={};for(const r of body.children.flatMap(s=>s.rows))shape[r.kind]=(shape[r.kind]??0)+1;if(tabbed||body.children.length!==1||Object.keys(shape).length!==Object.keys(policy.shape).length||Object.entries(policy.shape).some(([k,n])=>shape[k]!==n))fail('preset-shape','Selected preset requires its original control types and counts.');}
  const fields=body.children.flatMap(section=>section.rows).map((input,index)=>{
    const row=modern?{...input,id:'row'+index}:input;
    if(ids.has(row.id))fail('duplicate',`Repeated row: ${row.id}`);ids.add(row.id);
    if(!['switch','slider','select'].includes(row.kind)||row.icon!==null)fail('unsupported',`Unsupported row: ${row.kind}`);
    if(policy.recipes?.[row.kind]!==row.recipeKey)fail('recipe',`Explicit recipe mapping required: ${row.recipeKey}`);
    if(modern?row.sourceRef!=='request':(!row.sourceQuote.trim()||!session.context.request.text.includes(row.sourceQuote)))fail('evidence',`Missing request evidence: ${row.id}`);
    const field={id:row.id,type:row.kind,label:row.label,enabled:row.enabled};
    if(row.kind==='switch')return {...field,value:row.initial};
    if(row.kind==='slider') {
      if(row.prefix!==''||row.suffix!=='')fail('unsupported','Slider prefix/suffix needs an explicit renderer adapter.');
      if(![row.min,row.max,row.step,row.initial].every(Number.isFinite)||row.min>=row.max||row.step<=0||row.initial<row.min||row.initial>row.max)
        fail('range','Invalid slider range or initial value.');
      return {...field,value:row.initial,min:row.min,max:row.max,step:row.step};
    }
    if(row.options.filter(o=>o.initial).length!==1||new Set(row.options.map(o=>o.label)).size!==row.options.length)
      fail('options','Select requires unique labels and exactly one initial choice.');
    const options=row.options.map((o,i)=>({id:`option${i}`,label:o.label,enabled:true}));
    return {...field,options,value:options[row.options.findIndex(o=>o.initial)].id};
  });
  let next=0;
  const groups=body.children.map((section,index)=>({id:'group'+index,title:section.title,fieldIds:section.rows.map(()=>fields[next++].id)}));
  let groupIndex=0;
  const tabs=tabbed?pages.map((page,index)=>({id:'tab'+index,label:page.label,initial:page.initial,groupIds:page.body.children.map(()=>groups[groupIndex++].id)})):null;
  const content={version:'1.0',id:p.id,title:p.title,closeLabel:policy.closeLabel,...(p.layout.overflow==='scroll'?{overflow:'scroll'}:{}),...(tabbed?{tabs,tabsEnabled:p.body.enabled,groups}:modern?(groups.length===1?{sectionTitle:groups[0].title}:{groups}):{}),fields};
  const documents=Object.fromEntries(panelOrientations(ctx.orientation).map(canvas=>[canvas,settingsDocument(content,layout,canvas,ctx)]));
  return {content,documents,provenance:{sessionSha256:session.sha256,contextSha256:session.context.sha256,intentVersion:intent.panelIntentVersion,
    presetChoices:{closeLabel:policy.closeLabel,themeMapping:policy.themeKey,skinBinding:structuredClone(ctx.binding)},modelExecution:'not-performed-by-adapter'}};
}

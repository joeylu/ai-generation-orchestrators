#!/usr/bin/env node
/** Form and page composition acceptance data. No model calls. */
import {createOutputDirectory,readJson,writeNewJson} from '../src/io.mjs';
import {createPlanningContext} from '../src/planning-context.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {createPanelBundle} from '../src/panel-bundle.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {composePanelBundles} from '../src/panel-composition.mjs';
import {formRequest,formIntent} from '../examples/forms-v1/fixture.mjs';
export async function createFormsFixtures(core) {
  const catalog=await readJson(new URL('../examples/modern-mint-forms.catalog.json',import.meta.url));
  const context=await createPlanningContext(formRequest,catalog), proposal=await materializePanelIntent(context,formIntent(context));
  const role=await createPanelBundle(proposal.spec,catalog,core);
  const details=structuredClone(role.spec);details.id='profile-form';details.title='角色资料';
  details.sections[0].title='资料';details.sections[0].rows[0].label='备注';
  details.sections[0].rows[0].validation.required=false;details.sections[0].rows[0].validation.minLength=0;
  details.sections[0].rows[0].placeholder='可留空';details.state[0].maxLength=64;
  details.sections[0].rows.push({...details.sections[0].rows[0],id:'code',label:'确认码',bind:'code',event:'profile.code',inputType:'password',readOnly:false});
  details.state.push({id:'code',type:'string',maxLength:12,initial:'secret'});
  details.sections[0].rows.push({...details.sections[0].rows[0],id:'region',label:'区域',bind:'region',event:'profile.region',readOnly:true});
  details.state.push({id:'region',type:'string',maxLength:12,initial:'中国'});
  // Test the old kinds with new protocol and independent pages in the same native Prefab.
  const old=await readJson(new URL('../examples/settings-controls.panel.json',import.meta.url));
  details.sections.push(...old.sections.map(section=>({...section,id:'legacy-'+section.id})));
  details.state.push(...old.state);
  details.sections.at(-1).rows.push({id:'loading',kind:'progress',recipe:{id:'settings.progress',version:'0.1.0'},label:'加载进度',bind:'loading',format:{mode:'percent',fractionDigits:1}});
  details.state.push({id:'loading',type:'progress',initial:0.375,max:1});
  details.layout.body.children.push(...details.sections.slice(1).map(section=>({kind:'section',sectionId:section.id,width:'fill'})));
  details.provenance={kind:'programmatic-fixture',description:'Explicit acceptance-only form data; no model proposal.',assumptions:[]};
  const profile=await createPanelBundle(details,catalog,core);
  const composition=await composePanelBundles({panelCompositionRequestVersion:'0.1',id:'forms-verification',title:'角色表单',sources:[{namespace:'role',bundleSha256:role.sha256},{namespace:'profile',bundleSha256:profile.sha256}],layout:'tabs',width:null,canvasWidth:null,canvasHeight:null,maxHeight:480,surfaceFrom:null},[role,profile],core);
  return {context,proposal,role,profile,composition};
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/write-forms-fixture.mjs')){
  try{
    const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--output')throw Error('FORMS_FIXTURE_ARGUMENTS');
    const data=await createFormsFixtures(await loadWorkspaceCore()),output=await createOutputDirectory(args[1]);
    for(const [name,value]of Object.entries(data))await writeNewJson(output,name+'.json',value);
    await writeNewJson(output,'panel.bundle.json',data.composition.bundle);
    console.log(JSON.stringify({status:'PROGRAMMATIC_FIXTURE_BUILT',modelCalls:0,panelSha256:data.composition.bundle.sha256}));
  }catch(error){console.error(JSON.stringify({status:'FAILED',code:error.code??error.message}));process.exitCode=1;}
}

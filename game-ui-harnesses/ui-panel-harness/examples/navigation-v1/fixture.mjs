import {focusedLayoutFixtures,layoutSettings} from '../focused-layout-v1/fixture.mjs';
import {semanticSettingsFixture} from '../semantic-controls-v1/fixture.mjs';
import {arrangeIntentSpec} from '../../src/panel-intent.mjs';
import {createPanelBundle} from '../../src/panel-bundle.mjs';
import {composePanelBundles} from '../../src/panel-composition.mjs';

/** Owned offline examples; these are never described as model-generated results. */
export async function navigationFixture(catalog,base,core,themeId='modern-blue-dark',width=640) {
  const fixtures=await focusedLayoutFixtures(catalog),theme=catalog.themes.find(t=>t.id===themeId);
  const form=structuredClone(fixtures.form);form.title='角色命名';
  const settings=semanticSettingsFixture(catalog,base);settings.title='声音设置';
  const help=structuredClone(fixtures.dialog);help.title='使用说明';
  help.sections[0].title='操作说明';help.sections[0].rows[0].text=help.sections[0].rows[0].text.repeat(7);
  const sources=[];
  for(const spec of [form,settings,help]){
    spec.theme={id:theme.id,version:theme.version};
    sources.push(await createPanelBundle(arrangeIntentSpec(spec,layoutSettings(),theme),catalog,core,
      spec===settings?{volume:65,muted:false,quality:'medium'}:undefined));
  }
  const composition=await composePanelBundles({panelCompositionRequestVersion:'0.1',id:'navigation-review',title:'游戏设置',
    sources:sources.map((b,i)=>({namespace:['form','settings','help'][i],bundleSha256:b.sha256})),
    layout:'tabs',width,canvasWidth:760,canvasHeight:640,maxHeight:420,surfaceFrom:null},sources,core);
  return {sources,composition,bundle:composition.bundle};
}

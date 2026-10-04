#!/usr/bin/env node
/** Reproducible all-capabilities native acceptance fixture. No model or image generation. */
import { readFile } from 'node:fs/promises';
import { readJson, createOutputDirectory, writeNewJson } from '../src/io.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { createPanelBundle } from '../src/panel-bundle.mjs';
import { digestBytes } from '../src/canonical.mjs';

try {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--output') throw new Error('UNITY_FIXTURE_ARGUMENTS');
  const spec = await readJson(new URL('../examples/layout-v1/settings.panel.json', import.meta.url));
  const catalog = await readJson(new URL('../examples/modern-mint-layout.catalog.json', import.meta.url));
  spec.id = 'unity-verification';
  spec.provenance = { kind: 'programmatic-fixture', description: 'Deterministic native acceptance sample: current values, all controls, disabled switch, selective reset, readonly text, sliced surface, and scroll. Not a model proposal.', assumptions: ['Acceptance-only business values and actions; the host owns actual game behavior.'] };
  const general = spec.sections.find(section => section.id === 'general');
  const rows = spec.sections.flatMap(section => section.rows);
  rows.find(row => row.id === 'notifications-row').enabled = false;
  const reset = rows.find(row => row.kind === 'button');
  reset.action.fields = reset.action.fields.filter(id => id !== 'notifications');
  general.rows.push({id:'version-row',kind:'text',recipe:{id:'settings.text',version:'0.1.0'},label:'版本',text:'1.0.0'});
  general.rows.push({id:'close-row',kind:'button',recipe:{id:'settings.button',version:'0.1.0'},label:'',buttonLabel:'关闭设置',enabled:true,event:'settings.closeRequested',action:{kind:'emit'}});
  const bytes = new Uint8Array(await readFile(new URL('../examples/custom-assets/panel-surface.png', import.meta.url)));
  const sha256 = await digestBytes(bytes), key = 'acceptance/panel-surface@1.0.0';
  spec.assets = {library:{id:'acceptance-assets',sha256},panelSurface:key,rowIcons:[]};
  const closure = {assetClosureVersion:'0.1',library:structuredClone(spec.assets.library),records:[
    {key,role:'shape',width:64,height:64,slice:{left:7,top:11,right:9,bottom:13},bytes:bytes.length,sha256},
  ]};
  const current = Object.fromEntries(spec.state.map(field=>[field.id,field.initial]));
  Object.assign(current,{volume:21,notifications:false,quality:'fine'});
  const core = await loadWorkspaceCore();
  const bundle = await createPanelBundle(spec,catalog,core,current,{closure,resources:[{path:`textures/${sha256}.png`,mime:'image/png',bytes}]});
  const output = await createOutputDirectory(args[1]);
  await writeNewJson(output,'panel.bundle.json',bundle);
  await writeNewJson(output,'fixture.json',{status:'PROGRAMMATIC_FIXTURE_BUILT',panelSha256:bundle.sha256,modelCalls:0,nativeEngines:'NOT_RUN'});
  process.stdout.write(JSON.stringify({status:'PROGRAMMATIC_FIXTURE_BUILT',panelSha256:bundle.sha256})+'\n');
} catch(error) {
  process.stderr.write(JSON.stringify({status:'FAILED',code:error.code??String(error.message).split(':')[0]})+'\n'); process.exitCode=1;
}

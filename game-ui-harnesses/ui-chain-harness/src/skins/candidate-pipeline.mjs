import {safePath} from './contract.mjs';
export function validateCandidateConfig(config){
  if(config.version!=='1.0'||!Number.isInteger(config.port)||config.port<1024||config.port>65535||!Array.isArray(config.skins)||!config.skins.length)throw Error('pipeline.config');
  const ids=new Set();
  for(const s of config.skins){
    if(!/^[a-z][a-z0-9-]*$/.test(s.id)||ids.has(s.id)||typeof s.label!=='string'||!s.label.trim()||(!s.profile&&typeof s.allowDifferentSourceTrial!=='boolean')||(s.profile&&s.baseline))throw Error('pipeline.skin');
    ids.add(s.id);
    for(const key of ['input',s.profile?'profile':'baseline'])if(!safePath(s[key])||!s[key].startsWith('work/'))throw Error('pipeline.input-path');
  }
  return config;
}
// Thin orchestration only: existing tools own localization, transforms and checks.
export async function buildCandidate(skin,command){
  const located=await command('locate','skin-locate.mjs',['--input',skin.input]);
  if(!located.directory||!['candidate','needs-review'].includes(located.status))throw Error('pipeline.locate-result');
  const trialArgs=['--report',located.directory+'/report.json','--input',skin.input,skin.profile?'--profile':'--baseline',skin.profile??skin.baseline];
  if(!skin.profile&&skin.allowDifferentSourceTrial)trialArgs.push('--allow-different-source-trial');
  const trial=await command('trial',skin.profile?'skin-metadata-draft.mjs':'skin-localization-trial.mjs',trialArgs);
  if(trial.status!=='experimental-candidate'||!trial.assembly)throw Error('pipeline.trial-result');
  const insetOutput=trial.assembly.replace(/\.json$/,'-content-insets.json');
  if(insetOutput===trial.assembly)throw Error('pipeline.assembly-path');
  const insets=await command('content-insets','skin-content-insets.mjs',['--config',trial.assembly,'--out',insetOutput]);
  if(!insets.directory)throw Error('pipeline.insets-result');
  const post=await command('postprocess','skin-postprocess.mjs',['build','--config',insets.directory]);
  if(post.status!=='checked-candidate'||!post.directory||!post.consumerDirectory)throw Error('pipeline.postprocess-result');
  return{ id:skin.id,label:skin.label,location:located.directory,trial:trial.directory,assembly:insets.directory,directory:post.directory,consumer:post.consumerDirectory,status:'awaiting-visual-review'};
}

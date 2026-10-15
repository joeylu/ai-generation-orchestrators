import {join} from 'node:path';
import {readSafe,hash,verifySkinPackage} from '../skins/package.mjs';
import {inspectConsumer} from '../runtime/consumer-tools.mjs';

const workFile=p=>typeof p==='string'&&/^work\/(?:[A-Za-z0-9_-]+\/)+[A-Za-z0-9_.-]+$/.test(p);
const workDirectory=p=>typeof p==='string'&&/^work\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(p);
const digest=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
// A runtime update selects a new checked consumer, never edits a completed DAG.
export async function upgradedConsumer(root,originalDirectory,selection,{verifySkin=verifySkinPackage}={}){
  if(!selection)return {directory:originalDirectory};
  if(!workFile(selection.file)||!digest(selection.sha256))throw Error('COMPONENT_UPGRADE_REFERENCE');
  const bytes=await readSafe(root,selection.file);
  if(hash(bytes)!==selection.sha256)throw Error('COMPONENT_UPGRADE_CHANGED');
  const record=JSON.parse(bytes);
  if(record.kind!=='ui_component_runtime_upgrade'||record.version!=='1.0'||!workDirectory(record.directory)||!workFile(record.checkFile)||!digest(record.checkSha256)||!digest(record.consumerSha256)||record.modelCalls!==0)throw Error('COMPONENT_UPGRADE_RECORD');
  const original=await inspectConsumer(originalDirectory);
  if(original.manifestSha256!==record.sourceConsumerSha256||original.manifest.manifestSha256!==record.skinSha256)throw Error('COMPONENT_UPGRADE_SOURCE');
  const directory=join(root,record.directory),consumer=await inspectConsumer(directory,record.consumerSha256);
  const skin=await verifySkin(join(directory,'skin'));
  if(skin.manifestSha256!==record.skinSha256||consumer.manifest.manifestSha256!==record.skinSha256)throw Error('COMPONENT_UPGRADE_SKIN');
  const checks=await readSafe(root,record.checkFile),report=JSON.parse(checks);
  if(hash(checks)!==record.checkSha256||report.kind!=='ui_consumer_relocation_check'||report.status!=='passed'||report.manifestSha256!==consumer.manifestSha256||report.sourceSkinSha256!==record.skinSha256||report.components!==16||report.publicFactory!=='passed'||!Array.isArray(report.results)||!report.results.length||report.results.some(r=>r.status!=='passed')||!Array.isArray(report.errors)||report.errors.length)throw Error('COMPONENT_UPGRADE_CHECK');
  return {directory,consumerSha256:consumer.manifestSha256};
}

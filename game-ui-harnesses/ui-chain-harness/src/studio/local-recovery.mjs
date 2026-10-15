import policy from '../../configs/local-recovery-policy.json' with {type:'json'};
export const localRecoveryPolicy=Object.freeze(policy);
if(policy.version!=='1.0'||!Number.isInteger(policy.maxAutomaticStarts)||policy.maxAutomaticStarts<1||policy.maxAutomaticStarts>10||!Number.isInteger(policy.maxBusyChecks)||policy.maxBusyChecks<1||policy.maxBusyChecks>180||!['retryDelayMs','busyDelayMs'].every(k=>Number.isInteger(policy[k])&&policy[k]>=1000&&policy[k]<=60000))throw Error('LOCAL_RECOVERY_POLICY_INVALID');
// Only explicit transient local OS failures are retryable. Never infer that an
// arbitrary command failure, quality rejection or provider result should retry.
export function localFailure(e){
 const tokens=[];
 function visit(value,depth=0){
  if(!value||depth>5)return;
  if(typeof value==='string'){if(value.length<160)tokens.push(value);try{visit(JSON.parse(value),depth+1);}catch{}return;}
  for(const key of ['code','message','detail','cause'])visit(value[key],depth+1);
 }
 visit(e);const has=pattern=>tokens.some(t=>pattern.test(t));
 const result=(code,message,retryable=false)=>({code,message,retryable});
 if(has(/LOCAL_LOCK_UNKNOWN/))return result('LOCAL_LOCK_UNKNOWN','无法确认旧任务锁的归属，已保留文件，需要检查本地任务。');
 if(has(/tools-changed|TOOLS_CHANGED/))return result('LOCAL_TOOLS_CHANGED','处理工具已更新，旧任务不能自动续跑；可手动继续，使用原图创建新的处理记录。');
 if(has(/artifact-changed|source-digest|receipt-binding|INVALID_TASK|BATCH_CHANGED|ARTIFACT_CHANGED|LOCAL_EVIDENCE_CHANGED/))return result('LOCAL_EVIDENCE_CHANGED','源文件或处理记录校验不一致，已停止；请检查原始文件，不能自动覆盖。');
 if(has(/skin\.material-atlas-input|material-atlas\.input-binding/))return result('LOCAL_EVIDENCE_CHANGED','材质图集与冻结计划的校验不一致，已保留原图和已有组件，需要检查来源记录。');
 if(has(/skin\.material-atlas|skin\.material-template|skin\.material$/))return result('LOCAL_MATERIAL_CHECK','材质提取或绑定检查未通过，原图与基础组件已保留；请查看材质检查记录后继续。');
 const slice=tokens.map(t=>/^metadata\.(?:slices|ends)-override-required: ([a-z][a-z0-9.-]{0,60})$/.exec(t)).find(Boolean);
 if(slice)return result('LOCAL_QUALITY_CHECK','部件 '+slice[1]+' 的边框与内部区域未能可靠分离，九宫格切线检查暂停。原始图集已保留，无需重新生成；重复继续不会修复同一切线问题。');
 const crop=tokens.map(t=>/^metadata\.(proposal-unresolved|overlap): ([a-z][a-z0-9.-]{0,60})$/.exec(t)).find(Boolean);
 if(crop)return result('LOCAL_QUALITY_CHECK','部件 '+crop[2]+(crop[1]==='overlap'?' 的实际裁切区域与其他部件重叠':' 的素材归属未能确定')+'，已暂停拆分。原始图集已保留，无需重新生成。');
 if(has(/check-failed|localization|metadata|slice|skin\.(empty|outside)|CHECK_FAILED|LOCAL_QUALITY_CHECK/))return result('LOCAL_QUALITY_CHECK','素材定位、切分或组件检查未通过，原始结果已保留，需要查看检查记录。');
 if(has(/^(EBUSY|ETIMEDOUT|LOCAL_COMMAND_TIMEOUT|LOCAL_TRANSIENT)$/))return result('LOCAL_TRANSIENT','本地处理暂时受阻，将从已通过的步骤自动继续。',true);
 return result('LOCAL_PROCESSING_FAILED','本地处理未完成，原始结果已保留；请查看任务记录后继续。');
}
export function automaticRecoveryDecision(flow,batchSha256,policy=localRecoveryPolicy){
 const recovery=flow.localRecovery;
 if(recovery?.batchSha256&&recovery.batchSha256!==batchSha256)return 'batch-changed';
 if(flow.phase==='components-ready')return 'complete';
 if(flow.phase==='processing-failed'&&recovery?.failure?.retryable!==true)return 'stopped';
 if((recovery?.automaticStarts??0)>=policy.maxAutomaticStarts)return 'limit';
 return 'continue';
}

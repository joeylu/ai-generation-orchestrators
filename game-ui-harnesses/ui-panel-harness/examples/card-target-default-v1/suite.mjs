import {CARD_CONTENT_CLOSEOUT_SUITE,cardContentCloseoutFixture} from '../card-content-closeout-v1/suite.mjs';
const base=CARD_CONTENT_CLOSEOUT_SUITE.find(item=>item.id==='G14');
/** Two independent short requests; no driver specimen is sent to a model. */
export const CARD_TARGET_DEFAULT_SUITE=Object.freeze([base,Object.freeze({...base,id:'G14M',request:{...base.request,id:'G14M',text:'做个手机任务列表面板'}})]);
export function cardTargetDefaultFixture(context,item,referenceIntent){
 const intent=cardContentCloseoutFixture(context,{...item,id:'G14'},referenceIntent);
 if(item.id==='G14M')intent.panel.body.kind='column';
 return intent;
}

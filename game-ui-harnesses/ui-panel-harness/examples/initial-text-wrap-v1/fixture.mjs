/** Authored initial-generation intent. No model or natural-language pass is claimed. */
import {roleRequest,roleIntent} from '../adaptive-v1/fixture.mjs';
import {createPlanningContext} from '../../src/planning-context.mjs';
export const initialBody = '名字会展示给其他玩家，请选择一个喜欢的角色名。确认前可以继续修改，取消将保留本次输入。\n\n请勿使用真实姓名、联系方式或令人不适的词语。这里是第二段说明，正文会根据可用宽度换行，后面的输入框和按钮随内容高度下移。\n\nEnglish words stay readable. A long address can break safely: https://example.test/'+'long-address-'.repeat(10)+' 👩‍👩‍👧‍👦';
export const initialRequest = {...roleRequest,id:'initial-body',text:'生成角色命名界面，包含命名说明正文、角色名输入框、确认和取消按钮。角色名初始为空，必填，至少2个字符，最多12个字符。说明正文原样展示下面三段，自动换行。面板宽480，高度上限560，确认提交角色名，取消仅通知。正文：\n'+initialBody};
export function initialWrapIntent(context, text=initialBody) {
  const intent=roleIntent(context);intent.panelIntentVersion='0.10';intent.panel.layout.width=480;intent.panel.layout.maxHeight=560;
  const section=intent.panel.body.children[0];section.actionLayout=null;
  section.rows.unshift({kind:'text',label:'命名说明',recipeKey:'settings.text@0.1.0',sourceRef:'request',icon:null,text,wrap:'word'});
  section.rows[2].submitRows=[1];return intent;
}
export async function initialWrapFixture(catalog){const context=await createPlanningContext(initialRequest,catalog,undefined,{actionLayouts:true,textWrap:true});return {context,intent:initialWrapIntent(context)};}

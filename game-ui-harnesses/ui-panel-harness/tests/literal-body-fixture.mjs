/** Exact failed request reproduced with authored native responses; no inference. */
import {readFile} from 'node:fs/promises';
import {createPlanningContext} from '../src/planning-context.mjs';
import {initialWrapIntent} from '../examples/initial-text-wrap-v1/fixture.mjs';
export const bodyCopy='角色名会显示在排行榜和好友列表中。确认之前可以继续修改；取消只通知宿主，并保留本次输入。';
export const bodyRequest={requestVersion:'0.1',id:'navigation-role',target:'pixi',text:'做一个角色命名界面，标题为“角色命名”，使用浅色紫色主题。画布960×720，面板宽480，高度上限560。只包含一个“创建角色”分组，依次是：命名说明正文、角色名输入框、确认和取消按钮。命名说明正文按原文完整展示并自动换行：'+bodyCopy+' 角色名初始为空，启用且可编辑，普通单行文本输入，必填，至少2个字符，最多12个字符，占位文字“请输入角色名”。确认按钮采用主要按钮样式，提交角色名；取消按钮采用次要按钮样式，仅通知宿主，保留本次输入。使用程序化底板，不使用图标或背景纹理，不添加其他控件。'};
export async function bodyFixture(request=bodyRequest){
 const catalog=JSON.parse(await readFile(new URL('../examples/modern-navigation.catalog.json',import.meta.url),'utf8'));
 const context=await createPlanningContext(request,catalog,undefined,{actionLayouts:true,textWrap:true}),intent=initialWrapIntent(context,bodyCopy);
 intent.panel.title='角色命名';intent.panel.themeKey='modern-violet-light@0.7.0';intent.panel.layout.canvasWidth=960;intent.panel.layout.canvasHeight=720;
 const section=intent.panel.body.children[0];section.title='创建角色';section.rows[0].label='命名说明正文';section.rows[2].recipeKey='settings.button.primary@0.1.0';section.rows[3].recipeKey='settings.button.secondary@0.1.0';
 return{context,intent};
}

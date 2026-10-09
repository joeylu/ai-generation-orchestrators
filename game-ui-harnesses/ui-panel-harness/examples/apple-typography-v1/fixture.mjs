export const typefaces=Object.freeze([
  {id:'noto',title:'Noto Sans SC',family:'Segoe UI, Noto Sans SC, Microsoft YaHei UI, sans-serif',platformFamily:'Noto Sans SC',caption:'中文改用 Noto Sans SC，数字与英文保持 Segoe UI。'},
  {id:'deng',title:'等线',family:'Segoe UI, DengXian, Microsoft YaHei UI, sans-serif',platformFamily:'DengXian',caption:'中文改用等线，数字与英文保持 Segoe UI。'},
]);
export const typographySamples=Object.freeze([
  {id:'audio',title:'声音设置',caption:'查看标题、设置项、百分比与按钮。'},
  {id:'profile',title:'角色信息',caption:'查看资料标签、中英文标点和数字。'},
  {id:'exit',title:'退出游戏',caption:'查看标题、连续正文与操作文字。'},
]);

/** Changes one environment font family only, over the existing local suite. */
export function typographyStudy(source,fontId){
  const face=typefaces.find(face=>face.id===fontId);
  if(!face)throw new Error('TYPOGRAPHY_FACE');
  const id=source.spec.id==='usage-settings'?'audio':source.spec.id?.replace(/^sample-/,'');
  if(!typographySamples.some(sample=>sample.id===id)||source.spec.provenance.kind!=='programmatic-fixture'
    ||(id==='exit'?(source.compilerVersion!=='0.18.0'||source.catalog.id!=='apple-dialog-polish-v1')
      :(source.compilerVersion!=='0.24.0'||source.catalog.id!=='apple-suite-polish-v1')))throw new Error('TYPOGRAPHY_FIXTURE_ONLY');
  const spec=structuredClone(source.spec),catalog=structuredClone(source.catalog);
  const theme=catalog.themes.find(theme=>theme.id===spec.theme.id&&theme.version===spec.theme.version);
  if(!theme||theme.tokens.fontFamily!=='Segoe UI, Microsoft YaHei UI, sans-serif')throw new Error('TYPOGRAPHY_SOURCE');
  catalog.id=`apple-typography-${fontId}`;theme.version='0.17.0';theme.tokens.fontFamily=face.family;
  spec.theme={id:theme.id,version:theme.version};
  return{spec,catalog};
}

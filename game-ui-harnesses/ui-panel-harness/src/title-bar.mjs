/** Portable styling of the existing panel heading, independent of body layout. */
export const TITLE_BAR_KEYS = Object.freeze(['horizontalAlign','verticalAlign','backgroundColor','textColor','cornerRadius','fontSize','padding']);
export function checkTitleBar(value, fail, path = '$.titleBar') {
  if (value === null) return;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== TITLE_BAR_KEYS.length || TITLE_BAR_KEYS.some(key => !Object.hasOwn(value,key))) fail('title-bar-fields',path,'complete title bar style required');
  if (![null,'left','center','right'].includes(value.horizontalAlign)) fail('title-bar-align',path+'.horizontalAlign','null, left, center or right required');
  if (![null,'top','middle','bottom'].includes(value.verticalAlign)) fail('title-bar-align',path+'.verticalAlign','null, top, middle or bottom required');
  for (const key of ['backgroundColor','textColor']) if (value[key] !== null && (typeof value[key] !== 'string' || !/^#[0-9a-fA-F]{6}$(?![\s\S])/u.test(value[key]))) fail('title-bar-color',path+'.'+key,'null or opaque #RRGGBB required');
  for (const [key,min,max] of [['cornerRadius',0,128],['fontSize',8,96],['padding',0,64]]) {
    if (key !== 'padding' && value[key] === null) continue;
    if (!Number.isSafeInteger(value[key]) || value[key] < min || value[key] > max) fail('title-bar-range',path+'.'+key,`integer ${min}..${max} required`);
  }
}

/** New native title alignment only; all older node exports retain their exact shape. */
export function nativeTitleAlignment(style) {
  return ({top:'Upper',middle:'Middle',bottom:'Lower'})[style.verticalAlign ?? 'middle'] + ({left:'Left',center:'Center',right:'Right'})[style.horizontalAlign ?? 'left'];
}

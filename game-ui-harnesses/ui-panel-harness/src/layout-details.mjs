/** Only content layout fields; fixed frame dimensions have their own operations. */
export const LAYOUT_DETAIL_KEYS=Object.freeze([
  'padding','gap','labelWidth','rowHeight','titleHeight','sectionTitleHeight','overflow','body',
]);
export function checkLayoutDetails(details,fail,path) {
  if(!details||typeof details!=='object'||Array.isArray(details))fail('layout-details',path,'Layout details object required');
  const keys=Object.keys(details);
  if(keys.length!==LAYOUT_DETAIL_KEYS.length||LAYOUT_DETAIL_KEYS.some(key=>!Object.hasOwn(details,key)))fail('layout-details',path,'Exact layout detail keys required; null preserves the current value');
}

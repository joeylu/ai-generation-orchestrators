import assert from 'node:assert/strict';
/** Explicit local icon replacement only; ordinary Skill reviews retain exact asset equality. */
export function assertRowIconStudy(before, after, expected) {
  assert.equal(before.compilerVersion,'0.21.0');assert.equal(after.compilerVersion,'0.22.0');
  for(const key of ['state','bindings','actions'])assert.deepEqual(after[key],before[key]);
  assert.deepEqual({...after.spec,theme:before.spec.theme,assets:before.spec.assets},before.spec);
  assert.equal(before.spec.assets.panelSurface,null);assert.equal(after.spec.assets.panelSurface,null);
  assert.deepEqual(after.spec.assets.rowIcons,expected);
  assert.deepEqual(after.spec.assets.rowIcons.map(item=>item.rowId),before.spec.assets.rowIcons.map(item=>item.rowId));
  assert.deepEqual(after.assetClosure.records.map(item=>item.key),expected.map(item=>item.asset).sort());
  assert(after.assetClosure.records.every(item=>item.role==='icon'&&item.slice===null));
  assert.deepEqual({...after.catalog,id:before.catalog.id,themes:before.catalog.themes},before.catalog);
  assert.equal(after.catalog.themes.length,1);
  const theme=after.catalog.themes[0],old=before.catalog.themes[0];
  assert.equal(theme.iconStyle,'plain-v1');assert.equal(theme.surfaceStyle,'grouped-v1');
  const {iconStyle,...rest}=theme;assert.deepEqual({...rest,version:old.version},old);
}

import { validateBackgroundPackage } from '../slicing/package.mjs';
import { fail, indexDocument } from './document.mjs';

// Pure authoring operation: one shared asset, one instance reference. Panel
// dimensions/content stay intact; all validation/rendering commits atomically.
export function attachBackground(input, id, value) {
  const pack = validateBackgroundPackage(value), doc = structuredClone(input);
  const { nodes, parents } = indexDocument(doc), target = nodes.get(id);
  if (!target?.recipeRef.startsWith('panel@')) fail('background.target', '请选择 Panel 后导入背景。');
  for (let n = target; n; n = parents.get(n.id)?.node)
    if (n.locked) fail('edit.locked', '请先解锁所选 Panel 及其父级。');
  const assets = doc.panelBackgrounds ??= {};
  let ref = Object.keys(assets).find(k => JSON.stringify(assets[k]) === JSON.stringify(pack.asset));
  if (!ref) {
    let i = 1; while (Object.hasOwn(assets, `background-${i}`)) i++;
    ref = `background-${i}`; assets[ref] = pack.asset;
  }
  if(doc.version!=='0.3')doc.version = '0.2';
  target.props.backgroundRef = ref;
  target.props.pixelsPerUnitMultiplier = pack.defaultMultiplier;
  return doc;
}

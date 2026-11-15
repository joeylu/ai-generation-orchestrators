import { createSceneView, loadTerrainMaterial } from 'ai-scene-kit-contracts/pixi';

// Integrate inside the consumer's own resource-loading and scene lifecycle.
// `scene` must already have passed the offline export verifier. The consumer
// supplies actual Pixi textures; this example never fetches arbitrary URLs.
export async function mountSceneKit({ scene, loadSourceTexture, world, viewport }) {
  const sources = new Map(scene.layers.flatMap(layer => layer.nodes).map(node => [node.source.sha256, node.source]));
  const textures = new Map(await Promise.all([...sources].map(async ([sha256, source]) => [sha256, await loadSourceTexture(source)])));
  const material = await loadTerrainMaterial(scene.terrainMaterial, item => loadSourceTexture(item.source));
  const view = createSceneView({ resolveTexture: (_assetId, source) => textures.get(source.sha256), resolveCurveMaterial: () => material });
  view.update(scene); world.addChild(view.root);
  const cameraChanged = () => view.setCamera({ center: viewport.center, visible: viewport.getVisibleBounds(), preview: true });
  viewport.on('moved', cameraChanged); viewport.on('zoomed', cameraChanged); cameraChanged();
  return { view, dispose() { viewport.off('moved', cameraChanged); viewport.off('zoomed', cameraChanged); view.destroy(); } };
}

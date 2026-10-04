import controlView from '../adapters/unity/Runtime/PanelControlView.cs?raw';
import controller from '../adapters/unity/Runtime/PanelController.cs?raw';
import documentSource from '../adapters/unity/Runtime/PanelDocument.cs?raw';
import graphic from '../adapters/unity/Runtime/PanelRoundedGraphic.cs?raw';
import reveal from '../adapters/unity/Runtime/PanelScrollReveal.cs?raw';
import builder from '../adapters/unity/Editor/PanelPrefabBuilder.cs?raw';
import { createUnityKitFiles } from './unity-kit.mjs';
import { createStoredZip } from './zip-store.mjs';

const sources = Object.freeze({
  'Runtime/PanelControlView.cs': controlView, 'Runtime/PanelController.cs': controller,
  'Runtime/PanelDocument.cs': documentSource, 'Runtime/PanelRoundedGraphic.cs': graphic,
  'Runtime/PanelScrollReveal.cs': reveal, 'Editor/PanelPrefabBuilder.cs': builder,
});

export async function createBrowserUnityKit(bundle, core) {
  const kit = await createUnityKitFiles(bundle, core, sources);
  return { bytes: createStoredZip(kit.contents), manifest: kit.manifest, panelId: kit.panelId };
}

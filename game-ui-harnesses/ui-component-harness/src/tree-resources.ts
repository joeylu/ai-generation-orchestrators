import { walkNodes, type UiDocument } from './tree-contract.ts';

/** Shared reference enumeration; no DOM, IO or PixiJS. Input must be validated. */
export function treeResourceReferences(document: UiDocument): { imageSources: Set<string>; fontSources: Map<string, string> } {
  const imageSources = new Set<string>();
  const fontSources = new Map<string, string>();
  for (const node of walkNodes(document)) {
    if (node.type === 'Image') imageSources.add(node.props.source);
    if (node.type === 'Container' && node.props.appearance) imageSources.add(node.props.appearance.background.image);
    if (node.type === 'Button' && node.props.backgroundImage) imageSources.add(node.props.backgroundImage);
    if (node.type === 'Button' && node.props.appearance) imageSources.add(node.props.appearance.backgroundImage);
    if (node.type === 'Switch' && node.props.appearance) {
      imageSources.add(node.props.appearance.trackImage);
      imageSources.add(node.props.appearance.thumbImage);
      if (node.props.appearance.stateImages) for (const key of ['off', 'on'] as const) {
        imageSources.add(node.props.appearance.stateImages[key].trackImage);
        imageSources.add(node.props.appearance.stateImages[key].thumbImage);
      }
    }
    if (node.type === 'Select' && node.props.appearance) {
      imageSources.add(node.props.appearance.fieldImage);
      imageSources.add(node.props.appearance.arrowImage);
      imageSources.add(node.props.appearance.popupImage);
      for (const item of node.props.appearance.optionIcons?.items ?? []) if (item.icon) imageSources.add(item.icon.image);
    }
    if (node.type === 'CheckBox' && node.props.appearance) { imageSources.add(node.props.appearance.box.image); imageSources.add(node.props.appearance.mark.image); }
    if (node.type === 'RadioGroup' && node.props.appearance) for (const item of node.props.appearance.items) { imageSources.add(item.option.image); imageSources.add(item.indicator.image); }
    if (node.type === 'Input' && node.props.appearance) imageSources.add(node.props.appearance.backgroundImage);
    if (node.type === 'ProgressBar' && node.props.appearance) { imageSources.add(node.props.appearance.track.image); imageSources.add(node.props.appearance.fill.image); }
    if (node.type === 'Slider' && node.props.appearance) { imageSources.add(node.props.appearance.track.image); imageSources.add(node.props.appearance.fill.image); imageSources.add(node.props.appearance.thumbImage); }
    if (node.type === 'ScrollView' && node.props.appearance) {
      imageSources.add(node.props.appearance.viewport.image);
      imageSources.add(node.props.appearance.scrollbarTrack.image);
      imageSources.add(node.props.appearance.scrollbarThumbImage);
    }
    if (node.type === 'List' && node.props.appearance) {
      imageSources.add(node.props.appearance.backgroundImage);
      imageSources.add(node.props.appearance.rowImage);
      imageSources.add(node.props.appearance.selectedRowImage);
    }
    if (node.type === 'Panel' && node.props.appearance) {
      imageSources.add(node.props.appearance.background.image);
      if (node.props.appearance.header) imageSources.add(node.props.appearance.header.image);
      if (node.props.appearance.body) imageSources.add(node.props.appearance.body.image);
    }
    if (node.type === 'Dialog' && node.props.appearance) {
      imageSources.add(node.props.appearance.background.image);
      imageSources.add(node.props.appearance.header.image);
      if (node.props.appearance.body) imageSources.add(node.props.appearance.body.image);
      if (node.props.appearance.overlayImage) imageSources.add(node.props.appearance.overlayImage);
    }
    if (node.type === 'Tabs' && node.props.appearance) {
      imageSources.add(node.props.appearance.tabImage);
      imageSources.add(node.props.appearance.activeTabImage);
      for (const item of node.props.appearance.items ?? []) { imageSources.add(item.tabImage); imageSources.add(item.activeTabImage); }
      for (const item of node.props.appearance.icons ?? []) { imageSources.add(item.icon.image); imageSources.add(item.activeIcon.image); }
    }
    if (node.type === 'Text' && node.props.fontSource) fontSources.set(`${node.props.fontSource}\u0000${node.props.style.fontFamily}`, node.props.fontSource);
  }

  return { imageSources, fontSources };
}

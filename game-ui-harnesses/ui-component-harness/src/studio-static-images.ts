import type { UiDocument, UiNode } from './tree-contract.ts';
import type { MotionDocument } from './motion.ts';
import type { MotionSystemDocument } from './motion-system.ts';

/** Studio policy: the backmost full-canvas Image and its ancestors stay static.
 * Other images and control feedback retain their authored motion.
 */
export function staticImageTargets(document: UiDocument): Set<string> {
  const ids = new Set<string>();
  let found = false;
  function visit(node: UiNode, ancestors: string[], parentX: number, parentY: number) {
    const x = parentX + node.layout.x, y = parentY + node.layout.y;
    if (!found && node.type === 'Image' && x === 0 && y === 0 &&
      node.layout.width === document.canvas.width && node.layout.height === document.canvas.height) {
      for (const id of [...ancestors, node.id]) ids.add(id);
      found = true;
    }
    // Images owned by an interactive control are part of its feedback, not
    // standalone scene artwork (for example an icon inside a Button).
    if (!['Container', 'Panel', 'Dialog', 'Image'].includes(node.type)) return;
    if ('children' in node) for (const child of node.children ?? []) visit(child, [...ancestors, node.id], x, y);
  }
  visit(document.root, [], 0, 0);
  return ids;
}

export function staticImageSystem(document: UiDocument, system: MotionSystemDocument): MotionSystemDocument | null {
  const blocked = staticImageTargets(document);
  const bindings = system.bindings.filter(binding => !blocked.has(binding.targetId));
  return bindings.length ? { ...system, bindings } : null;
}

export function staticImageTimeline(document: UiDocument, motion?: MotionDocument): MotionDocument | undefined {
  if (!motion) return undefined;
  const blocked = staticImageTargets(document);
  const tracks = motion.tracks.filter(track => !blocked.has(track.targetId));
  return tracks.length ? { ...motion, tracks } : undefined;
}

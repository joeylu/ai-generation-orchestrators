import { fixtureStyle } from '../../src/fixtures.ts';
import type { ButtonInteraction } from '../../src/button-interactions.ts';
import type { UiDocument, UiNode } from '../../src/tree-contract.ts';
export function buttonInteractionsFixture(): UiDocument {
  const style = { ...fixtureStyle, fontFamily: 'Arial', fontSize: 18 };
  const layout = (x: number, y: number, width = 105, height = 40) => ({ x, y, width, height });
  const button = (id: string, label: string, x: number, y: number, interaction: ButtonInteraction): UiNode => ({
    id, type: 'Button', layout: layout(x, y), props: { label, enabled: true, style, interaction }, children: [],
  });
  const text = (id: string, value: string, x: number, y: number): UiNode => ({ id, type: 'Text', layout: layout(x, y),
    props: { text: value, wrap: 'none', overflow: 'error', lineHeight: 24, drawBackground: false, style } });
  const image = (id: string, source: string, x: number, y: number): UiNode => ({ id, type: 'Image', layout: layout(x, y, 64, 64),
    props: { source, fit: 'contain', drawBackground: false, style } });
  const open = (item: 'alpha' | 'beta'): ButtonInteraction => ({ version: '1.0', mode: 'internal', effects: [
    { kind: 'copy-text', sourceId: `${item}-name`, targetId: 'detail-name' },
    { kind: 'copy-image', sourceId: `${item}-image`, targetId: 'detail-image' },
    { kind: 'dialog-open', targetId: 'detail', open: true },
  ] });
  const close: ButtonInteraction = { version: '1.0', mode: 'internal', effects: [{ kind: 'dialog-open', targetId: 'detail', open: false }] };
  const step = (delta: number): ButtonInteraction => ({ version: '1.0', mode: 'internal', effects: [{ kind: 'input-step', targetId: 'quantity', delta, min: 0, max: 9 }] });
  return { schemaVersion: '0.2', id: 'button-interactions-procedural', canvas: { width: 640, height: 460 }, root: {
    id: 'root', type: 'Container', layout: layout(0, 0, 640, 460), props: { style }, children: [
      text('alpha-name', 'Alpha', 20, 15), image('alpha-image', 'fixtures/gem.svg', 20, 60), button('alpha-open', 'Details A', 20, 145, open('alpha')),
      text('beta-name', 'Beta', 150, 15), image('beta-image', 'fixtures/plate.svg', 150, 60), button('beta-open', 'Details B', 150, 145, open('beta')),
      button('external', 'Back', 20, 215, { version: '1.0', mode: 'external', reason: 'Destination belongs to the host; this fixture has no navigation route.' }),
      { id: 'detail', type: 'Dialog', layout: layout(300, 20, 310, 360), props: { open: true, title: 'Details', modal: true, style }, children: [
        text('detail-name', 'Alpha', 30, 55), image('detail-image', 'fixtures/gem.svg', 30, 100),
        { id: 'quantity', type: 'Input', layout: layout(110, 180, 65, 40), props: { value: '0', placeholder: '', inputType: 'number', maxLength: 1, readOnly: false, enabled: true, style } },
        button('minus', '-', 5, 180, step(-1)), button('plus', '+', 180, 180, step(1)),
        button('close', 'Close', 5, 245, close), button('cancel', 'Cancel', 180, 245, close),
      ] },
    ],
  } };
}

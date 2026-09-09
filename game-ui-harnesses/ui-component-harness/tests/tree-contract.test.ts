import test from 'node:test';
import assert from 'node:assert/strict';
import { HarnessError } from '../src/contract.ts';
import { validateDocument, walkNodes, type ControlStyle, type UiDocument, type UiNode } from '../src/tree-contract.ts';

const style: ControlStyle = {
  backgroundColor: '#FFFFFF', borderColor: '#113355', borderWidth: 1, cornerRadius: 4,
  textColor: '#001122', fontFamily: 'sans-serif', fontSize: 16, fontWeight: 'normal', opacity: 1,
};
const box = (id: string): UiNode['layout'] => ({ x: id.length, y: 0, width: 80, height: 40 });
const text = (id: string, value: string): UiNode => ({
  id, type: 'Text', layout: box(id), props: { text: value, wrap: 'word', overflow: 'clip', lineHeight: 20, style },
});

export function legalDocument(): UiDocument {
  return {
    schemaVersion: '0.2', id: 'document', canvas: { width: 1000, height: 800 },
    root: {
      id: 'root', type: 'Container', layout: { x: 0, y: 0, width: 1000, height: 800 }, props: { style }, children: [
        { id: 'image', type: 'Image', layout: box('image'), props: { source: 'assets/icon.png', fit: 'contain', style } },
        { id: 'text', type: 'Text', layout: box('text'), props: { text: 'A title', wrap: 'word', overflow: 'ellipsis', lineHeight: 24, fontSource: 'fonts/ui.woff2', style } },
        { id: 'button', type: 'Button', layout: box('button'), props: { label: '', enabled: true, style }, children: [text('button-label', 'Save')] },
        { id: 'switch', type: 'Switch', layout: box('switch'), props: { label: 'Music', checked: true, enabled: true, style } },
        { id: 'check', type: 'CheckBox', layout: box('check'), props: { label: 'Hints', checked: false, enabled: true, style } },
        { id: 'radio', type: 'RadioGroup', layout: box('radio'), props: { selectedId: 'radio-high', options: [{ id: 'radio-low', label: 'Low' }, { id: 'radio-high', label: 'High' }], enabled: true, style } },
        { id: 'input', type: 'Input', layout: box('input'), props: { value: 'Ada', placeholder: 'Name', inputType: 'text', readOnly: false, maxLength: 12, enabled: true, style } },
        { id: 'select', type: 'Select', layout: box('select'), props: { selectedId: 'select-east', options: [{ id: 'select-east', label: 'East' }, { id: 'select-west', label: 'West' }], enabled: true, style } },
        { id: 'progress', type: 'ProgressBar', layout: box('progress'), props: { value: 5, max: 10, style } },
        { id: 'slider', type: 'Slider', layout: box('slider'), props: { value: 6, min: 0, max: 10, step: 2, enabled: true, style } },
        { id: 'scroll', type: 'ScrollView', layout: box('scroll'), props: { scrollX: 0, scrollY: 5, contentWidth: 300, contentHeight: 400, style }, children: [text('scroll-copy', 'Scrollable')] },
        { id: 'list', type: 'List', layout: box('list'), props: { selectedId: 'item-one', items: [{ id: 'item-one', label: 'One' }, { id: 'item-two', label: 'Two' }], itemTemplate: 'text-row', itemHeight: 32, enabled: true, style }, children: [] },
        { id: 'panel', type: 'Panel', layout: box('panel'), props: { title: 'Summary', style }, children: [text('panel-copy', 'Content')] },
        { id: 'dialog', type: 'Dialog', layout: box('dialog'), props: { open: false, title: 'Confirm', modal: true, style }, children: [text('dialog-copy', 'Are you sure?')] },
        { id: 'tabs', type: 'Tabs', layout: box('tabs'), props: { activeId: 'tab-info', tabs: [{ id: 'tab-info', label: 'Info', contentId: 'page-info' }, { id: 'tab-logs', label: 'Logs', contentId: 'page-logs' }], enabled: true, style }, children: [
          { id: 'page-info', type: 'Container', layout: box('page-info'), props: { style }, children: [] },
          { id: 'page-logs', type: 'Container', layout: box('page-logs'), props: { style }, children: [] },
        ] },
      ],
    },
  };
}

function expectIssue(run: () => unknown, path: string, code?: string): void {
  assert.throws(run, (error: unknown) => error instanceof HarnessError
    && error.stage === 'contract'
    && error.issues.some(issue => issue.path === path && (code === undefined || issue.code === code)));
}

test('v0.2 validates every renderable node branch, optional image region, font source, and composite children', () => {
  const source = legalDocument();
  const result = validateDocument(source);
  assert.deepEqual(result, source);
  assert.notEqual(result, source);
  assert.deepEqual(walkNodes(result).map(node => node.type), [
    'Container', 'Image', 'Text', 'Button', 'Text', 'Switch', 'CheckBox', 'RadioGroup', 'Input', 'Select',
    'ProgressBar', 'Slider', 'ScrollView', 'Text', 'List', 'Panel', 'Text', 'Dialog', 'Text', 'Tabs', 'Container', 'Container',
  ]);
});

test('opt-in raster paint fields are portable, preserve absent defaults, and reject invalid resource or paint values', () => {
  const source = legalDocument();
  const image = source.root.children[0] as any, button = source.root.children[2] as any, toggle = source.root.children[3] as any, select = source.root.children[7] as any;
  image.props.drawBackground = false; button.props.backgroundImage = 'assets/button-background.png';
  toggle.props.appearance = {
    trackImage: 'assets/switch-track.png', thumbImage: 'assets/switch-thumb.png', sourceCanvas: { width: 241, height: 129 },
    thumbPositions: { off: { x: 18, y: 18 }, on: { x: 128, y: 18 } },
  };
  select.props.appearance = {
    fieldImage: 'assets/select-field.png', arrowImage: 'assets/select-arrow.png', popupImage: 'assets/select-popup.png',
    sourceCanvas: { width: 300, height: 100 }, labelLayout: { x: 64, y: 18, width: 150, height: 64 },
    arrowLayout: { x: 230, y: 40, width: 30, height: 21 }, popupCanvas: { width: 300, height: 225 }, popupGap: 2,
  };
  const validated = validateDocument(source);
  assert.equal((validated.root.children[0] as any).props.drawBackground, false);
  assert.equal((validated.root.children[2] as any).props.backgroundImage, 'assets/button-background.png');
  assert.equal((validated.root.children[3] as any).props.appearance.thumbPositions.on.x, 128);
  assert.equal((validated.root.children[7] as any).props.appearance.popupCanvas.height, 225);
  assert.equal(Object.hasOwn((legalDocument().root.children[0] as any).props, 'drawBackground'), false);
  assert.equal(Object.hasOwn((legalDocument().root.children[2] as any).props, 'backgroundImage'), false);

  const invalidBackground = legalDocument() as any; invalidBackground.root.children[0].props.drawBackground = 'false';
  expectIssue(() => validateDocument(invalidBackground), '$.root.children[0].props.drawBackground', 'BOOLEAN_REQUIRED');
  const invalidSkin = legalDocument() as any; invalidSkin.root.children[2].props.backgroundImage = '../button.png';
  expectIssue(() => validateDocument(invalidSkin), '$.root.children[2].props.backgroundImage', 'INVALID_RESOURCE_REFERENCE');
  const invalidToggle = legalDocument() as any; invalidToggle.root.children[3].props.appearance = {
    trackImage: 'assets/track.png', thumbImage: '../thumb.png', sourceCanvas: { width: 241, height: 129 },
    thumbPositions: { off: { x: 18, y: 18 }, on: { x: -1, y: 18 } },
  };
  expectIssue(() => validateDocument(invalidToggle), '$.root.children[3].props.appearance.thumbImage', 'INVALID_RESOURCE_REFERENCE');
  expectIssue(() => validateDocument(invalidToggle), '$.root.children[3].props.appearance.thumbPositions.on.x', 'INVALID_NUMBER');
  const invalidSelect = legalDocument() as any; invalidSelect.root.children[7].props.appearance = {
    fieldImage: 'assets/field.png', arrowImage: '../arrow.png', popupImage: 'assets/popup.png', sourceCanvas: { width: 300, height: 100 },
    labelLayout: { x: 64, y: 18, width: 150, height: 64 }, arrowLayout: { x: 290, y: 40, width: 30, height: 21 }, popupCanvas: { width: 300, height: 225 }, popupGap: 2,
  };
  expectIssue(() => validateDocument(invalidSelect), '$.root.children[7].props.appearance.arrowImage', 'INVALID_RESOURCE_REFERENCE');
  expectIssue(() => validateDocument(invalidSelect), '$.root.children[7].props.appearance.arrowLayout', 'OUT_OF_RANGE');
});

test('Slider raster appearance requires integer texture canvases and a bounded horizontal left-to-right axis', () => {
  const source = legalDocument() as any, slider = source.root.children[9];
  slider.props.appearance = {
    sourceCanvas: { width: 80, height: 40 },
    track: { image: 'assets/slider-track.png', canvas: { width: 70, height: 4 }, layout: { x: 5, y: 18, width: 70, height: 4 } },
    fill: { image: 'assets/slider-fill.png', canvas: { width: 70, height: 4 }, layout: { x: 5, y: 18, width: 70, height: 4 } },
    fillClip: { x: 5, y: 18, width: 70, height: 4 }, fillDirection: 'left-to-right', fillSource: 'full-range-template',
    thumbImage: 'assets/slider-thumb.png', thumbCanvas: { width: 10, height: 10 }, thumbPositions: { min: { x: 0, y: 15 }, max: { x: 70, y: 15 } },
  };
  assert.equal((validateDocument(source).root.children[9] as any).props.appearance.thumbPositions.max.x, 70);
  const diagonal = structuredClone(source); diagonal.root.children[9].props.appearance.thumbPositions.max.y = 16;
  expectIssue(() => validateDocument(diagonal), '$.root.children[9].props.appearance.thumbPositions', 'SLIDER_AXIS_MISMATCH');
  const overflow = structuredClone(source); overflow.root.children[9].props.appearance.thumbPositions.max.x = 71;
  expectIssue(() => validateDocument(overflow), '$.root.children[9].props.appearance.thumbPositions.max', 'THUMB_OUT_OF_BOUNDS');
  const fractional = structuredClone(source); fractional.root.children[9].props.appearance.thumbCanvas.width = 10.5;
  expectIssue(() => validateDocument(fractional), '$.root.children[9].props.appearance.thumbCanvas.width', 'INVALID_NUMBER');
});

test('strict document failures report paths without repairing caller data', () => {
  const cases: Array<[string, (document: any) => void, string, string?]> = [
    ['unknown node type', document => document.root.children[0].type = 'Custom', '$.root.children[0].type', 'UNSUPPORTED_TYPE'],
    ['leaf children', document => document.root.children[0].children = [], '$.root.children[0].children', 'UNSUPPORTED_FIELD'],
    ['unknown prop', document => document.root.children[3].props.guessed = true, '$.root.children[3].props.guessed', 'UNSUPPORTED_FIELD'],
    ['duplicate choice ID', document => document.root.children[5].props.options[0].id = 'root', '$.root.children[5].props.options[0].id', 'DUPLICATE_ID'],
    ['broken selected choice', document => document.root.children[7].props.selectedId = 'select-missing', '$.root.children[7].props.selectedId', 'BROKEN_REFERENCE'],
    ['invalid tab content', document => document.root.children[14].props.tabs[0].contentId = 'not-a-child', '$.root.children[14].props.tabs[0].contentId', 'BROKEN_REFERENCE'],
    ['nonfinite position', document => document.root.children[0].layout.x = Infinity, '$.root.children[0].layout.x', 'INVALID_NUMBER'],
    ['unsafe image source', document => document.root.children[0].props.source = '../secret.png', '$.root.children[0].props.source', 'INVALID_RESOURCE_REFERENCE'],
    ['credentialed font source', document => document.root.children[1].props.fontSource = 'https://user:pass@example.test/font.woff2', '$.root.children[1].props.fontSource', 'INVALID_RESOURCE_REFERENCE'],
    ['input value beyond explicit maximum', document => document.root.children[6].props.value = 'value-that-is-too-long', '$.root.children[6].props.value', 'VALUE_TOO_LONG'],
    ['range step mismatch', document => document.root.children[9].props.value = 5, '$.root.children[9].props.value', 'STEP_MISMATCH'],
    ['scroll X beyond content viewport', document => document.root.children[10].props.scrollX = 221, '$.root.children[10].props.scrollX', 'OUT_OF_RANGE'],
    ['scroll Y beyond content viewport', document => document.root.children[10].props.scrollY = 361, '$.root.children[10].props.scrollY', 'OUT_OF_RANGE'],
    ['empty radio choices', document => { document.root.children[5].props.options = []; document.root.children[5].props.selectedId = null; }, '$.root.children[5].props.options', 'MIN_ITEMS_REQUIRED'],
    ['empty select choices', document => { document.root.children[7].props.options = []; document.root.children[7].props.selectedId = null; }, '$.root.children[7].props.options', 'MIN_ITEMS_REQUIRED'],
  ];
  for (const [name, mutate, path, code] of cases) {
    const source = legalDocument(); const before = structuredClone(source); mutate(source);
    expectIssue(() => validateDocument(source), path, code);
    assert.notDeepEqual(source, before, `${name} mutation is intentional and validator must not rewrite it`);
  }
});

test('cycle and tree-depth guards reject non-tree input before cloning', () => {
  const cyclic: any = legalDocument(); cyclic.root.children.push(cyclic.root);
  expectIssue(() => validateDocument(cyclic), '$.root.children[15]', 'TREE_CYCLE');

  const deep: any = legalDocument();
  let current = deep.root;
  for (let index = 0; index < 33; index += 1) {
    const child = { id: `deep-${index}`, type: 'Container', layout: { x: 0, y: 0, width: 1, height: 1 }, props: { style }, children: [] };
    current.children = [child]; current = child;
  }
  assert.throws(() => validateDocument(deep), (error: unknown) => error instanceof HarnessError
    && error.issues.some(issue => issue.code === 'TREE_DEPTH_LIMIT'));
});

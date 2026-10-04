import assert from 'node:assert/strict';
import test from 'node:test';
import { renderIconSvg, supportedIconPaths } from '../src/redesign-icons.mjs';

// Names are fixture evidence, independent of any installed Unity project.
const expectedGroups = {
  'Business & Commerce': 'Credit Card|Credit Card Filled|Diamond Coin|Diamond Coin Filled|Money|Money Filled|Pie Chart|Pie Chart (Filled)|Shopping Bag|Shopping Bag Filled',
  Common: 'Bell|Bell Filled|Eye|Eye Off|Heart|Heart Filled|Star|Star Filled',
  'Communication & Social': 'Discord|Discord Filled|Email|Email 2|Email Filled|Facebook|Facebook Filled|Github|Github (Filled)|Instagram|Instagram Filled|Message|Message Empty|Message Filled|Reddit|Reddit Filled|Share|Share Filled|Steam|Steam Filled|Twitter|Twitter Filled|Twitter X|User|User Filled|YouTube|YouTube Filled',
  'Date & Time': 'Clock',
  Design: 'Crop|Crop Filled',
  Device: 'Headphones|Headphones Filled|Lightbulb|Lightbulb Filled|Monitor|Monitor Filled|Phone|Phone Filled|Power|Speaker|Speaker Filled',
  Document: 'Book|Book Filled|Docs|Docs Filled|Document|Document Filled|Folder|Folder Filled',
  Map: 'Globe|Globe Filled|Location Mark|Location Mark Filled|Map|Map Filled|World|World Filled',
  Media: 'Camera|Camera Filled|Microphone|Microphone Filled|Music|Music Filled|Pause|Photo|Photo Filled|Play|Play Filled|Video|Video Filled',
  Navigation: 'Add|Arrow Down|Arrow Left|Arrow Right|Arrow Simple Down|Arrow Simple Left|Arrow Simple Right|Arrow Simple Up|Arrow Up|Check|Close|Help|Help Filled|Home|Home Filled|Refresh|Refresh Filled|Search|Search Filled|Subtract|Swap|Swap (Filled)|Warning|Warning Filled',
  Others: 'Expand|Panel Seperator',
  'Others/Animation Icon Stuff': 'Heart Pop|Lock Bottom|Lock Top|Sand Clock|Sand Clock Sand',
  Reward: 'Medal|Medal Filled|Trophy|Trophy Filled',
  System: 'Lock|Lock Filled|Settings|Settings Filled|Shield|Shield Filled|Trash|Trash Filled',
  'UI Elements': 'Button|Button (Filled)|Context Menu|Dropdown|Dropdown (Filled)|Input Filed|List View|Modal Window|Movable Window|Progress Bar|Progress Bar (Filled)|Slider|Slider (Filled)|Switch|Switch (Filled)|Toggle|Toggle (Filled)|Window Manager',
  Weather: 'Cloud|Cloud Filled|Sun|Sun Filled',
  'Web & Cloud': 'Cloud Download|Cloud Download Filled|Cloud Upload|Cloud Upload Filled',
};
const expected = Object.entries(expectedGroups).flatMap(([folder, names]) => names.split('|').map((name) => `Icon/${folder}/${name}.png`)).sort();

test('all 157 exact catalog paths render distinct, self-contained vector artwork', () => {
  assert.equal(expected.length, 157);
  assert.deepEqual(supportedIconPaths(), expected);
  const outputs = expected.map((name) => renderIconSvg(name));
  assert.equal(new Set(outputs).size, 157, 'each catalog entry has deliberate distinct artwork');
  for (const svg of outputs) {
    assert.match(svg, /viewBox="0 0 24 24"/);
    assert.match(svg, /stroke-linecap="round" stroke-linejoin="round"/);
    assert.doesNotMatch(svg, /<(?:text|image|use|script|foreignObject|style|filter)\b|(?:href|onload|onclick)=|url\(/i);
    const tags = [...svg.matchAll(/<\/?([a-zA-Z]+)/g)].map((match) => match[1]);
    assert.ok(tags.every((tag) => ['svg', 'path', 'circle', 'rect', 'line', 'polygon'].includes(tag)));
  }
});

test('filled/outline variants preserve semantic families with transparent counter-shapes', () => {
  const outline = renderIconSvg('Icon/Media/Camera.png');
  const filled = renderIconSvg('Icon/Media/Camera Filled.png');
  assert.notEqual(outline, filled);
  assert.match(filled, /fill-rule="evenodd"/);
  assert.doesNotMatch(outline, /fill-rule="evenodd"/);
  for (const [first, second] of [['Icon/Map/Globe.png', 'Icon/Map/World.png'], ['Icon/Navigation/Arrow Down.png', 'Icon/Navigation/Arrow Simple Down.png'], ['Icon/UI Elements/Slider.png', 'Icon/UI Elements/Progress Bar.png'], ['Icon/Communication & Social/Twitter.png', 'Icon/Communication & Social/Twitter X.png']]) {
    assert.notEqual(renderIconSvg(first), renderIconSvg(second));
  }
});

test('animation pieces share a canvas and assemble the same complete lock geometry', () => {
  const inner = (svg) => svg.slice(svg.indexOf('>') + 1, -6);
  const top = renderIconSvg('Icon/Others/Animation Icon Stuff/Lock Top.png');
  const bottom = renderIconSvg('Icon/Others/Animation Icon Stuff/Lock Bottom.png');
  assert.equal(inner(renderIconSvg('Icon/System/Lock.png')), inner(top) + inner(bottom));
  assert.notEqual(renderIconSvg('Icon/Others/Animation Icon Stuff/Sand Clock.png'), renderIconSvg('Icon/Others/Animation Icon Stuff/Sand Clock Sand.png'));
});

test('exact Windows paths normalize without accepting aliases or a generic fallback', () => {
  assert.equal(renderIconSvg('Icon\\Common\\Heart.png'), renderIconSvg('Icon/Common/Heart.png'));
  for (const value of ['heart', '../Icon/Common/Heart.png', 'Icon/Common/Unknown.png', 'Icon/Common/heart.png', 123, null]) {
    assert.throws(() => renderIconSvg(value), { code: 'UNKNOWN_ICON' });
  }
  const returned = supportedIconPaths();
  returned.length = 0;
  assert.equal(supportedIconPaths().length, 157);
});

test('dimensions and tint accept safe exact values while rejecting XML injection and getters', () => {
  const name = 'Icon/Common/Heart.png';
  assert.match(renderIconSvg(name, { width: 64, height: 96, color: '#abcdef' }), /width="64" height="96"[^>]*color="#ABCDEF"/);
  for (const value of [0, -1, 7, 4097, 1.5, Infinity, NaN, '128', '1" onload="x']) {
    assert.throws(() => renderIconSvg(name, { width: value }), { code: 'INVALID_ICON_SIZE' });
    assert.throws(() => renderIconSvg(name, { height: value }), { code: 'INVALID_ICON_SIZE' });
  }
  for (const color of ['red', '#FFF', '#ffffff00', 'url(x)', '#ffffff" onload="x', {}, null]) assert.throws(() => renderIconSvg(name, { color }), { code: 'INVALID_ICON_COLOR' });
  for (const options of [null, [], new Date(), { path: 'x' }, { [Symbol('x')]: true }]) assert.throws(() => renderIconSvg(name, options), { code: 'INVALID_ICON_OPTIONS' });
  let invoked = false;
  const options = { get width() { invoked = true; return 128; } };
  assert.throws(() => renderIconSvg(name, options), { code: 'INVALID_ICON_OPTIONS' });
  assert.equal(invoked, false);
});

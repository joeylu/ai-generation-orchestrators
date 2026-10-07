import test from 'node:test';
import assert from 'node:assert/strict';
import { attachInputEditor } from '../src/input-editor.mjs';

test('valid sequential typing leaves native selection untouched; clipping restores a bounded selection and detaches', () => {
  let value = '蓝', assignments = 0, listener, removed = false;
  const editor = { get value() { return value; }, set value(next) { assignments++; value = next; this.selectionStart = this.selectionEnd = 0; },
    style: { width: '1px' }, selectionStart: 1, selectionEnd: 1, selectionDirection: 'none',
    setSelectionRange(start, end, direction) { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; },
    addEventListener(type, callback, capture) { assert.equal(type, 'input'); assert.equal(capture, true); listener = callback; },
    removeEventListener(type, callback, capture) { assert.equal(type, 'input'); assert.equal(callback, listener); assert.equal(capture, true); removed = true; },
  };
  const spec = { id: 'role', state: [{ id: 'name', maxLength: 3 }], sections: [{ rows: [{ id: 'name', kind: 'input', bind: 'name' }] }] };
  const detach = attachInputEditor({ querySelector: () => editor }, spec, { inspect: () => ({ nodes: [{ id: 'role.row.name.control', type: 'Input', inputEditing: { focused: true } }] }) }, { getState: () => ({ name: '蓝' }) });
  assert.equal(editor.style.width, '320px'); listener(); assert.equal(assignments, 0); assert.equal(editor.selectionStart, 1);
  value = '蓝莓'; editor.selectionStart = editor.selectionEnd = 2; listener(); assert.equal(assignments, 0); assert.equal(editor.selectionStart, 2);
  value = '蓝莓😀'; editor.selectionStart = editor.selectionEnd = 4; listener();
  assert.equal(value, '蓝莓'); assert.equal(assignments, 1); assert.equal(editor.selectionStart, 2); assert.equal(editor.selectionEnd, 2);
  detach(); assert(removed); assert.equal(editor.style.width, '1px');
});

import { controlId } from './compiler.mjs';

/** Keep IME/paste length clipping on Unicode boundaries before the shared Input listener. */
export function boundedEditorText(value, maximum, previous) {
  if (!value.isWellFormed() || /[\p{Cc}\u2028\u2029]/u.test(value)) return previous;
  let next = value.slice(0, maximum);
  if (!next.isWellFormed()) next = next.slice(0, -1);
  return next;
}
export function attachInputEditor(host, spec, runtime, session) {
  const editor = host.querySelector('input'), rows = new Map(spec.sections.flatMap(section => section.rows)
    .filter(row => row.kind === 'input').map(row => [controlId(spec.id, row.id), row]));
  if (!rows.size) return () => {};
  if (!editor) throw new Error('PANEL_INPUT_EDITOR_REQUIRED');
  // A 1px native input has no usable text content box in Chromium: committed
  // Chinese text can leave its caret at zero. Keep the invisible proxy wide
  // enough for native editing; the Pixi input remains the visible field.
  const previousWidth = editor.style.width;
  editor.style.width = '320px';
  const listener = () => {
    const node = runtime.inspect().nodes.find(node => node.type === 'Input' && node.inputEditing.focused);
    const row = rows.get(node?.id); if (!row) return;
    const field = spec.state.find(field => field.id === row.bind);
    const next = boundedEditorText(editor.value, field.maxLength, session.getState()[field.id]);
    // Reassigning even valid text can reset the native input selection during
    // each capture event. Leave ordinary typing and IME selection untouched.
    if (next !== editor.value) {
      const start = editor.selectionStart, end = editor.selectionEnd, direction = editor.selectionDirection;
      editor.value = next;
      if (start !== null && end !== null) editor.setSelectionRange(Math.min(start, next.length), Math.min(end, next.length), direction);
    }
  };
  editor.addEventListener('input', listener, true);
  return () => { editor.removeEventListener('input', listener, true); editor.style.width = previousWidth; };
}

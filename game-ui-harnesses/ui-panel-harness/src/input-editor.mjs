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
  const listener = () => {
    const node = runtime.inspect().nodes.find(node => node.type === 'Input' && node.inputEditing.focused);
    const row = rows.get(node?.id); if (!row) return;
    const field = spec.state.find(field => field.id === row.bind);
    editor.value = boundedEditorText(editor.value, field.maxLength, session.getState()[field.id]);
  };
  editor.addEventListener('input', listener, true);
  return () => editor.removeEventListener('input', listener, true);
}

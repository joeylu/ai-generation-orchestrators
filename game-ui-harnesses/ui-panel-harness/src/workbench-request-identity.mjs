/** Studio-only request identity. Existing panel edits always use their own Spec ID. */
export function createWorkbenchRequestIdentity(nextId = () => `panel-${crypto.randomUUID().replaceAll('-', '')}`) {
  let manual = false, current = null;
  const keyFor = (text, style) => JSON.stringify([text, style]);
  return Object.freeze({
    select(text, style, enteredId) {
      if (manual) return enteredId;
      const key = keyFor(text, style);
      if (current?.key !== key) {
        const id = nextId();
        if (typeof id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)) throw new Error('WORKBENCH_REQUEST_ID');
        current = { key, id };
      }
      return current.id;
    },
    adopt(text, style, id) { current = { key: keyFor(text, style), id }; },
    setManual(value) { manual = value; },
  });
}

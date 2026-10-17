import { validateDocument, fail, resourceClosure } from "./document.mjs";
import { applyOperation } from "./operations.mjs";
// A renderer prepares a complete candidate before this session publishes it.
// Failed validation/rendering leaves document, history, and current renderer intact.
export function createSession(initial, ctx, prepare = () => null) {
  let doc = validateDocument(initial, ctx),
    current = null,
    undo = [],
    redo = [],
    busy = false;
  const listeners = new Set();
  const publish = (next, prepared) => {
    const previous = current;
    current = prepared;
    doc = next;
    previous?.dispose?.();
    listeners.forEach((f) => f(session));
  };
  const session = {
    get document() {
      return structuredClone(doc);
    },
    get revision() {
      return doc.revision;
    },
    get current() {
      return current;
    },
    get canUndo() {
      return undo.length > 0;
    },
    get canRedo() {
      return redo.length > 0;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async initialize() {
      if (!current) current = await prepare(doc);
      return session;
    },
    async commit(candidate, base = doc.revision, history = "edit") {
      if (busy || base !== doc.revision)
        fail("edit.stale", "文档已变更，请基于当前版本重试。");
      busy = true;
      try {
        const next = validateDocument(
          { ...candidate, revision: doc.revision + 1 },
          ctx,
        );
        const prepared = await prepare(next);
        if (history === "edit") {
          undo.push(doc);
          if (undo.length > 100) undo.shift();
          redo = [];
        } else if (history === "undo") {
          undo.pop();
          redo.push(doc);
        } else {
          redo.pop();
          undo.push(doc);
        }
        publish(next, prepared);
        return session.document;
      } finally {
        busy = false;
      }
    },
    mutate(op, base = doc.revision) {
      return session.commit(applyOperation(doc, op), base);
    },
    undo() {
      if (!undo.length) return Promise.resolve();
      return session.commit(undo.at(-1), doc.revision, "undo");
    },
    redo() {
      if (!redo.length) return Promise.resolve();
      return session.commit(redo.at(-1), doc.revision, "redo");
    },
    exportDocument() {
      return JSON.stringify(doc, null, 2) + "\n";
    },
    exportPackage() {
      return (
        JSON.stringify(
          {
            kind: "ui_panel_fixture_export",
            version: "0.1",
            document: doc,
            resources: resourceClosure(doc, ctx),
          },
          null,
          2,
        ) + "\n"
      );
    },
    dispose() {
      current?.dispose?.();
      listeners.clear();
      current = null;
    },
  };
  return session;
}

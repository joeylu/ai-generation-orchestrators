import "@pixi/layout";
import { getYoga } from "@pixi/layout";
import { Rectangle, Graphics, Text } from "pixi.js";
import { validateProps, recipeRef } from "../contracts/props.mjs";
import { basicAdapters, layoutBox } from "./basic.mjs";
import { collectionAdapters } from "./collections.mjs";
import { OverlayOwner } from "./controls.mjs";
import { reject, fitText } from "./skin.mjs";
import { assertSize, minimumSize } from "./geometry.mjs";
import { solveLayout, layoutTreeHasRules } from "./layout.mjs";
import { attachKeyboard } from "./keyboard.mjs";
import { measureSlices } from "../slicing/geometry.mjs";
import { textColorOwner } from './text-colors.mjs';

export const adapters = Object.freeze({
  ...basicAdapters,
  ...collectionAdapters,
});
export function createRuntime({
  app,
  registry,
  usage,
  skin,
  panelBackgrounds = new Map(),
  onEvent = () => {},
}) {
  if (skin.sourceKind !== "fixture" && !(skin.sourceKind === "imported" && skin.format === "png-pack"))
    reject("runtime.skin", "Expected a fixture or a verified PNG skin package.");
  const handles = new Map(),
    layoutCache = new Map(),
    pendingResizes = new Set(),
    overlay = new OverlayOwner(app);
  const textColors=textColorOwner(app,skin,()=>[...handles.values()].map(h=>h.root).concat(overlay.root));
  let mode = "play",
    destroyed = false,
    focused = null;
  const keydown = (e) => {
    const nativeInput = e.target instanceof HTMLInputElement;
    if (nativeInput && e.key !== "Tab") return;
    if (
      e.target instanceof HTMLTextAreaElement ||
      e.target instanceof HTMLSelectElement ||
      e.target?.isContentEditable
    )
      return;
    if (
      nativeInput &&
      ![...handles.values()].some((h) => h.adapter.view.input === e.target)
    )
      return;
    if (e.key === "Tab") {
      const candidates = [...handles.values()].filter(
        (h) => h.allowed() && (h.adapter.activate || h.adapter.key),
      );
      if (candidates.length) {
        e.preventDefault();
        const i = candidates.indexOf(focused);
        if (nativeInput) focused?.suspend();
        runtime.focus(
          candidates[
            (i + (e.shiftKey ? -1 : 1) + candidates.length) % candidates.length
          ],
        );
      }
    } else if (focused?.allowed() && focused.adapter.key?.(e.key)) {
      e.preventDefault();
      runtime.flush();
    } else if (
      ["Enter", " "].includes(e.key) &&
      focused?.allowed() &&
      focused.adapter.activate
    ) {
      e.preventDefault();
      if (!e.repeat) focused.adapter.activate();
    }
  };
  document.addEventListener("keydown", keydown);
  const runtime = {
    app,
    registry,
    usage,
    skin,
    overlay,
    handles,
    textColors,
    create(
      { id, recipeRef: ref, props = {}, size, sizing = {}, layout = {}, position },
      slots = {},
    ) {
      if (
        destroyed ||
        handles.has(id) ||
        !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(id ?? "")
      )
        reject("node.id", "Node ID invalid or already owned.");
      if (
        !size ||
        ![size.width, size.height].every((n) => Number.isFinite(n) && n >= 24)
      )
        reject(
          "node.size",
          "Component dimensions must be finite and at least 24 logical pixels.",
        );
      const recipe = registry.recipes.find((r) => recipeRef(r) === ref);
      if (!recipe || !adapters[recipe.adapterId])
        reject("node.adapter", "Recipe has no installed candidate adapter.");
      const list = Object.values(slots).flat();
      for (const name of Object.keys(slots))
        if (!recipe.slots.some((s) => s.name === name))
          reject("node.slot", "Unknown content slot.");
      for (const slot of recipe.slots) {
        const n = slots[slot.name]?.length ?? 0;
        if (n < slot.min || (slot.max !== null && n > slot.max))
          reject("node.slot", "Wrong content slot cardinality.");
      }
      if (
        new Set(list).size !== list.length ||
        list.some((h) => h.parent || handles.get(h.id) !== h || h.disposed)
      )
        reject("node.owner", "Each live child can have one owner.");
      const result = validateProps(registry, ref, props, {
        resourceIds: [...skin.textures.keys()],
        textStyleIds: ["body"],
        nodeIds: list.map((h) => h.id),
        layoutTokens: usage.layoutTokens,
      });
      if (result.issues.length || result.unresolved.length) {
        const error = new Error("Invalid component props.");
        error.issues = result.issues;
        throw error;
      }
      for (const binding of recipe.skinRoles) {
        if (!binding.required) continue;
        if (binding.when) {
          const w = binding.when;
          if ("equals" in w && result.props[w.prop] !== w.equals) continue;
          if ("notEquals" in w && result.props[w.prop] === w.notEquals)
            continue;
        }
        skin.texture(binding.role);
      }
      const p = result.props;
      const panelBackground = recipe.type === "Panel"
        ? p.backgroundRef ? panelBackgrounds.get(p.backgroundRef) : skin.backgroundSpec("skin.surface.panel")
        : null;
      if (recipe.type === "Panel" && !panelBackground) reject("background.reference", "Panel background is missing or has not been verified.");
      const preflight = (width, height) => {
        assertSize(recipe.type, p, skin.profile, width, height);
        skin.assertComponent?.(recipe.type,p,width,height);
        if (recipe.type === "Panel") {
          const { texture, borders, resizePolicy } = panelBackground;
          measureSlices({ sourceWidth: texture.orig.width, sourceHeight: texture.orig.height, borders, width, height, multiplier: p.pixelsPerUnitMultiplier, resizePolicy });
        }
        if (recipe.type === "Text") {
          const probe = new Text({
            text: p.text,
            style: skin.textStyle({
              wordWrap: p.wrap === "word",
              wordWrapWidth: width,
              breakWords: true,
            }),
          });
          try {
            fitText(probe, width, height, p.overflow);
          } finally {
            probe.destroy();
          }
        }
      };
      preflight(size.width, size.height);
      const root = layoutBox(size.width, size.height),
        connections = [];
      let adapter,
        mute = 0;
      root.hitArea = new Rectangle(0, 0, size.width, size.height);
      root.label = id;
      const handle = {
        id,
        recipe,
        props: p,
        root,
        size: { ...size },
        requestedSize: { ...size },
        sizing: structuredClone(sizing),
        layout: structuredClone(layout),
        preflight,
        position,
        parent: null,
        disposed: false,
        allowed(ignoreModal = false) {
          if (
            mode !== "play" ||
            this.disposed ||
            (!ignoreModal && !overlay.allows(this))
          )
            return false;
          for (let n = this; n; n = n.parent)
            if (
              n.props.enabled === false ||
              n.selectionOwned ||
              !n.root.visible ||
              n.root.eventMode === "none"
            )
              return false;
          for (let view = root; view; view = view.parent)
            if (!view.visible || view.eventMode === "none") return false;
          return true;
        },
        suspend() {
          mute++;
          try {
            adapter?.suspend?.();
            if (this.focusRing) this.focusRing.visible = false;
            for (const child of list) child.suspend();
          } finally {
            mute--;
          }
        },
        resume() {
          if (this.allowed()) {
            adapter?.resume?.();
            for (const child of list) child.resume();
          }
        },
        readState() {
          return structuredClone(adapter.state());
        },
        snapshot() {
          return {
            id,
            recipeRef: ref,
            props: structuredClone(p),
            size: { ...this.requestedSize },
            ...(Object.keys(this.sizing).length ? {sizing:structuredClone(this.sizing)} : {}),
            layout: structuredClone(layout),
            ...(position ? { position: { ...position } } : {}),
          };
        },
        setState(patch) {
          const next = validateProps(
            registry,
            ref,
            { ...p, ...adapter.state(), ...patch },
            {
              resourceIds: [...skin.textures.keys()],
              textStyleIds: ["body"],
              nodeIds: list.map((h) => h.id),
              layoutTokens: usage.layoutTokens,
            },
          );
          if (next.issues.length)
            reject("state.invalid", "Invalid programmatic state.");
          const allowed = Object.keys(adapter.state());
          if (Object.keys(patch).some((k) => !allowed.includes(k)))
            reject(
              "state.field",
              "Only runtime value fields can change through setState.",
            );
          mute++;
          try {
            adapter.setState(next.props);
          } finally {
            mute--;
          }
        },
        resize(width, height) {
          preflight(width, height);
          const previous=this.requestedSize;
          this.requestedSize={width,height};
          try { runtime.resolveLayout(); }
          catch(e){this.requestedSize=previous;throw e;}
          this.applySize(width,height, false);
          runtime.flush();
          this.parent?.adapter.childResized?.();
        },
        applySize(width, height, resolved = true) {
          // Resolved geometry never replaces authoring dimensions.
          if(!resolved && this.layoutManaged)return;
          if(this.size.width===width && this.size.height===height)return;
          mute++;
          try {
            adapter.resize(width, height);
            this.size = { width, height };
            root.layout = { width, height };
            root.hitArea = new Rectangle(0, 0, width, height);
            if (this.focusRing) {
              this.focusRing
                .clear()
                .rect(1, 1, width - 2, height - 2)
                .stroke({ color: skin.profile.palette.mark, width: 2 });
            }
          } finally {
            mute--;
          }
        },
        setEnabled(enabled) {
          if (!Object.hasOwn(recipe.propsSchema.properties, "enabled"))
            reject("node.enabled", "This recipe has no enabled property.");
          if (typeof enabled !== "boolean")
            reject("node.enabled", "Boolean required.");
          p.enabled = enabled;
          adapter.setEnabled?.(enabled);
          if (!enabled) this.suspend();
          root.eventMode = enabled && mode === "play" ? "passive" : "none";
          root.alpha = enabled ? 1 : skin.profile.disabledAlpha;
          if (enabled) this.resume();
        },
        setVisible(visible) {
          if (typeof visible !== "boolean")
            reject("node.visible", "Boolean required.");
          const previous=p.visible;
          if (!visible) this.suspend();
          p.visible = visible;
          root.visible = visible;
          if (visible) this.resume();
          try{runtime.flush();}catch(e){p.visible=previous;root.visible=previous;if(previous)this.resume();throw e;}
        },
        dispose() {
          if (this.disposed) return;
          this.suspend();
          this.disposed = true;
          for (const c of connections) c.disconnect();
          for (const child of list) child.dispose();
          overlay.release(this);
          root.destroy({ children: true });
          handles.delete(id);
          layoutCache.delete(id);
          pendingResizes.delete(this);
        },
      };
      const emit = (event, payload) => {
        if (!mute && handle.allowed()) {
          if (!recipe.events.includes(event))
            reject("event.contract", "Undeclared event.");
          onEvent({ nodeId: id, event, ...payload });
        }
      };
      const listen = (signal, fn) => connections.push(signal.connect(fn));
      try {
        adapter = adapters[recipe.adapterId]({
          runtime,
          handle,
          skin,
          panelBackground,
          p,
          w: size.width,
          h: size.height,
          layout,
          children: (name) => slots[name] ?? [],
          emit,
          listen,
        });
        root.addChild(adapter.view);
        root.visible = p.visible;
        root.eventMode =
          p.enabled === false || mode === "edit" ? "none" : "passive";
        root.alpha = p.enabled === false ? skin.profile.disabledAlpha : 1;
        handle.adapter = adapter;
        attachKeyboard(adapter, { recipe, p, emit, skin });
        for (const child of list) child.parent = handle;
        handles.set(id, handle);
        root.on("pointerdown", (event) => {
          if (handle.allowed() && (adapter.activate || adapter.key)) {
            runtime.focus(handle, false);
            event.stopPropagation();
          }
        });
        return handle;
      } catch (e) {
        connections.forEach((c) => c.disconnect());
        for (const child of list) child.root.removeFromParent();
        root.destroy({ children: true });
        throw e;
      }
    },
    mount(handle, parent = app.stage) {
      parent.addChild(handle.root);
      app.stage.addChild(overlay.root);
      this.flush();
      for (const h of handles.values()) h.adapter.afterLayout?.();
      this.flush();
    },
    flush() {
      this.resolveLayout();
      app.renderer.layout.update(app.stage);
      if(pendingResizes.size){const changed=[...pendingResizes];pendingResizes.clear();for(const h of changed)if(!h.disposed)h.parent?.adapter.childResized?.();app.renderer.layout.update(app.stage);}
      textColors?.refresh();
      app.render();
    },
    resolveLayout() {
      const describe=h=>({id:h.id,type:h.recipe.type,size:h.requestedSize,sizing:h.sizing,layout:h.layout,
        position:h.position,visible:h.props.visible,minimum:minimumSize(h.recipe.type,h.props,skin.profile),
        children:(h.adapter.layoutChildren??[]).map(describe)});
      const plans=[];
      for(const h of handles.values()) {
        if(h.parent?.recipe.type==='Container')continue;
        const tree=describe(h);
        if(layoutTreeHasRules(tree)){
          const key=JSON.stringify(tree),cached=layoutCache.get(h.id);
          const plan=cached?.key===key?cached.plan:solveLayout(getYoga(),tree);
          plans.push(plan);layoutCache.set(h.id,{key,plan});
        }
      }
      // Preflight every effective size before changing any control.
      for(const plan of plans)for(const [id,r]of plan){const h=handles.get(id);if(h.size.width!==r.width||h.size.height!==r.height)h.preflight(r.width,r.height);}
      const changed=new Set();
      for(const plan of plans)for(const [id,r]of plan){
        const h=handles.get(id);h.layoutManaged=true;
        if(h.size.width!==r.width||h.size.height!==r.height)changed.add(h);
        h.applySize(r.width,r.height);
        if(h.parent?.recipe.type==='Container')h.root.layout={position:'absolute',left:r.x,top:r.y};
      }
      for(const h of changed)pendingResizes.add(h);
    },
    focus(handle, enter = true) {
      if (focused?.focusRing && !focused.focusRing.destroyed)
        focused.focusRing.visible = false;
      focused = handle;
      if (!handle?.allowed()) return;
      if (!handle.focusRing) {
        handle.focusRing = new Graphics()
          .rect(1, 1, handle.size.width - 2, handle.size.height - 2)
          .stroke({ color: skin.profile.palette.mark, width: 2 });
        handle.focusRing.eventMode = "none";
        handle.root.addChild(handle.focusRing);
      }
      handle.focusRing.visible = true;
      if (enter) handle.adapter.focus?.();
    },
    setMode(value) {
      if (!["play", "edit"].includes(value))
        reject("runtime.mode", "Unknown mode.");
      mode = value;
      if (mode === "edit")
        for (const h of handles.values()) if (!h.parent) h.suspend();
      for (const h of handles.values())
        h.root.eventMode =
          value === "edit" || h.props.enabled === false ? "none" : "passive";
      if (mode === "play")
        for (const h of handles.values()) if (!h.parent) h.resume();
    },
    suspendExcept(owner) {
      for (const h of handles.values()) {
        let inside = false;
        for (let n = h; n; n = n.parent) if (n === owner) inside = true;
        if (
          inside ||
          ["Dialog", "Panel", "Container", "Tabs"].includes(h.recipe.type)
        )
          continue;
        h.suspend();
      }
    },
    dispose() {
      if (destroyed) return;
      destroyed = true;
      textColors?.dispose();
      document.removeEventListener("keydown", keydown);
      for (const h of [...handles.values()]) if (!h.parent) h.dispose();
      overlay.dispose();
    },
  };
  return runtime;
}

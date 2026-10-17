import "@pixi/layout";
import { getYoga } from "@pixi/layout";
import { Rectangle, Text } from "pixi.js";
import { validateProps, recipeRef } from "../contracts/props.mjs";
import { basicAdapters, layoutBox } from "./basic.mjs";
import { collectionAdapters } from "./collections.mjs";
import { OverlayOwner } from "./controls.mjs";
import { reject, fitText } from "./skin.mjs";
import { assertSize, minimumSize } from "./geometry.mjs";
import { solveLayout, layoutTreeHasRules } from "./layout.mjs";
import { measureSlices } from "../slicing/geometry.mjs";
import { textColorOwner } from './text-colors.mjs';
import { scopedSurfaceTextSkin } from './text-skin.mjs';
import {surfaceLayerInfo,surfaceLayerTypes} from '../skins/surface-styles.mjs';
import {assertSurfaceSlotChildren,effectiveSurfaceSizes} from './surface-slots.mjs';
import {runtimeSurfaceTextBox} from './surface-text-box.mjs';
import {logicalTextScopeRoots,applyRuntimeInk} from './derived-text-ink.mjs';
import {applyReferenceCjkWrap} from './cjk-text-flow.mjs';

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
  referenceTextFlow = false,
}) {
  if (skin.sourceKind !== "fixture" && !(skin.sourceKind === "imported" && skin.format === "png-pack"))
    reject("runtime.skin", "Expected a fixture or a verified PNG skin package.");
  const handles = new Map(),
    layoutCache = new Map(),
    pendingResizes = new Set(),
    overlay = new OverlayOwner(app);
  const textColors=textColorOwner(app,skin,()=>[...handles.values()].map(h=>h.root).concat(overlay.root),()=>new Map(
    [...handles.values()].flatMap(h=>{
      const color=h.props.textColor??null,view=h.adapter.view;
      // Select popups and Dialog views can move into the overlay. They keep
      // their node boundary; nested authored handles establish their own one.
      return [[h.root,color],[view,color],...(h.recipe.type==='Select'?[[view.view,color]]:[])];
    }),
  ),()=>new Map([...handles.values()].flatMap(handle=>[...(handle.adapter.textBackings??[])])),()=>logicalTextScopeRoots(handles.values()));
  let mode = "play", destroyed = false;
  const runtime = {
    app,
    registry,
    usage,
    skin,
    overlay,
    handles,
    textColors,
    create(
      { id, recipeRef: ref, props = {}, size, sizing = {}, layout = {}, position, surfaceStyle, surfaceLayer, surfaceScale, surfaceTextInsets, surfaceBand, surfaceFontSize, controlFit },
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
      if(surfaceStyle&&!(recipe.type==='Text'&&['title','section'].includes(surfaceStyle)||recipe.type==='Panel'&&surfaceStyle==='panel'))reject('skin.surface-style','Surface style does not match component type.');
      if(surfaceLayer&&(!surfaceLayerTypes.includes(recipe.type)||surfaceStyle||p.backgroundRef))reject('skin.surface-style','Surface layer conflicts with this component or its authored background.');
      if(surfaceScale!==undefined&&(surfaceLayer!=='frame'||!Number.isFinite(surfaceScale)||surfaceScale<1||surfaceScale>4))reject('skin.surface-style','Surface scale requires a frame and must be between 1 and 4.');
      if(surfaceLayer&&recipe.type==='Panel'&&p.pixelsPerUnitMultiplier!==1)reject('skin.surface-style','显式表面层仅支持默认切片倍率 1。');
      if(surfaceTextInsets&&!(recipe.type==='Text'&&['title','section'].includes(surfaceStyle)))reject('skin.surface-style','Text surface insets require a semantic heading.');
      if(surfaceBand!==undefined&&!(surfaceBand==='reference-v1'&&recipe.type==='Text'&&['title','section'].includes(surfaceStyle)))reject('skin.surface-style','Reference heading bands require a semantic heading.');
      if(surfaceFontSize!==undefined&&!(surfaceBand==='reference-v1'&&recipe.type==='Text'&&['title','section'].includes(surfaceStyle)&&Number.isInteger(surfaceFontSize)&&surfaceFontSize>=8&&surfaceFontSize<=96))reject('skin.surface-style','Reference heading font size requires a semantic band and must be an integer from 8 to 96.');
      if(surfaceTextInsets)surfaceTextInsets=structuredClone(surfaceTextInsets);
      const layerInfo=surfaceLayer?surfaceLayerInfo(skin.surfaceGeometry??skin,surfaceLayer,surfaceScale):null;
      const slotOptions=effectiveSize=>({nodeId:id,type:recipe.type,props:p,size:effectiveSize,profile:skin.profile,geometry:skin.surfaceGeometry??skin,surfaceLayer,surfaceScale});
      const dynamicSlot=h=>Object.entries(h.sizing??{}).some(([key,value])=>key.endsWith('Mode')&&value!=='fixed')||(h.slotChildren??[]).some(dynamicSlot);
      if(surfaceLayer&&!dynamicSlot({sizing,slotChildren:list}))assertSurfaceSlotChildren(slotOptions(size),list.map(child=>({id:child.id,size:child.size,visible:child.props.visible})));
      if(controlFit!==undefined&&!(controlFit==='template-box-v1'&&((recipe.type==='Switch'&&p.label==='')||(recipe.type==='ProgressBar'&&p.showValue===false))))reject('node.control-fit','Template fit requires an unlabelled Switch or caption-free ProgressBar.');
      const nodeSkin=scopedSurfaceTextSkin(skin,p,surfaceFontSize);
      const activeSurfaceStyle=surfaceStyle??(!surfaceLayer&&recipe.type==='Panel'&&!p.backgroundRef&&skin.surfaceGeometry?.surfaceStyles?.panel?'panel':null);
      const panelBackground = recipe.type === "Panel"
        ? p.backgroundRef ? panelBackgrounds.get(p.backgroundRef) : skin.backgroundSpec(layerInfo?.baseRole??"skin.surface.panel")
        : null;
      if (recipe.type === "Panel" && !panelBackground) reject("background.reference", "Panel background is missing or has not been verified.");
      const preflight = (width, height) => {
        if(activeSurfaceStyle)runtimeSurfaceTextBox(skin,activeSurfaceStyle,width,height,surfaceTextInsets,surfaceBand);
        if(layerInfo&&(width<layerInfo.minWidth||height<layerInfo.minHeight))reject('skin.surface-style','Surface layer is smaller than its skin minimum.');
        assertSize(recipe.type, p, skin.profile, width, height);
        skin.assertComponent?.(recipe.type,p,width,height,{surfaceLayer,surfaceScale,explicitRows:recipe.type==='List'&&(slots.items??[]).length>0});
        if (recipe.type === "Panel") {
          const { texture, borders, resizePolicy } = panelBackground;
          measureSlices({ sourceWidth: texture.orig.width, sourceHeight: texture.orig.height, borders, width, height, multiplier: p.pixelsPerUnitMultiplier, resizePolicy });
        }
        if (recipe.type === "Text") {
          const box=surfaceStyle?runtimeSurfaceTextBox(skin,surfaceStyle,width,height,surfaceTextInsets,surfaceBand):{width,height};
          const probe = new Text({
            text: p.text,
            style: nodeSkin.textStyle({
              wordWrap: p.wrap === "word",
              wordWrapWidth: box.width,
              breakWords: true,
            }),
          });
          try {
            if(surfaceTextInsets&&box.style){const style=box.style,ink=nodeSkin.runtimeRoleInk?.(style.baseRole,{enhanced:true,authorColor:p.textColor,styleColor:style.textColor,replacement:style.baseMode==='replace'});if(ink)applyRuntimeInk(probe,ink);}
            applyReferenceCjkWrap(probe,box.width,box.height,{enabled:referenceTextFlow===true&&!surfaceStyle&&p.wrap==='word',bodyEnabled:referenceTextFlow===true&&!surfaceStyle&&p.wrap==='word',titleEnabled:surfaceStyle==='title'&&surfaceBand==='reference-v1'&&p.align==='center'&&p.wrap==='word'});
            fitText(probe, box.width, box.height, p.overflow);
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
        surfaceLayer,
        surfaceScale,
        surfaceBand,
        surfaceFontSize,
        controlFit,
        slotChildren:list,
        surfaceSlotOptions:slotOptions,
        enhancedTextScope:Boolean(surfaceLayer||surfaceTextInsets),
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
            ...(surfaceStyle?{surfaceStyle}:{}),
            ...(surfaceLayer?{surfaceLayer}:{}),
            ...(surfaceScale!==undefined?{surfaceScale}:{}),
            ...(surfaceTextInsets?{surfaceTextInsets:structuredClone(surfaceTextInsets)}:{}),
            ...(surfaceBand?{surfaceBand}:{}),
            ...(surfaceFontSize!==undefined?{surfaceFontSize}:{}),
            ...(controlFit!==undefined?{controlFit}:{}),
          };
        },
        setState(patch) {
          // initialSlot belongs to authored startup data. Programmatic play
          // selection is validated independently and never rewrites that input.
          const stateProps={...p,...adapter.state(),...patch};
          if(stateProps.inventory){stateProps.inventory={...stateProps.inventory};delete stateProps.inventory.initialSlot;}
          const next = validateProps(
            registry,
            ref,
            stateProps,
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
          skin:nodeSkin,
          panelBackground,
          surfaceStyle,
          surfaceLayer,
          surfaceScale,
          surfaceBand,
          surfaceFontSize,
          controlFit,
          referenceTextFlow:referenceTextFlow===true,
          surfaceTextInsets,
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
        for (const child of list) child.parent = handle;
        handles.set(id, handle);
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
      const effective=effectiveSurfaceSizes(handles,plans);
      for(const h of handles.values())if(h.surfaceLayer)assertSurfaceSlotChildren(h.surfaceSlotOptions(effective.get(h.id)),h.slotChildren.map(child=>({id:child.id,size:effective.get(child.id),visible:child.props.visible})));
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
    // Compatibility entry point for text editing only; no component navigation
    // owner or decorative focus rectangle is created.
    focus(handle, enter = true) {
      if (!handle) {
        for (const h of handles.values()) if (h.recipe.type === 'Input') h.adapter.view.stopEditing();
        return;
      }
      if (enter && handle.recipe.type === 'Input' && handle.allowed()) handle.adapter.view.startEditing();
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
      for (const h of [...handles.values()]) if (!h.parent) h.dispose();
      overlay.dispose();
    },
  };
  return runtime;
}

import "@fontsource/noto-sans-sc/400.css";
import "@pixi/layout";
import { Application, Text, Ticker } from "pixi.js";
import { createFixtureSkin } from "../../src/runtime/skin.mjs";
import { loadPngSkin } from "../../src/runtime/png-skin.mjs";
import { createRuntime } from "../../src/runtime/runtime.mjs";
import { layoutBox } from "../../src/runtime/basic.mjs";
import { matrix, longProps } from "./matrix-fixtures.mjs";
import { attachPilotTextures } from './pilot-skin.mjs';
import { compilePanel } from '../../src/panel/compiler.mjs';
import { OwnedScrollBox } from '../../src/runtime/controls.mjs';
import {surfaceSlotBox} from '../../src/runtime/surface-slots.mjs';

window.initializeComponents = async function (
  data,
  width = 1280,
  height = 720,
) {
  await Promise.all([...document.fonts].map((face) => face.load()));
  await document.fonts.ready;
  const app = new Application();
  await app.init({
    width,
    height,
    background: "#101B2B",
    preference: "webgl",
    antialias: true,
    preserveDrawingBuffer: true,
    layout: { autoUpdate: true, throttle: 0 },
    eventFeatures: { globalMove: true },
  });
  document.body.appendChild(app.canvas);
  const from64 = value => Uint8Array.from(atob(value),c=>c.charCodeAt(0));
  const loadPack = pack => loadPngSkin({manifestBytes:from64(pack.manifest),manifestSha256:pack.manifestSha256,expectedBindings:pack.bindings,read:file=>from64(pack.resources[file])});
  const skin = data.skinPack ? await loadPack(data.skinPack) : createFixtureSkin(data.template, data.usage, data.profile),
    events = [];
  if(data.pilotSkin)await attachPilotTextures(skin,data.pilotSkin);
  // Acceptance canvas follows text contrast; it is not part of the skin artwork.
  const textColor = Number.parseInt(skin.profile.palette.text.slice(1), 16);
  const textLuma = 0.2126 * (textColor >> 16) + 0.7152 * ((textColor >> 8) & 255) + 0.0722 * (textColor & 255);
  app.renderer.background.color = textLuma > 128 ? "#101B2B" : "#E7E9ED";
  let runtime = createRuntime({
      app,
      registry: data.registry,
      usage: data.usage,
      skin,
      onEvent: (e) => events.push(e),
    }),
    sequence = 0;
  const h = {
    app,
    skin,
    loadPack,
    runtimeForSkin: candidate => createRuntime({app,registry:data.registry,usage:data.usage,skin:candidate}),
    compilePanel: (document,ctx) => compilePanel(document,ctx,{app,skin,onEvent:event=>events.push(event)}),
    liveScrollBoxes: () => OwnedScrollBox.live.size,
    events,
    get runtime() {
      return runtime;
    },
    cases: data.cases.cases,
    clear() {
      runtime.dispose();
      for (const child of [...app.stage.children])
        child.destroy({ children: true });
      runtime = createRuntime({
        app,
        registry: data.registry,
        usage: data.usage,
        skin,
        onEvent: (e) => events.push(e),
      });
      events.length = 0;
    },
    make(type, overrides = {}, mount = true) {
      const sample = h.cases.find((c) => c.type === type),
        id = overrides.id ?? "sample-" + sequence++;
      const props = { ...structuredClone(sample.props), ...overrides.props },
        size = { ...sample.size, ...overrides.size };
      const surfaceSlot=overrides.surfaceLayer?surfaceSlotBox({type,props,size,profile:skin.profile,geometry:skin.surfaceGeometry??skin,surfaceLayer:overrides.surfaceLayer}):null;
      const slots = {};
      const label = (suffix, text, height = 30) =>
        runtime.create({
          id: id + "-" + suffix,
          recipeRef: "text@1.0.0",
          props: { text, textStyleRef: "body", overflow: "ellipsis" },
          size: { width: Math.min(220, surfaceSlot?.width??size.width - 24), height },
        });
      if (["Panel", "Dialog"].includes(type))
        slots.content = [label("content", "面板内容")];
      if (type === "ScrollView")
        slots.content = [
          runtime.create(
            {
              id: id + "-content",
              recipeRef: "container@1.0.0",
              props: {},
              size: { width: surfaceSlot?.width??size.width - 24, height: 400 },
              layout: { gap: 8 },
            },
            {
              children: Array.from({ length: 8 }, (_, i) =>
                label("row" + i, "滚动内容 " + (i + 1), 38),
              ),
            },
          ),
        ];
      if (type === "Container")
        slots.children = [
          label("child1", "布局第一行"),
          label("child2", "布局第二行"),
        ];
      if (type === "Tabs") {
        props.tabs = props.tabs.map((t, i) => ({
          ...t,
          contentNodeId: id + "-page" + i,
        }));
        slots.pages = props.tabs.map((t, i) =>
          label("page" + i, "第 " + (i + 1) + " 页内容"),
        );
      }
      const node = runtime.create(
        {
          id,
          recipeRef: overrides.recipeRef ?? sample.recipeRef,
          props,
          size,
          sizing: overrides.sizing,
          layout: overrides.layout ?? {},
          position: overrides.position,
          surfaceLayer:overrides.surfaceLayer,
        },
        slots,
      );
      if (mount) {
        node.root.position.set(40, 40);
        runtime.mount(node);
      }
      return node;
    },
    gallery() {
      h.clear();
      const landscape = app.screen.width > app.screen.height,
        columns = landscape ? 4 : 2,
        rows = Math.ceil(h.cases.length / columns),
        cw = app.screen.width / columns;
      // Size each row from its largest sample, preserving authored component sizes.
      const rowHeights = Array.from(
        { length: rows },
        (_, i) =>
          Math.max(
            ...h.cases
              .slice(i * columns, (i + 1) * columns)
              .map((c) => c.size.height),
          ) + 48,
      );
      const remaining =
        app.screen.height - rowHeights.reduce((a, b) => a + b, 0);
      if (remaining < 0)
        throw Error(
          "Fixture gallery needs a larger canvas for these component sizes.",
        );
      const grid = layoutBox(app.screen.width, app.screen.height, {
        flexDirection: "row",
        flexWrap: "wrap",
        alignContent: "flex-start",
      });
      app.stage.addChild(grid);
      const result = [];
      h.cases.forEach((sample, index) => {
        const ch = rowHeights[Math.floor(index / columns)] + remaining / rows;
        const cell = layoutBox(cw, ch, {
            padding: 10,
            flexDirection: "column",
            gap: 6,
          }),
          title = new Text({
            text: sample.caseId + " " + sample.type + (skin.sourceKind==='imported'?'':' · fixture'),
            style: skin.textStyle({ fontSize: 13 }),
          });
        title.layout = { height: 22, width: cw - 20, flexShrink: 0 };
        cell.addChild(title);
        grid.addChild(cell);
        const node = h.make(
          sample.type,
          { size: { width: Math.min(sample.size.width, cw - 20) } },
          false,
        );
        cell.addChild(node.root);
        result.push(node);
      });
      app.stage.addChild(runtime.overlay.root);
      runtime.flush();
      for (const node of result) node.adapter.afterLayout?.();
      runtime.flush();
      return result.map((n) => ({
        type: n.recipe.type,
        id: n.id,
        box: n.root.getBounds().rectangle,
      }));
    },
    matrixGallery(types) {
      h.clear();
      const grid = layoutBox(app.screen.width, app.screen.height, {
          flexDirection: "row",
          flexWrap: "wrap",
          alignContent: "flex-start",
        }),
        entries = [];
      app.stage.addChild(grid);
      const cw = app.screen.width / matrix.variants.length,
        ch = app.screen.height / types.length;
      for (const type of types)
        for (const variant of matrix.variants) {
          const sample = h.cases.find((c) => c.type === type),
            cell = layoutBox(cw, ch, {
              padding: 24,
              flexDirection: "column",
              gap: 16,
              alignItems: "center",
            });
          const title = new Text({
            text: `${sample.caseId} ${type} · ${variant.width}px\n${variant.label}`,
            style: skin.textStyle({ fontSize: 13, fill: "#B5D5EE" }),
          });
          title.layout = { width: cw - 48, height: 42, flexShrink: 0 };
          cell.addChild(title);
          grid.addChild(cell);
          const n = h.make(
            type,
            {
              props: longProps(type),
              size: {
                width: variant.width,
                height: sample.size.height + variant.heightDelta,
              },
            },
            false,
          );
          cell.addChild(n.root);
          if (
            variant.mode === "disabled" &&
            n.recipe.propsSchema.properties.enabled
          )
            n.setEnabled(false);
          entries.push({
            type,
            variant: variant.id,
            mode: variant.mode,
            node: n,
            cell,
          });
        }
      app.stage.addChild(runtime.overlay.root);
      runtime.flush();
      for (const e of entries) e.node.adapter.afterLayout?.();
      for (const e of entries)
        if (e.mode === "value" && matrix.values[e.type])
          e.node.setState(matrix.values[e.type]);
      runtime.flush();
      return entries.map((e) => {
        const b = e.node.root.getBounds(),
          p = e.cell.toGlobal({ x: 0, y: 0 });
        return {
          type: e.type,
          variant: e.variant,
          box: { x: b.x, y: b.y, width: b.width, height: b.height },
          cell: { x: p.x, y: p.y, width: cw, height: ch },
        };
      });
    },
    point(node, part) {
      runtime.flush();
      const view = part ? node.adapter[part] : node.adapter.view;
      const b = view.getBounds();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    },
    diagnostics() {
      return {
        sharedTickerListeners: Ticker.shared.count,
        inputs: document.querySelectorAll("input").length,
        handles: runtime.handles.size,
        modals: runtime.overlay.modals.length,
        selects: runtime.overlay.selects.size,
      };
    },
    png() {
      runtime.flush();
      return app.canvas.toDataURL("image/png");
    },
    dispose() {
      runtime.dispose();
      skin.dispose();
      app.destroy(
        { removeView: true, releaseGlobalResources: true },
        { children: true },
      );
    },
  };
  window.harness = h;
  return { fontFaces: document.fonts.size, renderer: app.renderer.type };
};

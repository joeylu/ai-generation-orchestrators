import { Container, Sprite, Text, Graphics, Rectangle } from "pixi.js";
import { LayoutContainer } from "@pixi/layout/components";
import { Switcher, CheckBox, RadioGroup, ProgressBar } from "@pixi/ui";
import {
  makeButton,
  resizeButton,
  reflowLabel,
  OwnedInput,
  ContractSlider,
  percentLabel,
} from "./controls.mjs";
import { fitText, reject } from "./skin.mjs";
import { SlicedBackground } from "./sliced-background.mjs";
import { selectionMarkGeometry } from "./selection-geometry.mjs";
import {createSurfaceView} from './surface-view.mjs';
import {surfaceLayerInfo} from '../skins/surface-styles.mjs';
import {createLayerSurface} from './layer-surface.mjs';
import {runtimeSurfaceTextBox} from './surface-text-box.mjs';
import {applyRuntimeInk} from './derived-text-ink.mjs';
import {applyReferenceCjkWrap} from './cjk-text-flow.mjs';

const styleBox = (width, height, extra = {}) => ({
  width,
  height,
  flexShrink: 0,
  ...extra,
});
export function layoutBox(width, height, extra = {}) {
  const view = new LayoutContainer({ layout: styleBox(width, height, extra) });
  view.eventMode = "passive";
  return view;
}
export const basicAdapters = {
  "pixi.button"(c) {
    const { skin, p, w, h, emit, listen } = c,
      view = makeButton(skin, p.label, w, h, p.variant);
    view.enabled = p.enabled;
    listen(view.onPress, () => emit("activate", {}));
    return {
      view,
      resize: (w, h) => resizeButton(view, skin, w, h),
      setEnabled: (enabled) => {
        view.enabled = enabled;
      },
      activate: () => view.onPress.emit(),
      state: () => ({}),
      setState() {},
    };
  },
  "pixi.switch"(c) {
    const { skin, p, w, h, emit, listen } = c,
      m = skin.profile.markSize,
      reference = c.referenceTextFlow === true,
      views = [];
    for (const on of [false, true]) {
      const v = new Container(),
        track = skin.view(`skin.switch.track.${on ? "on" : "off"}`, m * 2, m),
        thumb = skin.view("skin.switch.thumb", m - 4, m - 4),
        text = skin.label(p.label, w - m * 2 - skin.profile.geometry.labelGap);
      const markX = reference ? w - m * 2 : 0;
      track.x = markX;
      thumb.position.set(markX + (on ? m + 2 : 2), 2);
      text.position.set(
        reference ? 0 : m * 2 + skin.profile.geometry.labelGap,
        ((skin.fontSizeOverride?Math.max(m,skin.profile.geometry.lineHeight):m) - text.height) / 2,
      );
      const markOffset=(skin.fontSizeOverride?Math.max(m,skin.profile.geometry.lineHeight)-m:0)/2;
      track.y=markOffset;thumb.y+=markOffset;
      v.addChild(track, thumb, text);
      views.push(v);
    }
    const view = new Switcher(views, ["onPress"], p.checked ? 1 : 0);
    view.innerView.hitArea = new Rectangle(0, 0, w, h);
    listen(view.onChange, () =>
      emit("valueChange", { checked: view.active === 1 }),
    );
    return {
      view,
      resize(width, height) {
        for (const [index, v] of views.entries()){
          reflowLabel(
            v.children[2],
            p.label,
            width - m * 2 - skin.profile.geometry.labelGap,
            height,
          );
          if(skin.fontSizeOverride)v.children[2].y=(Math.max(m,skin.profile.geometry.lineHeight)-v.children[2].height)/2;
          if(reference){
            v.children[0].x = width - m * 2;
            v.children[1].x = width - m * 2 + (index ? m + 2 : 2);
          }
        }
        view.innerView.hitArea = new Rectangle(0, 0, width, height);
      },
      activate: () => view.switch(),
      state: () => ({ checked: view.active === 1 }),
      setState: (s) => view.forceSwitch(s.checked ? 1 : 0),
    };
  },
  "pixi.check-box"(c) {
    return checkAdapter(c, false);
  },
  "pixi.radio-group"(c) {
    const { skin, p, w, emit, listen } = c;
    const items = p.options.map((option) =>
      makeCheck(
        skin,
        option.label,
        p.direction === "row" ? w / Math.max(1, p.options.length) : w,
        false,
        true,
      ),
    );
    items.forEach((item, i) => {
      item.eventMode = p.options[i].enabled ? "passive" : "none";
      item.alpha = p.options[i].enabled ? 1 : skin.profile.disabledAlpha;
    });
    const view = new RadioGroup({
      items,
      type: p.direction === "row" ? "horizontal" : "vertical",
      elementsMargin: skin.profile.gap,
      selectedItem: p.options.findIndex((o) => o.id === p.selectedId),
    });
    listen(view.onChange, (index) =>
      emit("selectionChange", { selectedId: p.options[index].id }),
    );
    return {
      view,
      items,
      resize(width) {
        const itemWidth =
          p.direction === "row"
            ? (width - Math.max(0, items.length - 1) * skin.profile.gap) /
              Math.max(1, items.length)
            : width;
        items.forEach((item, i) =>
          resizeCheck(item, skin, p.options[i].label, itemWidth),
        );
        view.innerView.arrangeChildren();
      },
      state: () => ({ selectedId: p.options[view.selected]?.id ?? null }),
      setState: (s) => {
        const i = p.options.findIndex((o) => o.id === s.selectedId);
        if (i < 0) {
          items.forEach((item) => item.forceCheck(false));
          view.selected = -1;
          view.value = "";
        } else view.selectItem(i);
      },
    };
  },
  "pixi.input"(c) {
    const { skin, p, w, h, listen, emit } = c;
    const pad = skin.insets("skin.field.normal");
    const attributes = {
      inputmode:
        p.inputType === "number"
          ? "decimal"
          : p.inputType === "email"
            ? "email"
            : "text",
    };
    const view = new OwnedInput({
      bg: skin.texture("skin.field.normal"),
      nineSliceSprite: skin.tuple("skin.field.normal"),
      textStyle: skin.textStyle(),
      value: p.value,
      placeholder: p.placeholder,
      secure: p.inputType === "password",
      maxLength: p.maxLength ?? undefined,
      inputAttributes: attributes,
      nativeTypography:{fontSize:p.fontSize,textColor:p.textColor,fontFamily:skin.profile.fontFamily},
      padding: pad,
      addMask: true,
    });
    view.setReadOnly(p.readOnly);
    view.setSize(w, h);
    listen(view.onChange, (value) => emit("input", { value }));
    listen(view.onEnter, (value) => emit("editEnd", { value }));
    return {
      view,
      resize: (w, h) => {
        skin.assertView?.("skin.field.normal",w,h);
        view.padding = pad;
        view.setSize(w, h);
      },
      suspend: () => view.suspend(),
      state: () => ({ value: view.value }),
      setState: (s) => {
        view.value = s.value;
      },
    };
  },
  "pixi.slider"(c) {
    const { skin, p, w, h, listen, emit } = c,
      size = skin.profile.thumbSize,
      thumb = skin.view("skin.slider.thumb.normal", size, size);
    const view = new ContractSlider({
      bg: skin.texture("skin.bar.track"),
      fill: skin.texture("skin.bar.fill"),
      nineSliceSprite: {
        bg: skin.tuple("skin.bar.track"),
        fill: skin.tuple("skin.bar.fill"),
      },
      slider: thumb,
      min: p.min,
      max: p.max,
      step: p.step,
      value: p.value,
      showValue: p.showValue,
      valueTextStyle: skin.textStyle(),
      valueTextOffset: { y: p.fontSize===undefined?22:Math.max(22,skin.profile.geometry.labelGap+skin.profile.geometry.lineHeight/2+skin.profile.thumbSize/2) },
    });
    const normalTexture = skin.texture("skin.slider.thumb.normal"),
      pressedTexture = skin.texture("skin.slider.thumb.pressed");
    view.onThumbPressed = (pressed) => {
      thumb.texture = pressed ? pressedTexture : normalTexture;
    };
    view.setSize(w - size, skin.profile.trackHeight);
    view.position.set(size / 2, size / 2);
    listen(view.onUpdate, (value) => emit("valueInput", { value }));
    listen(view.onChange, (value) => emit("valueCommit", { value }));
    return {
      view,
      resize: (w) => view.setSize(w - size, skin.profile.trackHeight),
      suspend: () => view.cancel(),
      state: () => ({ value: view.value }),
      setState: (s) => {
        view.value = s.value;
      },
    };
  },
  "pixi.progress-bar"(c) {
    const { skin, p, w, h } = c,
      view = new Container(),
      bar = new ProgressBar({
        bg: skin.texture("skin.bar.track"),
        fill: skin.texture("skin.bar.fill"),
        nineSliceSprite: {
          bg: skin.tuple("skin.bar.track"),
          fill: skin.tuple("skin.bar.fill"),
        },
        progress: (100 * (p.value - p.min)) / (p.max - p.min),
      });
    let value = p.value;
    bar.setSize(w, skin.profile.trackHeight);
    view.addChild(bar);
    const label = p.showValue ? skin.label(percentLabel(value, p.min, p.max), w) : null;
    let labelWidth = w;
    const positionLabel = () => {
      if (!label) return;
      reflowLabel(label, percentLabel(value, p.min, p.max), labelWidth);
      label.x = (labelWidth - label.width) / 2;
    };
    if (label) {
      label.y = skin.profile.trackHeight + skin.profile.geometry.labelGap;
      view.addChild(label);
      positionLabel();
    }
    return {
      view,
      bar,
      resize: (w) => { bar.setSize(w, skin.profile.trackHeight); labelWidth = w; positionLabel(); },
      state: () => ({ value }),
      setState: (s) => {
        value = s.value;
        bar.progress = (100 * (value - p.min)) / (p.max - p.min);
        positionLabel();
      },
    };
  },
  "pixi.text"(c) {
    const { skin, p, w, h } = c;
    const surface=c.surfaceStyle?createSurfaceView(skin,c.surfaceStyle,w,h,{band:c.surfaceBand}):null;
    const initialBox=surface?runtimeSurfaceTextBox(skin,c.surfaceStyle,w,h,c.surfaceTextInsets,c.surfaceBand):{x:0,y:0,width:w,height:h};
    if (p.textStyleRef !== "body")
      reject("text.style", "Fixture only declares body text style.");
    const view = layoutBox(w, h, { overflow: "hidden" }),
      text = new Text({
        text: p.text,
        style: skin.textStyle({
          align: p.align,
          wordWrap: p.wrap === "word",
          wordWrapWidth: initialBox.width,
          breakWords: true,
        }),
      });
    if(surface)view.addChild(surface.view);
    if(surface){
      text.surfaceInk={role:surface.style.baseRole,styleColor:surface.style.textColor,replacement:surface.style.baseMode==='replace'};
      const ink=skin.runtimeRoleInk?.(text.surfaceInk.role,{enhanced:Boolean(c.surfaceTextInsets),authorColor:p.textColor,...text.surfaceInk})??{fill:p.textColor??surface.style.textColor??skin.profile.textColors?.[surface.style.baseRole]??skin.profile.palette.text};
      text.surfaceTextColor=ink.fill;applyRuntimeInk(text,ink);
    }
    const referenceFlow=c.referenceTextFlow===true&&!surface&&p.wrap==='word';
    applyReferenceCjkWrap(text,initialBox.width,initialBox.height,{enabled:referenceFlow});
    view.addChild(fitText(text, initialBox.width, initialBox.height, p.overflow));
    const resize = (w, h) => {
      view.layout = { width: w, height: h };
      surface?.resize(w,h);
      const box=surface?runtimeSurfaceTextBox(skin,c.surfaceStyle,w,h,c.surfaceTextInsets,c.surfaceBand):{x:0,y:0,width:w,height:h};
      text.text = p.text;
      text.style.wordWrapWidth = box.width;
      applyReferenceCjkWrap(text,box.width,box.height,{enabled:referenceFlow});
      fitText(text, box.width, box.height, p.overflow);
      text.x =
        p.align === "right"
          ? box.width - text.width
          : p.align === "center"
            ? (box.width - text.width) / 2
            : 0;
      text.x+=box.x;text.y=box.y+(surface?(box.height-text.height)/2:0);
    };
    resize(w, h);
    return { view, text, surface, resize, state: () => ({}), setState() {} };
  },
  "pixi.image"(c) {
    const { skin, p, w, h } = c,
      texture = skin.textures.get(p.sourceRef);
    if (!texture) reject("image.resource", "Missing texture.");
    const view = layoutBox(w, h, { overflow: "hidden" }),
      sprite = new Sprite({ texture });
    sprite.layout = {
      width: w,
      height: h,
      objectFit: p.fit,
      objectPosition: p.position,
    };
    view.addChild(sprite);
    return {
      view,
      sprite,
      resize: (w, h) => {
        view.layout = { width: w, height: h };
        sprite.layout = { width: w, height: h };
      },
      state: () => ({}),
      setState() {},
    };
  },
  "pixi.container"(c) {
    for (const child of c.children("children")) {
      if (c.layout.childrenMode === "free" && !child.position)
        reject(
          "layout.position",
          "Free children need explicit local positions.",
        );
      if (c.layout.childrenMode !== "free" && child.position)
        reject("layout.flow", "Flow children cannot carry manual positions.");
    }
    const { w, h, layout, children } = c,
      view = layoutBox(w, h, {
        flexDirection:
          layout.direction === "row" || layout.direction === "wrap"
            ? "row"
            : "column",
        flexWrap: layout.direction === "wrap" ? "wrap" : "nowrap",
        gap: layout.gap ?? 8,
        padding: layout.padding ?? 0,
        alignItems: layout.align ?? "flex-start",
        overflow: "hidden",
      });
    for (const child of children("children")) {
      view.addChild(child.root);
      if (layout.childrenMode === "free") {
        if (!child.position)
          reject(
            "layout.position",
            "Free children need explicit local positions.",
          );
        child.root.layout = {
          position: "absolute",
          left: child.position.x,
          top: child.position.y,
        };
      } else if (child.position)
        reject("layout.flow", "Flow children cannot carry manual positions.");
    }
    return {
      view,
      layoutChildren: children("children"),
      resize: (w, h) => {
        view.layout = { width: w, height: h };
      },
      state: () => ({}),
      setState() {},
    };
  },
  "pixi.panel"(c) {
    const { skin, p, w, h, children } = c,layerInfo=c.surfaceLayer?surfaceLayerInfo(skin.surfaceGeometry??skin,c.surfaceLayer,c.surfaceScale):null,
      pad =
        p.contentPadding ??
        layerInfo?.insets??skin.insets("skin.surface.panel");
    if (Object.entries(pad).some(([key,n]) => n < (layerInfo?.insets??skin.insets("skin.surface.panel"))[key]))
      reject("panel.padding", "Padding intrudes into skin content area.");
    const view = new Container(),layer=c.surfaceLayer?createLayerSurface(skin,c.surfaceLayer,w,h,{scale:c.surfaceScale}):null,
      bg = layer?.view??new SlicedBackground({ ...c.panelBackground, width: w, height: h, multiplier: p.pixelsPerUnitMultiplier }),
      title = skin.label(p.title, w - pad.left - pad.right),
      body = layoutBox(
        w - pad.left - pad.right,
        h -
          pad.top -
          pad.bottom -
          (p.title
            ? skin.profile.geometry.lineHeight + skin.profile.geometry.titleGap
            : 0),
        { overflow: "hidden" },
      );
    view.addChild(bg, title, body);
    const surfaceKey=c.surfaceStyle??(!c.surfaceLayer&&!p.backgroundRef&&skin.surfaceGeometry?.surfaceStyles?.panel?'panel':null);
    const surface=surfaceKey?createSurfaceView(skin,surfaceKey,w,h,{base:false}):null;
    if(surface)view.addChildAt(surface.view,1);
    title.position.set(pad.left, pad.top);
    body.position.set(
      pad.left,
      pad.top +
        (p.title
          ? skin.profile.geometry.lineHeight + skin.profile.geometry.titleGap
          : 0),
    );
    for (const child of children("content")) body.addChild(child.root);
    return {
      view,
      bg,
      layer,
      motionChildren: children('content'),
      resize: (w, h) => {
        skin.assertView?.(layerInfo?.baseRole??"skin.surface.panel",w,h);
        if(layer)layer.resize(w,h);else bg.resize(w, h);
        surface?.resize(w,h);
        reflowLabel(
          title,
          p.title,
          w - pad.left - pad.right,
          skin.profile.geometry.lineHeight,
        );
        body.layout = {
          width: w - pad.left - pad.right,
          height:
            h -
            pad.top -
            pad.bottom -
            (p.title
              ? skin.profile.geometry.lineHeight +
                skin.profile.geometry.titleGap
              : 0),
        };
      },
      state: () => ({}),
      setState() {},
    };
  },
};
export function makeCheck(skin, label, width, checked, radio = false) {
  const m = skin.profile.markSize,
    base = radio ? "radio.ring" : "checkbox.box",
    mark = radio ? "radio.dot" : "checkbox.mark";
  const off = skin.view("skin." + base, m, m),
    on = new Container(),
    bg = skin.view("skin." + base, m, m),
    geometry = selectionMarkGeometry(m,skin.visualBounds?.("skin."+base),skin.visualBounds?.("skin."+mark),radio),
    fg = skin.view("skin." + mark, geometry.width, geometry.height);
  fg.position.set(geometry.x, geometry.y);
  on.addChild(bg, fg);
  const measured = skin.label(label, Math.max(1, width - m - 12)),
    value = measured.text;
  measured.destroy();
  const box = new CheckBox({
    text: value,
    checked,
    style: {
      unchecked: off,
      checked: on,
      text: skin.textStyle(),
      textOffset: { x: skin.profile.geometry.labelGap - 10 },
    },
  });
  box.innerView.hitArea = new Rectangle(0, 0, m, m);
  resizeCheck(box, skin, label, width);
  return box;
}
function resizeCheck(box, skin, label, width) {
  // Reset from the authored label; do not repeatedly truncate an old ellipsis.
  box.text = label;
  if (box.labelText) {
    reflowLabel(
      box.labelText,
      label,
      width - skin.profile.markSize - skin.profile.geometry.labelGap,
      skin.profile.geometry.lineHeight,
    );
    box.alignText();
    if(skin.fontSizeOverride){
      const rowHeight=Math.max(skin.profile.markSize,skin.profile.geometry.lineHeight);
      box.innerView.y=(rowHeight-skin.profile.markSize)/2;
      box.labelText.y=(rowHeight-box.labelText.height)/2;
    }
  }
}
function checkAdapter(c) {
  const { skin, p, w, listen, emit } = c,
    view = makeCheck(skin, p.label, w, p.checked);
  listen(view.onCheck, (checked) => emit("valueChange", { checked }));
  return {
    view,
    resize: (width) => resizeCheck(view, skin, p.label, width),
    activate: () => view.switch(),
    state: () => ({ checked: view.checked }),
    setState: (s) => view.forceCheck(s.checked),
  };
}

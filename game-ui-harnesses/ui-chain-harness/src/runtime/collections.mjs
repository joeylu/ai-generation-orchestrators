import {scrollPadding} from './scroll-geometry.mjs';
import {tabsContentBox} from './tabs-geometry.mjs';
import { Container, Graphics, Rectangle } from "pixi.js";
import { List, Switcher, Button } from "@pixi/ui";
import {
  makeButton,
  selectButtonSkin,
  resizeButton,
  SkinnedSelect,
  OwnedScrollBox,
  VerticalScrollbar,
  SkinnedDialog,
} from "./controls.mjs";
import { layoutBox } from "./basic.mjs";
import { reject } from "./skin.mjs";

export const collectionAdapters = {
  "pixi.select"(c) {
    const { skin, p, w, h, listen, emit, runtime, handle } = c;
    const view = new SkinnedSelect({
      skin,
      props: p,
      width: w,
      height: h,
      overlay: runtime.overlay,
      allowed: () => handle.allowed(),
    });
    // Native FancyButton stops pointer propagation; keep keyboard ownership on
    // the Select even when its popup is reparented to the overlay.
    for(const button of [view.openButton,view.closeButton,...view.rows])
      listen(button.onDown,()=>{if(handle.allowed())runtime.focus(handle,false);});
    listen(view.onSelect, (index) => {
      if (p.options[index]?.enabled)
        emit("selectionChange", { selectedId: p.options[index].id });
    });
    return {
      view,
      resize: (w, h) => view.resizeBox(w, h),
      suspend: () => view.suspend(),
      state: () => ({ selectedId: p.options[view.value]?.id ?? null }),
      setState: (s) => view.setSelection(s.selectedId),
    };
  },
  "pixi.list"(c) {
    const { skin, p, w, h, listen, emit, runtime, children } = c;
    const content = children("items");
    const recipe = runtime.registry.recipes.find(
      (r) => `${r.recipeId}@${r.recipeVersion}` === p.itemRecipeRef,
    );
    if (
      content.length &&
      (content.length !== p.items.length ||
        content.some(
          (x) =>
            `${x.recipe.recipeId}@${x.recipe.recipeVersion}` !==
            p.itemRecipeRef,
        ))
    )
      reject(
        "list.items",
        "Explicit rows must match item count and itemRecipeRef.",
      );
    if (!content.length && recipe.type !== "Button" && p.items.length)
      reject(
        "list.item-recipe",
        "Non-Button item recipes require explicit items content slots.",
      );
    const view = layoutBox(w, h, { overflow: "hidden" }),
      list = new List({
        type: "vertical",
        elementsMargin: runtime.usage.layoutTokens[p.gapToken],
      }),
      rows = [];
    view.addChild(list);
    let selected = p.selectedId;
    const refresh = () =>
      rows.forEach((b, i) => {
        if (b.skinRoles) selectButtonSkin(b, skin, p.items[i].id === selected);
        else b.view.tint = p.items[i].id === selected ? skin.profile.palette.active : 0xffffff;
      });
    p.items.forEach((item, i) => {
      let b;
      if (content.length) {
        const row = new Container();
        row.hitArea = new Rectangle(
          0,
          0,
          content[i].size.width,
          content[i].size.height,
        );
        row.addChild(content[i].root);
        b = new Button(row);
        // Single-selection owns the row gesture; interactive content belongs
        // in a non-selecting List. Keep one owner of pointer/keyboard input.
        row.interactiveChildren = p.selection === "none";
        content[i].selectionOwned = p.selection === "single";
        if (p.selection === "none") row.eventMode = "passive";
      } else
        b = makeButton(
          skin,
          item.label,
          w,
          skin.profile.itemHeight,
          recipe.propsSchema.properties.variant.default,
          ["skin.item.normal", "skin.item.selected"],
        );
      b.enabled = item.enabled;
      if (content.length) {
        b.view.eventMode = item.enabled
          ? p.selection === "none"
            ? "passive"
            : "static"
          : "none";
        b.view.alpha = item.enabled ? 1 : skin.profile.disabledAlpha;
      }
      rows.push(b);
      list.addChild(b.view ?? b);
      listen(b.onPress, () => {
        if (p.selection === "single" && selected !== item.id) {
          selected = item.id;
          refresh();
          emit("selectionChange", { selectedId: selected });
        }
      });
    });
    refresh();
    return {
      view,
      rows,
      resize: (w, h) => {
        view.layout = { width: w, height: h };
        rows.forEach((b, i) => {
          if (!content.length)
            resizeButton(b, skin, w, skin.profile.itemHeight);
          else
            b.view.hitArea = new Rectangle(
              0,
              0,
              content[i].size.width,
              content[i].size.height,
            );
        });
        list.arrangeChildren();
      },
      childResized: () => list.arrangeChildren(),
      state: () => ({ selectedId: selected }),
      setState: (s) => {
        selected = s.selectedId;
        refresh();
      },
    };
  },
  "pixi.tabs"(c) {
    const { skin, p, w, h, listen, emit, children } = c,
      view = layoutBox(w, h, { overflow: "hidden" }),
      header = new List({
        type: "horizontal",
        elementsMargin: skin.profile.geometry.tabGap,
      }),
      pages = children("pages"),
      switcher = new Switcher(
        p.tabs.map((t) => pages.find((x) => x.id === t.contentNodeId).root),
        [],
        p.tabs.findIndex((t) => t.id === p.activeId),
      );
    const insets=skin.roles.has('skin.surface.content')?skin.insets('skin.surface.content'):null;
    const initial=tabsContentBox(skin.profile,insets,w,h);
    const rows = [],
      tabWidth =
        (initial.surface.width - Math.max(0, p.tabs.length - 1) * skin.profile.geometry.tabGap) /
        Math.max(1, p.tabs.length);
    let active = p.activeId;
    const refresh = () => {
      rows.forEach((b, i) => {
        selectButtonSkin(b, skin, p.tabs[i].id === active);
      });
      pages.forEach((page) => {
        if (page.id !== p.tabs.find((t) => t.id === active)?.contentNodeId)
          page.suspend();
        else page.resume();
      });
    };
    p.tabs.forEach((tab, i) => {
      const b = makeButton(
        skin,
        tab.label,
        tabWidth,
        skin.profile.itemHeight,
        "primary",
        ["skin.tab.normal", "skin.tab.selected"],
      );
      b.enabled = tab.enabled;
      rows.push(b);
      header.addChild(b);
      listen(b.onPress, () => {
        if (active === tab.id) return;
        active = tab.id;
        switcher.forceSwitch(i);
        refresh();
        emit("selectionChange", { activeId: active });
      });
    });
    const outerBackground=insets?skin.view('skin.surface.content',w,h):null;
    const background=insets?skin.view('skin.surface.content',initial.surface.width,initial.surface.height):null;
    const contentMask=new Graphics();contentMask.eventMode='none';
    if(outerBackground)view.addChild(outerBackground);
    if(background)view.addChild(background);
    view.addChild(header,switcher,contentMask);switcher.mask=contentMask;
    const placeContent=(width,height)=>{
      const box=tabsContentBox(skin.profile,insets,width,height);
      if(outerBackground){outerBackground.width=width;outerBackground.height=height;}
      if(background){background.position.set(box.surface.x,box.surface.y);background.width=box.surface.width;background.height=box.surface.height;}
      header.position.set(box.outerPad.left,box.outerPad.top);
      switcher.position.set(box.x,box.y);
      contentMask.clear().rect(box.x,box.y,box.width,box.height).fill(0xffffff);
    };
    placeContent(w,h);
    refresh();
    return {
      view,
      rows,
      header,
      switcher,
      background,
      outerBackground,
      contentMask,
      resize(width, height) {
        view.layout = { width, height };
        const each =
          (tabsContentBox(skin.profile,insets,width,height).surface.width -
            Math.max(0, rows.length - 1) * skin.profile.geometry.tabGap) /
          Math.max(1, rows.length);
        for (const row of rows)
          resizeButton(row, skin, each, skin.profile.itemHeight);
        header.arrangeChildren();
        placeContent(width,height);
      },
      state: () => ({ activeId: active }),
      setState: (s) => {
        active = s.activeId;
        const i = p.tabs.findIndex((t) => t.id === active);
        if (i >= 0) switcher.forceSwitch(i);
        refresh();
      },
    };
  },
  "pixi.scroll-view"(c) {
    const pad = scrollPadding(c.skin.profile,c.skin.insets('skin.surface.content'));
    const { skin, p, w, h, listen, emit, children, handle } = c,
      view = new Container(),
      background = skin.view('skin.surface.content', w, h),
      box = new OwnedScrollBox({
        type: "vertical",
        width:
          w - pad.left - pad.right -
          skin.profile.geometry.scrollbarWidth -
          skin.profile.geometry.scrollbarGap,
        height: h - pad.top - pad.bottom,
        globalScroll: false,
        disableEasing: true,
        padding: 0,
        radius: 0,
      });
    box.inputAllowed = () => handle.allowed();
    const content = children("content")[0];
    box.addItem(content.root);
    box.position.set(pad.left, pad.top);
    view.addChild(background, box);
    let offset = p.initialOffsetY,
      suppress = false;
    const track = skin.view(
        "skin.scrollbar.track",
        skin.profile.geometry.scrollbarWidth,
        h - pad.top - pad.bottom,
      ),
      thumb = skin.view(
        "skin.scrollbar.thumb",
        skin.profile.geometry.scrollbarWidth,
        skin.profile.geometry.minThumbLength,
      ),
      bar = new VerticalScrollbar({
        bg: track,
        fill: new Graphics().rect(0, 0, 1, 1).fill({ color: 0, alpha: 0 }),
        slider: thumb,
        min: 0,
        max: 1,
        step: 1,
        value: 0,
      });
    view.addChild(bar);
    const sync = () => {
      const max = Math.max(0, box.contentHeight - box.height);
      offset = Math.min(max, Math.max(0, -box.scrollY));
      suppress = true;
      const length = Math.min(
        box.height,
        Math.max(
          skin.profile.geometry.minThumbLength,
          (box.height * box.height) / Math.max(box.height, box.contentHeight),
        ),
      );
      bar.resizeTrack(box.height, length);
      bar.position.set(pad.left + box.width + skin.profile.geometry.scrollbarGap, pad.top);
      bar.max = Math.max(1, max);
      bar.value = offset;
      suppress = false;
      bar.visible =
        p.scrollbar === "always" || (p.scrollbar === "auto" && max > 0);
      bar.eventMode = max > 0 ? "passive" : "none";
    };
    listen(box.onScroll, () => {
      sync();
      emit("scroll", { offsetY: offset });
    });
    listen(bar.onUpdate, (value) => {
      if (suppress) return;
      box.scrollY = -value;
      box.update();
      sync();
      emit("scroll", { offsetY: offset });
    });
    const refresh = () => {
      box.resize(true);
      box.scrollY = -Math.min(
        offset,
        Math.max(0, box.contentHeight - box.height),
      );
      box.update();
      sync();
    };
    return {
      view,
      background,
      box,
      bar,
      afterLayout() {
        box.resize(true);
        const max = Math.max(0, box.contentHeight - box.height);
        if (p.initialOffsetY > max)
          reject("scroll.offset", "Initial offset exceeds measured content.");
        box.scrollY = -offset;
        box.update();
        sync();
      },
      resize(w, h) {
        background.width = w;
        background.height = h;
        box.setSize(
          w - pad.left - pad.right -
            skin.profile.geometry.scrollbarWidth -
            skin.profile.geometry.scrollbarGap,
          h - pad.top - pad.bottom,
        );
        refresh();
      },
      childResized: refresh,
      suspend: () => bar.cancel(),
      state: () => ({ initialOffsetY: offset }),
      setState: (s) => {
        if (s.initialOffsetY > Math.max(0, box.contentHeight - box.height))
          reject("scroll.offset", "Offset exceeds measured content.");
        offset = s.initialOffsetY;
        box.scrollY = -offset;
        box.update();
        sync();
      },
    };
  },
  "pixi.dialog"(c) {
    const { skin, p, w, h, listen, emit, children, runtime, handle } = c,
      buttons = p.actions.map((a) =>
        makeButton(
          skin,
          a.label,
          Math.max(48, (w - 32) / Math.max(1, p.actions.length) - 8),
          32,
          a.variant,
        ),
      );
    const view = new SkinnedDialog({
      skin,
      inputAllowed: () => handle.allowed() && view.isOpen,
      background: skin.texture("skin.surface.panel"),
      width: w,
      height: h,
      padding: skin.profile.padding,
      title: p.title ? skin.label(p.title, w - 24) : undefined,
      titleSource: p.title,
      content: children("content")[0].root,
      buttons,
      buttonList: { elementsMargin: skin.profile.geometry.labelGap },
      closeOnBackdropClick: false,
      scrollBox: {
        padding: 0,
        type: "vertical",
        globalScroll: false,
        disableEasing: true,
      },
    });
    let open = p.open;
    const returnToRoot = () => {
      runtime.overlay.release(handle);
      handle.root.addChild(view);
      view.position.set(handle.size.width / 2, handle.size.height / 2);
    };
    const mount = () => {
      if (!handle.root.parent) return;
      const { width, height } = handle.size;
      const pos = handle.root.toGlobal({ x: width / 2, y: height / 2 });
      if (p.modal && handle.allowed(true)) {
        runtime.suspendExcept(handle);
        runtime.overlay.acquire(handle, view, p.closeOnBackdrop);
        view.position.set(pos.x, pos.y);
      } else {
        returnToRoot();
      }
      if (!view.isOpen) view.open();
    };
    listen(view.onSelect, (index) => {
      if (!view.isOpen) return;
      const action = p.actions[index];
      emit("action", { actionId: action.id });
      if (action.closeOnActivate) view.close();
    });
    listen(view.onClose, () => {
      open = false;
      emit("closed", {});
    });
    view.onVisualClose=returnToRoot;
    view.onVisualProgress=alpha=>{const modal=runtime.overlay.modals.find(m=>m.owner===handle);if(modal)modal.layer.children[0].alpha=alpha;};
    for(const button of buttons)listen(button.onDown,()=>{if(handle.allowed()&&view.isOpen)runtime.focus(handle,false);});
    return {
      view,
      buttons,
      afterLayout() {
        if (open) mount();
      },
      resize: (w, h) => view.resizeBox(w, h),
      suspend() {
        // Suspending interaction does not close the logical window or hide
        // its editable skin. A modal releases its overlay and stays in its box.
        view.motionDriver?.finish();returnToRoot();
      },
      resume() {
        if (open) mount();
      },
      state: () => ({ open }),
      setState: (s) => {
        open = s.open;
        if (open) mount();
        else if (!s.open) view.close();
      },
    };
  },
};

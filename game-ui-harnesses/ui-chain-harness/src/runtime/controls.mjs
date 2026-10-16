import { Container, Rectangle, Graphics, Texture } from "pixi.js";
import {
  FancyButton,
  Select,
  Input,
  Slider,
  ScrollBox,
  Dialog,
} from "@pixi/ui";
import { fitText } from "./skin.mjs";
import {createLayerSurface} from './layer-surface.mjs';

// Display the normalized range while preserving the control's actual value.
export function percentLabel(value, min, max) {
  return `${Math.round(100 * Math.max(0, Math.min(1, (value - min) / (max - min))))}%`;
}

export function reflowLabel(text, value, width, height = 10000) {
  text.scale.set(1);
  text.text = String(value).replace(/\s+/g, " ");
  fitText(text, Math.max(0, width), height, "ellipsis");
  return text;
}
export function resizeButton(
  button,
  skin,
  width,
  height,
  label = button.labelSource,
  textWidth,
) {
  const roles = button.skinRoles ?? [];
  for (const role of roles) skin.assertView?.(role,width,height);
  const pads = roles.map(role=>skin.insets(role));
  const pad = Object.fromEntries(["left","top","right","bottom"].map(k=>[k,Math.max(0,...pads.map(p=>p[k]))]));
  textWidth ??= width - (pads.length ? pad.left + pad.right : 2 * skin.profile.padding);
  // FancyButton.width without its own nineSlice option scales the container.
  // These views are already NineSliceSprites: resize views and remeasure text.
  button.scale.set(1);
  button.innerView.scale.set(1);
  for (const key of ["defaultView", "pressedView", "hoverView", "disabledView"])
    if (button[key]) {
      button[key].width = width;
      button[key].height = height;
    }
  const text = button.labelView ?? button._views.textView;
  if (text) reflowLabel(text, label ?? "", textWidth, height-pad.top-pad.bottom);
  button.contentFittingMode = "none";
  button.updateAnchor();
  if (text && pads.length) { text.x += (pad.left-pad.right)/2; text.y += (pad.top-pad.bottom)/2; }
  button.hitArea = new Rectangle(0, 0, width, height);
}

export function makeButton(
  skin,
  label,
  width,
  height,
  variant = "primary",
  roles,
) {
  const [normal, pressed] = roles ?? [
    `skin.button.${variant}.normal`,
    `skin.button.${variant}.pressed`,
  ];
  const hover = skin.view(normal, width, height);
  hover.tint = skin.profile.hoverTint;
  const disabled = skin.view(normal, width, height);
  disabled.alpha = skin.profile.disabledAlpha;
  const labelView = skin.label(label, width - 2 * skin.profile.padding);
  const button = new FancyButton({
    defaultView: skin.view(normal, width, height),
    pressedView: skin.view(pressed, width, height),
    hoverView: hover,
    disabledView: disabled,
    text: labelView,
    contentFittingMode: "none",
    padding: 0,
  });
  button.labelView = labelView;
  button.labelSource = label;
  button.skinRoles = [normal, pressed];
  resizeButton(button, skin, width, height);
  return button;
}

// Selection uses the skin's selected artwork, including hover/disabled views.
// Dispose replaced display objects while retaining shared skin textures.
export function selectButtonSkin(button, skin, selected) {
  const role = button.skinRoles[selected ? 1 : 0];
  if (button.selectionRole === role) return;
  const width = button.defaultView.width, height = button.defaultView.height;
  for (const key of ['defaultView', 'hoverView', 'disabledView']) {
    const previous = button[key], next = skin.view(role, width, height);
    if (key === 'hoverView') next.tint = skin.profile.hoverTint;
    if (key === 'disabledView') next.alpha = skin.profile.disabledAlpha;
    button[key] = next;
    previous.destroy({children:true});
  }
  button.selectionRole = role;
  resizeButton(button, skin, width, height);
}

export class OwnedInput extends Input {
  align() {
    super.align();
    if (!this._bg) return;
    const center = (this._bg.height + this.paddingTop - this.paddingBottom) / 2;
    for (const item of [this.inputField, this.placeholder, this._cursor])
      if (item) item.y = center;
    this.drawSelection();
  }
  startEditing() {
    this._startEditing();
  }
  // Sprite masks multiply by the red channel: using a dark skin as the mask
  // dims text. Keep PixiUI's mask sizing/ownership, with an opaque white source.
  createInputMask() {
    super.createInputMask(Texture.WHITE);
  }
  suspend() {
    this.stopEditing();
    this.removeInputField();
  }
  setReadOnly(value) {
    this.readOnly = value;
  }
  createInputField() {
    super.createInputField();
    if (this.input) {
      this.input.readOnly = !!this.readOnly;
      const typography=this.options.nativeTypography;
      if(typography?.fontSize!==undefined){
        this.input.style.fontSize=typography.fontSize+'px';
        this.input.style.fontFamily=typography.fontFamily;
      }
      if(typography?.textColor!==undefined){
        this.input.style.color=typography.textColor;
        this.input.style.caretColor=typography.textColor;
      }
    }
  }
}

// The package rounds around zero; the Harness contract quantizes relative to min.
// Keep the package pointer/drag plumbing and replace just its value mapping.
export class ContractSlider extends Slider {
  constructor(options) {
    super(options);
    this.cancelBinding = () => this.cancel();
    document.addEventListener("pointercancel", this.cancelBinding, true);
  }
  startUpdate(event) {
    super.startUpdate(event);
    this.onThumbPressed?.(true);
  }
  endUpdate() {
    super.endUpdate();
    this.onThumbPressed?.(false);
  }
  update(event) {
    if (!this.dragging) return;
    const x = this.bg.toLocal(event.global).x,
      ratio = Math.max(0, Math.min(1, x / this.bg.width));
    const raw = this.min + ratio * (this.max - this.min),
      value =
        ratio === 1
          ? this.max
          : this.min + Math.round((raw - this.min) / this.step) * this.step;
    this.value = Math.max(
      this.min,
      Math.min(this.max, Number(value.toPrecision(12))),
    );
  }
  updateSlider() {
    super.updateSlider();
    if (!this.value1Text || !this._slider1 || !this.bg) return;
    // Percentage labels must not protrude at either endpoint.
    const inset = this._slider1.width / 2,
      label = this.value1Text;
    reflowLabel(label, percentLabel(this.value, this.min, this.max), this.bg.width + inset * 2);
    label.x = Math.max(
      -inset + label.width / 2,
      Math.min(this.bg.width + inset - label.width / 2, label.x),
    );
  }
  // Presentation only: value and all value signals remain authoritative.
  presentValue(value) {
    if(!this._slider1||!this.bg)return;
    const ratio=Math.max(0,Math.min(1,(value-this.min)/(this.max-this.min)));
    this.progress=ratio*100;
    this._slider1.x=this.bg.width*ratio-this._slider1.width/2;
    if(this.value1Text)this.value1Text.x=Math.max(-this._slider1.width/2+this.value1Text.width/2,Math.min(this.bg.width+this._slider1.width/2-this.value1Text.width/2,this.bg.width*ratio));
  }
  cancel() {
    this.onThumbPressed?.(false);
    if (!this.dragging) return;
    this.dragging = 0;
    this.value = this.startUpdateValue1;
  }
  change() {
    this.onChange?.emit(this.value);
  }
  destroy(options) {
    document.removeEventListener("pointercancel", this.cancelBinding, true);
    super.destroy(options);
  }
}

// Preserve the source skin's vertical axis and slice corners. Rotating and
// scaling a horizontal Slider would stretch both the track and its thumb.
export class VerticalScrollbar extends ContractSlider {
  update(event) {
    if (!this.dragging) return;
    const thumbHeight = this.slider1.height;
    const y = this.bg.toLocal(event.global).y - thumbHeight / 2;
    const travel = Math.max(1, this.bg.height - thumbHeight);
    this.value =
      this.min +
      Math.round(Math.max(0, Math.min(1, y / travel)) * (this.max - this.min));
  }
  updateSlider() {
    if (!this._slider1 || !this.bg) return;
    const thumb = this._slider1.children[0];
    thumb.position.set(0, 0);
    const ratio =
      this.max === this.min
        ? 0
        : ((this.value ?? this.min) - this.min) / (this.max - this.min);
    this._slider1.position.set(
      (this.bg.width - thumb.width) / 2,
      ratio * Math.max(0, this.bg.height - thumb.height),
    );
  }
  resizeTrack(height, thumbHeight) {
    this.bg.height = height;
    this._slider1.children[0].height = thumbHeight;
    this.updateSlider();
  }
}

export class OwnedScrollBox extends ScrollBox {
  static live = new Set();
  constructor(options) {
    super(options);
    OwnedScrollBox.live.add(this);
  }
  inputAllowed = () => true;
  get contentHeight() {
    return this.listHeight;
  }
  onMouseScroll(event) {
    if (!this.inputAllowed() || !this.isOver) return;
    // The upstream package listens at document capture level. Resolve nested
    // ownership explicitly so a single wheel never moves two scroll areas.
    for (const other of OwnedScrollBox.live) {
      if (other === this || !other.isOver || !other.inputAllowed()) continue;
      for (let parent = other.parent; parent; parent = parent.parent)
        if (parent === this) return;
    }
    super.onMouseScroll(event);
  }
  disposeContent() {
    for (const child of [...this.items]) {
      child.removeFromParent();
      child.destroy({ children: true });
    }
  }
  destroy(options) {
    OwnedScrollBox.live.delete(this);
    this.disposeContent();
    super.destroy(options);
  }
}

export class SkinnedSelect extends Select {
  constructor({ skin, props, width, height, overlay, allowed, track }) {
    super();
    this.skin = skin;
    this.model = props;
    this.overlay = overlay;
    this.allowed = allowed;
    this.track = track;
    this.box = { width, height };
    this.rows = [];
    this.scrollBox = new OwnedScrollBox();
    this.scrollBox.inputAllowed = () => this.expanded && this.allowed();
    this.view.addChild(this.scrollBox);
    const selected =
      props.selectedId === null
        ? -1
        : props.options.findIndex((x) => x.id === props.selectedId);
    this.init({
      closedBG: skin.view("skin.field.normal", width, height),
      openBG: skin.view(
        "skin.surface.popup",
        width,
        height +
          Math.min(props.options.length, props.maxVisibleItems) *
            skin.profile.itemHeight,
      ),
      textStyle: skin.textStyle(),
      selected,
      items: {
        items: props.options.map((o) => o.label),
        width,
        height: skin.profile.itemHeight,
        backgroundColor: 0,
      },
      visibleItems: props.maxVisibleItems,
      scrollBox: { globalScroll: false, disableEasing: true, padding: 0 },
    });
    // init() adds the popup background after our owned ScrollBox. Move the
    // rows above it; otherwise the list is clickable but painted underneath.
    this.view.addChild(this.scrollBox);
    this.setSelection(props.selectedId);
    this.indicator = skin.view(
      "skin.select.chevron",
      skin.profile.geometry.indicatorWidth,
      skin.profile.geometry.indicatorHeight,
    );
    this.addChild(this.indicator);
    this.revealMask = new Graphics();
    this.revealMask.eventMode = 'none';
    this.view.addChild(this.revealMask);
    this.view.mask = this.revealMask;
    this.expanded = false;
    this.motionProgress = 0;
    this.openButton.hitArea = new Rectangle(0, 0, width, height);
    this.closeButton.hitArea = new Rectangle(0, 0, width, height);
    this.resizeBox(width, height);
  }
  convertItemsToButtons() {
    return this.model.options.map((option) => {
      const button = makeButton(
        this.skin,
        option.label,
        this.box.width,
        this.skin.profile.itemHeight,
        "primary",
        ["skin.item.normal", "skin.item.selected"],
      );
      button.enabled = option.enabled;
      this.rows.push(button);
      return button;
    });
  }
  setSelection(id) {
    const label =
      this.model.options.find((o) => o.id === id)?.label ??
      this.model.placeholder;
    this.value = this.model.options.findIndex((o) => o.id === id);
    const { width, height } = this.box;
    for (const button of [this.openButton, this.closeButton]) {
      button.skinRoles = ["skin.field.normal"];
      if (!button._views.textView)
        button.createTextView(this.skin.label(label, width));
      button.defaultTextScale = { x: 1, y: 1 };
      resizeButton(
        button,
        this.skin,
        width,
        height,
        label,
        width -
          this.skin.insets("skin.field.normal").left - this.skin.insets("skin.field.normal").right -
          2 *
            (this.skin.profile.geometry.indicatorWidth +
              this.skin.profile.geometry.labelGap),
      );
    }
  }
  resizeBox(width, height) {
    this.box = { width, height };
    this.motionDriver?.finish();
    this.setSelection(this.model.options[this.value]?.id ?? null);
    const menuHeight =
      Math.min(this.model.options.length, this.model.maxVisibleItems) *
      this.skin.profile.itemHeight;
    this.openView.width = width;
    this.openView.height = height + menuHeight;
    this.scrollBox.setSize(width, menuHeight);
    this.scrollBox.y = height;
    for (const row of this.rows) {
      resizeButton(row, this.skin, width, this.skin.profile.itemHeight);
    }
    this.scrollBox.resize(true);
    const g = this.skin.profile.geometry;
    this.indicator.position.set(
      width - g.indicatorWidth - Math.max(g.labelGap,this.skin.insets("skin.field.normal").right),
      (height - g.indicatorHeight) / 2,
    );
    this.applyReveal(this.expanded ? 1 : 0);
    if (this.view.visible) this.place();
  }
  open() {
    if (!this.allowed()) return;
    if (this.expanded) return;
    this.expanded = true;
    this.overlay.closeSelects(this);
    super.open();
    this.view.eventMode = 'passive';
    this.overlay.root.addChild(this.view);
    this.view.addChild(this.indicator);
    this.overlay.selects.add(this);
    this.place();
    if (!this.motionDriver?.play(true)) this.applyReveal(1);
  }
  applyReveal(value) {
    this.motionProgress = Math.max(0,Math.min(1,value));
    if (!this.revealMask) return;
    const g=this.skin.profile.geometry, menu=Math.min(this.model.options.length,this.model.maxVisibleItems)*this.skin.profile.itemHeight;
    this.revealMask.clear().rect(0,0,this.box.width,this.box.height+menu*this.motionProgress).fill(0xffffff);
    this.scrollBox.alpha=this.motionProgress;
    this.indicator.pivot.set(g.indicatorWidth/2,g.indicatorHeight/2);
    this.indicator.position.set(this.box.width-g.indicatorWidth/2-Math.max(g.labelGap,this.skin.insets('skin.field.normal').right),this.box.height/2);
    this.indicator.rotation=Math.PI*this.motionProgress;
  }
  finishClose() {
    if (this.expanded || !this.view || this.view.destroyed) return;
    this.view.visible=false;
    this.addChild(this.view);
    if(this.indicator)this.addChild(this.indicator);
  }
  close(immediate = false) {
    const wasOpen=this.expanded;
    if(!wasOpen&&!immediate&&this.motionDriver&&this.motionProgress>0)return;
    this.expanded=false;
    super.close();
    this.overlay?.selects.delete(this);
    if (this.view) this.view.eventMode='none';
    if (this.model && this.openButton)
      this.setSelection(this.model.options[this.value]?.id ?? null);
    if(immediate) this.motionDriver?.finish();
    if(!immediate && wasOpen && this.motionDriver){
      this.view.visible=true;
      if(this.motionDriver.play(false,()=>this.finishClose()))return;
    }
    this.applyReveal(0);this.finishClose();
  }
  toggle() {
    this.expanded ? this.close() : this.open();
  }
  place() {
    const pos = this.toGlobal({ x: 0, y: 0 }),
      h =
        this.box.height +
        Math.min(this.model.options.length, this.model.maxVisibleItems) *
          this.skin.profile.itemHeight;
    this.view.position.set(
      Math.max(0, Math.min(this.overlay.width - this.box.width, pos.x)),
      Math.max(0, Math.min(this.overlay.height - h, pos.y)),
    );
  }
  containsGlobal(point) {
    return (
      this.getBounds().containsPoint(point.x, point.y) ||
      this.view.getBounds().containsPoint(point.x, point.y)
    );
  }
  suspend() {
    this.close(true);
  }
  destroy(options) {
    this.close(true);
    this.motionDriver=null;
    for (const row of this.rows) {
      row.removeFromParent();
      row.destroy({ children: true });
    }
    super.destroy(options);
  }
}

// Dialog's default inner view adds children to a sprite; keep a container as the
// inner view and let the base Dialog retain content/button/open/close behavior.
export class SkinnedDialog extends Dialog {
  constructor(options) {
    super(options);
    const old = this.scrollBox,
      items = [...old.items],
      { width, height, x, y } = old;
    for (const item of items) item.removeFromParent();
    old.destroy();
    this.scrollBox = new OwnedScrollBox({
      ...options.scrollBox,
      width,
      height,
    });
    this.scrollBox.inputAllowed = options.inputAllowed;
    this.scrollBox.position.set(x, y);
    this.scrollBox.addItems(items);
    this.contentView.addChild(this.scrollBox);
    this.resizeBox(options.width, options.height);
  }
  initBackdrop() {
    this.addChild(this.backdrop);
  }
  initInnerView() {
    const { skin, width, height } = this.options;
    this.innerView = new Container();
    this.layerSurface=this.options.surfaceLayer?createLayerSurface(skin,this.options.surfaceLayer,width,height,{scale:this.options.surfaceScale}):null;
    this.innerView.addChild(
      this.layerSurface?.view??skin.view("skin.surface.panel", width, height),
      this.contentView,
    );
    this.innerView.position.set(-width / 2, -height / 2);
    this.innerView.eventMode = "static";
    this.innerView.hitArea = new Rectangle(0, 0, width, height);
    this.addChild(this.innerView);
  }
  applyReveal(value,profile) {
    this.motionProgress=Math.max(0,Math.min(1,value));
    const t=this.motionProgress,s=profile?profile.enterScale+(1-profile.enterScale)*value:1;
    this.innerView.scale.set(s);
    this.innerView.alpha=t;
    this.innerView.position.set(-this.options.width*s/2,-this.options.height*s/2+(profile?.enterOffsetY??0)*(1-t));
    this.onVisualProgress?.(t);
  }
  open() {
    if(this.isOpen)return;
    super.open();this.eventMode='passive';
    if(!this.motionDriver?.play(true))this.applyReveal(1);
  }
  finishClose() {
    if(this.isOpen)return;
    this.visible=false;this.onVisualClose?.();
  }
  close() {
    if (!this.isOpen)return;
    super.close();this.eventMode='none';
    if(this.motionDriver){this.visible=true;if(this.motionDriver.play(false,()=>this.finishClose()))return;}
    this.applyReveal(0);this.finishClose();
  }
  resizeBox(width, height) {
    this.motionDriver?.finish();
    const oldWidth = this.options.width,
      oldHeight = this.options.height;
    this.options.width = width;
    this.options.height = height;
    const bg = this.innerView.children[0];
    if(this.layerSurface)this.layerSurface.resize(width,height);else {bg.width = width;bg.height = height;}
    this.innerView.hitArea = new Rectangle(0, 0, width, height);
    this.innerView.position.set(-width / 2, -height / 2);
    this.position.x += (width - oldWidth) / 2;
    this.position.y += (height - oldHeight) / 2;
    const { skin } = this.options,
      g = skin.profile.geometry;
    if (this.titleText) {
      reflowLabel(
        this.titleText,
        this.options.titleSource ?? "",
        width - 2 * this.dialogPadding,
        g.lineHeight,
      );
      this.titleText.position.set(width / 2, this.dialogPadding);
    }
    const buttons = this.options.buttons ?? [],
      gap = g.labelGap;
    const buttonWidth =
      (width - 2 * this.dialogPadding - Math.max(0, buttons.length - 1) * gap) /
      Math.max(1, buttons.length);
    for (const b of buttons)
      resizeButton(b, skin, buttonWidth, skin.profile.itemHeight);
    this.buttonContainer.arrangeChildren();
    this.buttonContainer.x = width / 2 - this.buttonContainer.width / 2;
    this.buttonContainer.y =
      height - this.dialogPadding - this.buttonContainer.height;
    const titleHeight = this.titleText ? g.lineHeight + g.titleGap : 0;
    const buttonHeight = buttons.length ? skin.profile.itemHeight + gap : 0;
    this.scrollBox.position.set(
      this.dialogPadding,
      this.dialogPadding + titleHeight,
    );
    this.scrollBox.setSize(
      width - 2 * this.dialogPadding,
      height - 2 * this.dialogPadding - titleHeight - buttonHeight,
    );
    this.scrollBox.resize(true);
  }
  destroy(options) {
    this.motionDriver?.finish();this.motionDriver=null;
    for (const child of [...(this.scrollBox?.items ?? [])])
      child.removeFromParent();
    super.destroy(options);
  }
}

export class OverlayOwner {
  constructor(app) {
    this.app = app;
    this.root = new Container();
    this.root.eventMode = "passive";
    this.selects = new Set();
    this.modals = [];
    this.width = app.screen.width;
    this.height = app.screen.height;
    app.stage.addChild(this.root);
    this.outside = (e) => {
      const rect = app.canvas.getBoundingClientRect(),
        point = {
          x: ((e.clientX - rect.left) * this.width) / rect.width,
          y: ((e.clientY - rect.top) * this.height) / rect.height,
        };
      for (const select of [...this.selects])
        if (!select.containsGlobal(point)) select.close();
    };
    document.addEventListener("pointerdown", this.outside, true);
  }
  closeSelects(except) {
    for (const select of [...this.selects])
      if (select !== except) select.close();
  }
  acquire(owner, dialog, closeOnBackdrop) {
    if (this.modals.some((m) => m.owner === owner)) return;
    this.closeSelects();
    const layer = new Container(),
      shield = new Graphics()
        .rect(0, 0, this.width, this.height)
        .fill({ color: 0x020916, alpha: 0.55 });
    shield.eventMode = "static";
    shield.hitArea = new Rectangle(0, 0, this.width, this.height);
    const backdrop = new FancyButton({ defaultView: shield });
    const connection = backdrop.onPress.connect(() => {
      if (closeOnBackdrop) dialog.close();
    });
    layer.addChild(backdrop, dialog);
    this.root.addChild(layer);
    this.modals.push({ owner, layer, connection, dialog });
  }
  release(owner) {
    const i = this.modals.findIndex((m) => m.owner === owner);
    if (i < 0) return;
    const [m] = this.modals.splice(i, 1);
    m.connection.disconnect();
    m.dialog.removeFromParent();
    m.layer.destroy({ children: true });
  }
  allows(handle) {
    const top = this.modals.at(-1)?.owner;
    if (!top) return true;
    for (let n = handle; n; n = n.parent) if (n === top) return true;
    return false;
  }
  dispose() {
    this.closeSelects();
    for (const m of [...this.modals]) this.release(m.owner);
    document.removeEventListener("pointerdown", this.outside, true);
    this.root.destroy({ children: true });
  }
}

import { Container, NineSliceSprite } from 'pixi.js';
import { measureSlices } from './geometry.mjs';

// Owns its view, never its shared texture. Layout sees only the outer logical
// size. Keep the private NineSlice out of Yoga/PixiUI width setters: its size
// includes the density multiplier and its UV boundaries must remain unchanged.
export class SlicedBackground extends Container {
  constructor({ texture, borders, width, height, multiplier = 1, resizePolicy }) {
    const geometry = measureSlices({ sourceWidth: texture.orig.width, sourceHeight: texture.orig.height, borders, width, height, multiplier, resizePolicy });
    super();
    this.resizePolicy = resizePolicy;
    this.eventMode = 'none';
    this._borders = Object.freeze({ ...borders });
    this.slice = new NineSliceSprite({ texture, leftWidth: borders.left, topHeight: borders.top, rightWidth: borders.right, bottomHeight: borders.bottom });
    this.addChild(this.slice);
    this._apply(geometry);
  }
  _apply(geometry) {
    this.geometry = Object.freeze(geometry);
    this.slice.setSize(geometry.innerWidth, geometry.innerHeight);
    this.slice.scale.set(geometry.scale);
  }
  resize(width, height, multiplier = this.geometry.multiplier) {
    const geometry = measureSlices({ sourceWidth: this.texture.orig.width, sourceHeight: this.texture.orig.height, borders: this._borders, width, height, multiplier, resizePolicy: this.resizePolicy });
    this._apply(geometry);
  }
  setSize(value, height) {
    const size = typeof value === 'object' ? value : { width: value, height: height ?? value };
    this.resize(size.width, size.height ?? size.width);
  }
  get texture() { return this.slice.texture; }
  get leftWidth() { return this._borders.left; }
  get topHeight() { return this._borders.top; }
  get rightWidth() { return this._borders.right; }
  get bottomHeight() { return this._borders.bottom; }
  get width() { return this.geometry.width; }
  set width(value) { this.resize(value, this.height); }
  get height() { return this.geometry.height; }
  set height(value) { this.resize(this.width, value); }
  destroy(options) {
    super.destroy({ ...(typeof options === 'object' ? options : {}), children: true, texture: false, textureSource: false });
  }
}

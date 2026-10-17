import { Texture, Sprite, NineSliceSprite, Text } from "pixi.js";
import { validateFixtureProfile } from "./geometry.mjs";

export function reject(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
export function createFixtureSkin(template, usage, profile) {
  validateFixtureProfile(profile);
  if (
    profile.kind !== "ui_programmatic_skin_fixture" ||
    profile.version !== "0.1"
  )
    reject(
      "fixture.kind",
      "Only explicit programmatic fixtures are supported.",
    );
  const textures = new Map(),
    metadata = new Map();
  let disposed = false;
  for (const part of template.sheets.flatMap((s) => s.parts)) {
    const [, , width, height] = part.bodyRect,
      canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d"),
      primitive = part.primitive;
    ctx.fillStyle = profile.palette[part.paint];
    ctx.strokeStyle = profile.palette.stroke;
    ctx.lineWidth = part.strokeWidth;
    ctx.beginPath();
    if (primitive.type === "roundRect")
      ctx.roundRect(1, 1, width - 2, height - 2, primitive.radius);
    else if (primitive.type === "circle" || primitive.type === "ring")
      ctx.arc(width / 2, height / 2, width / 2 - 2, 0, Math.PI * 2);
    else if (primitive.type === "polygon") {
      primitive.points.forEach(([x, y], i) =>
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y),
      );
      ctx.closePath();
    } else reject("fixture.primitive", "Unsupported fixture primitive.");
    if (primitive.type !== "ring") ctx.fill();
    if (part.strokeWidth) {
      if (primitive.type === "ring")
        ctx.strokeStyle = profile.palette[part.paint];
      ctx.stroke();
    }
    const texture = Texture.from(canvas);
    textures.set(part.assetId, texture);
    metadata.set(part.assetId, {
      width,
      height,
      stretch: part.stretch,
      slice: Math.max(
        1,
        Math.min(profile.slice, Math.floor(width / 4), Math.floor(height / 4)),
      ),
    });
  }
  const roles = new Map(usage.bindings.map((b) => [b.role, b.assetId]));
  const requireAsset = (id) => {
    if (disposed || !textures.has(id))
      reject("skin.asset", `Missing fixture asset: ${id}`);
    return textures.get(id);
  };
  const assetForRole = (role) => {
    if (!roles.has(role)) reject("skin.role", `Missing skin role: ${role}`);
    return roles.get(role);
  };
  const skin = {
    profile,
    sourceKind: "fixture",
    textures,
    metadata,
    roles,
    texture(role) {
      return requireAsset(assetForRole(role));
    },
    slice(role) {
      return metadata.get(assetForRole(role)).slice;
    },
    tuple(role) {
      const s = this.slice(role);
      return [s, s, s, s];
    },
    insets(role) {
      return {left:profile.padding,right:profile.padding,top:role === "skin.surface.panel" ? profile.padding : 0,bottom:role === "skin.surface.panel" ? profile.padding : 0};
    },
    backgroundSpec(role) {
      const texture = this.texture(role), s = this.slice(role);
      return { texture, borders: { left: s, top: s, right: s, bottom: s } };
    },
    view(role, width, height) {
      const id = assetForRole(role),
        texture = requireAsset(id),
        m = metadata.get(id);
      if (width <= 0 || height <= 0)
        reject("skin.size", "Positive view dimensions required.");
      const view =
        m.stretch === "uniform"
          ? new Sprite({ texture })
          : new NineSliceSprite({
              texture,
              leftWidth: m.slice,
              topHeight: m.slice,
              rightWidth: m.slice,
              bottomHeight: m.slice,
            });
      view.width = width;
      view.height = height;
      view.eventMode = "none";
      return view;
    },
    textStyle(extra = {}) {
      return {
        fontFamily: profile.fontFamily,
        fontSize: profile.fontSize,
        fill: profile.palette.text,
        ...extra,
      };
    },
    label(value, width, extra = {}) {
      return fitText(
        new Text({
          text: String(value).replace(/\s+/g, " "),
          style: this.textStyle(extra),
        }),
        width,
        10000,
        "ellipsis",
      );
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const texture of textures.values()) texture.destroy(true);
      textures.clear();
    },
  };
  return skin;
}

export function fitText(text, width, height, overflow) {
  if (text.width <= width && text.height <= height) return text;
  if (overflow === "error") {
    reject("text.overflow", "Text exceeds its declared box.");
  }
  if (overflow === "ellipsis") {
    const segments = [
      ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
        text.text,
      ),
    ].map((x) => x.segment);
    let lo = 0,
      hi = segments.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      text.text = segments.slice(0, mid).join("") + "…";
      if (text.width <= width && text.height <= height) lo = mid;
      else hi = mid - 1;
    }
    text.text = lo ? segments.slice(0, lo).join("") + "…" : "…";
    if (text.width > width || text.height > height) text.text = "";
  }
  return text;
}

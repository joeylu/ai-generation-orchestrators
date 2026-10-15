import Ajv from "ajv";
import schema from "../../schemas/fixture-profile.schema.json" with { type: "json" };
import themeSchema from "../../schemas/runtime-theme.schema.json" with { type: "json" };
const validate = new Ajv({ allErrors: true, strict: true }).addSchema(themeSchema, 'runtime-theme').compile(schema);
export function validateFixtureProfile(profile) {
  if (!validate(profile)) {
    const e = new Error("Invalid engineering skin profile.");
    e.code = "fixture.profile";
    e.issues = structuredClone(validate.errors);
    throw e;
  }
}
export function minimumSize(type, p, s) {
  const g = s.geometry,
    content = g.minContent,
    label = s.padding * 2 + content;
  let width = content,
    height = content;
  if (["Button", "Input", "List"].includes(type)) {
    width = label;
    height = g.lineHeight;
  }
  if (type === "Switch") {
    width = s.markSize * 2 + g.labelGap + content;
    height = Math.max(g.lineHeight, s.markSize);
  }
  if (type === "CheckBox") {
    width = s.markSize + g.labelGap + content;
    height = Math.max(g.lineHeight, s.markSize);
  }
  if (type === "RadioGroup") {
    const n = p.options.length,
      item = s.markSize + g.labelGap + content;
    width =
      p.direction === "row" ? n * item + Math.max(0, n - 1) * s.gap : item;
    height =
      p.direction === "row"
        ? s.markSize
        : n * s.markSize + Math.max(0, n - 1) * s.gap;
  }
  if (type === "Select") {
    width = label + g.indicatorWidth + g.labelGap;
    height = g.lineHeight;
  }
  if (type === "Slider") {
    width = s.thumbSize + content;
    height = s.thumbSize + s.trackHeight + (p.showValue ? g.lineHeight : 0);
  }
  if (type === "ProgressBar") {
    height = s.trackHeight + (p.showValue ? g.labelGap + g.lineHeight : 0);
  }
  if (type === "ScrollView") {
    width = s.padding * 2 + content + g.scrollbarWidth + g.scrollbarGap;
    height = s.padding * 2 + Math.max(content, g.minThumbLength);
  }
  if (type === "Tabs") {
    width = s.padding * 2 + p.tabs.length * label + Math.max(0, p.tabs.length - 1) * g.tabGap;
    width = Math.max(width, s.padding * 4 + content);
    height = s.itemHeight + g.labelGap + s.padding * 4 + content;
  }
  if (type === "Panel") {
    const pad = p.contentPadding ?? {
      left: s.padding,
      right: s.padding,
      top: s.padding,
      bottom: s.padding,
    };
    width = pad.left + pad.right + content;
    height =
      pad.top +
      pad.bottom +
      (p.title ? g.lineHeight + g.titleGap : 0) +
      content;
  }
  if (type === "Dialog") {
    width =
      s.padding * 2 +
      p.actions.length * label +
      Math.max(0, p.actions.length - 1) * g.labelGap;
    height =
      s.padding * 2 +
      (p.title ? g.lineHeight + g.titleGap : 0) +
      content +
      (p.actions.length ? s.itemHeight + g.labelGap : 0);
  }
  return { width: Math.max(content, width), height: Math.max(content, height) };
}
export function assertSize(type, p, profile, width, height) {
  const min = minimumSize(type, p, profile);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < min.width ||
    height < min.height
  ) {
    const e = new Error(
      `${type} requires at least ${min.width}x${min.height} logical pixels for this fixture content.`,
    );
    e.code = "node.size";
    throw e;
  }
  return min;
}

import { fileURLToPath } from "node:url";
import { readJson, requireThat } from "../src/common.mjs";
import { visualStructure } from "../src/panel.mjs";
import { sdkPanels } from "./examples/sdk-fixed-panels.mjs";
import { sdkPanels as flowPanels } from "./examples/sdk-panels.mjs";
import {
  presentationLayout,
  settingsLayout,
} from "./examples/presentation-layouts.mjs";

// Only owned public examples are rendered. This is a layout illustration,
// not a new prototype compiler or generated style sample.
// User-selected defaults: retain the original settings design; other panels
// use SDK geometry with explicit presentation adjustments. Preview and import
// resolve the same selection; comparison aliases retain original geometry.
const selectedPanels = sdkPanels.map((item) =>
  item.spec.id === "sdk-settings"
    ? settingsLayout(flowPanels.find((panel) => panel.spec.id === item.spec.id))
    : presentationLayout(item),
);
export const templateList = selectedPanels.map(({ spec, ...item }) => {
  return {
    ...item,
    id: spec.id,
    name: `${item.groupName} · ${item.variant}`,
    width: spec.canvas.width,
    height: spec.canvas.height,
    image: `/api/templates/${spec.id}/image`,
  };
});

// Old IDs remain callable for existing integrations; only the SDK suite is
// offered to users. Original examples and accepted project artifacts stay intact.
const legacyIds = ["style-showcase", "main-menu", "exit-confirm"];
export function templateInput(id) {
  const selected = selectedPanels.find((item) => item.spec.id === id);
  const fixed = sdkPanels.find((item) => `fixed-${item.spec.id}` === id);
  const flow = flowPanels.find((item) => `flow-${item.spec.id}` === id);
  const owned = selected ?? fixed ?? flow;
  requireThat(owned || legacyIds.includes(id), "TEMPLATE_UNKNOWN");
  const spec = owned
    ? structuredClone(owned.spec)
    : readJson(
        fileURLToPath(new URL(`../examples/${id}.panel.json`, import.meta.url)),
      );
  let catalog =
    owned?.spec.panelSpecVersion === "fixed-reference-1"
      ? null
      : readJson(
          fileURLToPath(
            new URL(
              `../../ui-panel-harness/examples/${owned ? "modern-menu-headings-v2" : "modern-controls"}.catalog.json`,
              import.meta.url,
            ),
          ),
        );
  if (selected && id === "sdk-settings") {
    // The public producer's existing minimal presentation hides the repeated
    // first heading. Give this opt-in data variant its own theme identity.
    const sourceTheme = catalog.themes.find(
      (theme) => theme.id === "modern-mint-light" && theme.version === "0.20.0",
    );
    const theme = { ...sourceTheme, ...spec.theme };
    delete theme.headingStyle;
    catalog = {
      ...catalog,
      id: "ui-reference-settings",
      version: "0.1.0",
      themes: [theme],
    };
  }
  return { spec, catalog };
}

const previews = new Map();
const escapeXml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[char],
  );
const rect = (x, y, width, height, fill, radius = 8, stroke = "none") =>
  `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" stroke="${stroke}"/>`;
const text = (value, x, y, size = 18, anchor = "start") =>
  `<text x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}" dominant-baseline="central" fill="#33483e">${escapeXml(value)}</text>`;

async function renderTemplate(id) {
  const [{ loadWorkspaceCore }, { createPanelBundle }] = await Promise.all([
    import("../../ui-panel-harness/src/component-adapter.mjs"),
    import("../../ui-panel-harness/src/panel-bundle.mjs"),
  ]);
  const { spec, catalog } = templateInput(id),
    bundle = await createPanelBundle(spec, catalog, await loadWorkspaceCore()),
    nodes = visualStructure(bundle.componentBundle.document);
  const fixed = spec.panelSpecVersion === "fixed-reference-1";
  const props = new Map();
  function visit(node) {
    props.set(node.id, node.props ?? {});
    for (const child of node.children ?? []) visit(child);
  }
  visit(bundle.componentBundle.document.root);
  const body = nodes
    .map((node, index) => {
      const [x, y, w, h] = node.box,
        c = node.content;
      let content = "";
      const nodeProps = props.get(node.id) ?? {};
      if (fixed && node.type === "Container" && nodeProps.drawBackground)
        content = rect(
          x,
          y,
          w,
          h,
          node.id.includes(".metric.") ? "#edf2ee" : "#ffffff",
          nodeProps.style.cornerRadius,
          "#b8c8bf",
        );
      if (!fixed && index === 1 && node.type === "Container")
        content = rect(x, y, w, h, "#ffffff", 16, "#b8c8bf");
      if (node.type === "Text") {
        const centered =
          node.id.endsWith(".center-label") ||
          (fixed &&
            ((node.id.endsWith(".title") && node.id !== "sdk-settings.title") ||
              /\.(percentage|stage|error)$/.test(node.id)));
        const right = fixed && node.id.endsWith(".value");
        content = text(
          c.text ?? "",
          centered ? x + w / 2 : right ? x + w : x,
          y + h / 2,
          props.get(node.id)?.style?.fontSize ?? 18,
          centered ? "middle" : right ? "end" : "start",
        );
      }
      if (node.type === "Button")
        content =
          rect(
            x,
            y,
            w,
            h,
            "#e1ebe5",
            fixed ? nodeProps.style.cornerRadius : 9,
            "#9cb4a5",
          ) +
          (fixed
            ? text(
                c.label,
                x + w / 2,
                y + h / 2,
                nodeProps.style.fontSize,
                "middle",
              )
            : "");
      if (node.type === "Slider") {
        const ratio = Math.max(
          0,
          Math.min(1, (c.value - c.min) / (c.max - c.min)),
        );
        content =
          rect(x + 10, y + h / 2 - 4, w - 20, 8, "#e0e7e2", 4) +
          rect(x + 10, y + h / 2 - 4, (w - 20) * ratio, 8, "#739b82", 4) +
          `<circle cx="${x + 10 + (w - 20) * ratio}" cy="${y + h / 2}" r="10" fill="#557e64"/>`;
      }
      if (node.type === "ProgressBar") {
        const ratio = Math.max(0, Math.min(1, c.value / c.max));
        content =
          rect(x, y, w, h, "#e0e7e2", h / 2) +
          rect(x, y, w * ratio, h, "#739b82", h / 2);
      }
      if (node.type === "Switch")
        content =
          rect(
            x,
            y + (h - 30) / 2,
            w,
            30,
            c.checked ? "#739b82" : "#cbd5cf",
            15,
          ) +
          `<circle cx="${c.checked ? x + w - 16 : x + 16}" cy="${y + h / 2}" r="11" fill="white"/>`;
      if (node.type === "Select")
        content =
          rect(x, y, w, h, "#f5f8f5", 7, "#b8c8bf") +
          text(
            c.options.find((option) => option.id === c.selectedId)?.label ?? "",
            x + 14,
            y + h / 2,
          ) +
          `<path d="M${x + w - 28} ${y + h / 2 - 3}l6 6 6-6" fill="none" stroke="#617c6b" stroke-width="2"/>`;
      if (node.type === "Tabs")
        content = c.tabs
          .map((tab, tabIndex) => {
            const width = w / c.tabs.length,
              left = x + tabIndex * width,
              active = tab.id === c.activeId;
            return (
              rect(left, y, width, 48, active ? "#e1ebe5" : "#f4f6f4", 7) +
              text(tab.label, left + width / 2, y + 24, 19, "middle")
            );
          })
          .join("");
      const [cx, cy, cw, ch] = node.visibleBox;
      return `<clipPath id="clip-${index}">${rect(cx, cy, cw, ch, "white", 0)}</clipPath><g clip-path="url(#clip-${index})" data-node="${escapeXml(node.id)}">${content}</g>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.canvas.width}" height="${spec.canvas.height}" viewBox="0 0 ${spec.canvas.width} ${spec.canvas.height}" font-family="Microsoft YaHei, sans-serif"><title>${escapeXml(spec.title)}原型布局示意</title>${rect(0, 0, spec.canvas.width, spec.canvas.height, "#eff3ef", 0)}${body}</svg>`;
}

export async function templatePreview(id) {
  requireThat(
    templateList.some((item) => item.id === id) ||
      legacyIds.includes(id) ||
      sdkPanels.some((item) => `fixed-${item.spec.id}` === id) ||
      flowPanels.some((item) => `flow-${item.spec.id}` === id),
    "TEMPLATE_UNKNOWN",
  );
  if (!previews.has(id)) {
    previews.set(
      id,
      renderTemplate(id).catch((error) => {
        previews.delete(id);
        throw error;
      }),
    );
  }
  return previews.get(id);
}

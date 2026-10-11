// User-selected presentation changes to owned examples. Original SDK geometry
// remains available for comparison; these inputs still use the public producer.
export function settingsLayout(item) {
  const spec = structuredClone(item.spec);
  // Keep the original controls and action; a single content section avoids a
  // separate "Close" heading. The public producer owns the resulting geometry.
  spec.sections = [
    {
      ...spec.sections[0],
      rows: spec.sections.flatMap((section) => section.rows),
    },
  ];
  spec.layout.body.children = [spec.layout.body.children[0]];
  spec.actionLayouts = [];
  spec.buttonStyles = [
    {
      rowId: "close-settings",
      style: {
        backgroundColor: null,
        textColor: null,
        borderColor: null,
        borderWidth: null,
        cornerRadius: null,
        width: 112,
        height: 56,
        shape: "default",
      },
    },
  ];
  spec.theme = { id: "ui-reference-settings", version: "0.2.0" };
  spec.provenance.assumptions.push(
    "Close remains a 112x56 button below the language field, centered without a separate section title. The public producer measures and centers the compact panel.",
  );
  return {
    ...item,
    spec,
    description:
      "旧版设置控件，保留一个设置标题、三个开关和语言下拉；底部仅保留关闭按钮。",
  };
}

export function presentationLayout(item) {
  const id = item.spec.id;
  if (!["sdk-ready", "sdk-loading", "sdk-loading-failed"].includes(id))
    return item;
  const spec = structuredClone(item.spec);
  const { width, height } = spec.canvas;
  const root = spec.document.root;
  const pw = Math.min(520, width - 48);
  let description;
  if (id === "sdk-ready") {
    const ph = 300;
    const title = root.children.find((node) => node.id.endsWith(".title"));
    const start = root.children.find((node) => node.id.endsWith(".start"));
    title.layout = { x: 32, y: 64, width: pw - 64, height: 52 };
    const buttonWidth = Math.min(320, pw - 64);
    start.layout = {
      x: (pw - buttonWidth) / 2,
      y: 188,
      width: buttonWidth,
      height: 56,
    };
    root.children = [
      {
        id: `${id}.panel`,
        type: "Container",
        layout: {
          x: (width - pw) / 2,
          y: (height - ph) / 2,
          width: pw,
          height: ph,
        },
        props: {
          drawBackground: true,
          style: { ...root.props.style, cornerRadius: 16 },
        },
        children: [title, start],
      },
    ];
    description = "居中底板，标题与开始按钮居中排列，保留清晰间距。";
  } else {
    const failed = id === "sdk-loading-failed";
    const panelWidth = Math.min(600, width - 48);
    const panelHeight = failed ? 300 : 208;
    const progressY = (panelHeight - 28) / 2;
    const padding = Math.min(40, Math.max(16, (panelWidth - 240) / 2));
    const innerWidth = panelWidth - padding * 2;
    const content = root.children[0];
    const find = (suffix) =>
      content.children.find((node) => node.id.endsWith(suffix));
    const spinner = find(".spinner");
    spinner.layout = {
      x: (panelWidth - 42) / 2,
      y: (progressY - 42) / 2,
      width: 42,
      height: 42,
    };
    const progress = find(".progress");
    const percentage = find(".percentage");
    const status = find(failed ? ".error" : ".stage");
    progress.layout = { x: 0, y: 0, width: innerWidth, height: 28 };
    percentage.layout = {
      x: (innerWidth - 80) / 2,
      y: 4,
      width: 80,
      height: 20,
    };
    status.layout = { x: 0, y: 44, width: innerWidth, height: 24 };
    status.props.style.fontSize = 16;
    status.props.lineHeight = 24;
    const actions = failed ? [find(".retry"), find(".back")] : [];
    for (const [index, action] of actions.entries()) {
      action.layout.x = (innerWidth - 234) / 2 + index * 122;
      action.layout.y = 92;
    }
    content.layout = {
      x: padding,
      y: progressY,
      width: innerWidth,
      height: failed ? 136 : 68,
    };
    content.children = [progress, percentage, status, ...actions];
    root.children = [
      {
        id: `${id}.panel`,
        type: "Container",
        layout: {
          x: (width - panelWidth) / 2,
          y: (height - panelHeight) / 2,
          width: panelWidth,
          height: panelHeight,
        },
        props: {
          drawBackground: true,
          style: { ...root.props.style, cornerRadius: 16 },
        },
        children: [spinner, content],
      },
    ];
    description = failed
      ? "进度条居中，圆形占位在底板顶部和进度条之间居中；失败提示替换加载阶段，下方显示重试和返回。"
      : "紧凑底板以进度条为中心，上方圆形加载占位，下方单行加载阶段。";
  }
  spec.provenance.description =
    "User-selected presentation layout based on SDK controls, validated through the public panel producer. Original SDK skin geometry is retained separately; no SDK runtime screenshot or model call is included.";
  spec.provenance.assumptions = [
    "Illustrative copy and state only; no game runtime, bridge, assets, motion or font-pixel fidelity.",
    id === "sdk-ready"
      ? "A centered 520x300 card at the default viewport, with a centered title and Start button. Card and button widths shrink to fit narrower canvases."
      : "The progress bar is centered on the viewport and card in both states, with adaptive horizontal padding. At the default viewport, loading uses a compact 600x208 card and failure a 600x300 card for recovery buttons. A static circular spinner is centered between the card top and progress bar, with single-line status 16px below the bar. Progress and status positions stay consistent; failure replaces the stage text.",
  ];
  return { ...item, spec, description };
}

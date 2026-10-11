// Authored geometric transcription of default SDK skins; no SDK runtime code.
// FancyButton anchor:0.5 is resolved to top-left logical boxes.
const style = (fontSize = 18, extras = {}) => ({
  backgroundColor: "#E0E5E2",
  borderColor: "#92A298",
  borderWidth: 1,
  cornerRadius: 8,
  textColor: "#293D32",
  fontFamily: "Microsoft YaHei, sans-serif",
  fontSize,
  fontWeight: "normal",
  opacity: 1,
  ...extras,
});
const box = (x, y, width, height) => ({ x, y, width, height });
const container = (id, rect, children = [], visible = false, radius = 8) => ({
  id,
  type: "Container",
  layout: rect,
  props: {
    drawBackground: visible,
    style: style(18, { backgroundColor: "#FFFFFF", cornerRadius: radius }),
  },
  children,
});
const text = (id, value, rect, size = 18, bold = false) => ({
  id,
  type: "Text",
  layout: rect,
  props: {
    text: value,
    wrap: "none",
    overflow: "error",
    lineHeight: Math.ceil(size * 1.3),
    drawBackground: false,
    style: style(size, {
      fontWeight: bold ? "bold" : "normal",
      borderWidth: 0,
    }),
  },
});
const button = (id, label, cx, cy, w, h, size = 24) => ({
  id,
  type: "Button",
  layout: box(cx - w / 2, cy - h / 2, w, h),
  props: { label, enabled: true, style: style(size, { fontWeight: "bold" }) },
  children: [],
});
const fixture = (id, title, canvas, children, source, assumptions = []) => ({
  panelSpecVersion: "fixed-reference-1",
  id,
  title,
  canvas,
  document: {
    schemaVersion: "0.2",
    id,
    canvas,
    root: container(
      `${id}.canvas`,
      box(0, 0, canvas.width, canvas.height),
      children,
    ),
  },
  provenance: {
    kind: "programmatic-fixture",
    description: `Default SDK skin geometry at the declared viewport. Source: ${source}. Neutral colors are intentional; this is not an SDK runtime screenshot.`,
    assumptions: [
      "Only geometry and visible saved copy; no game runtime, bridge, assets, motion or font-pixel fidelity.",
      "Settings states, game title, locales, three result metrics and loading progress are explicit illustrative inputs.",
      ...assumptions,
    ],
  },
});

export function createSdkPanels(canvas = { width: 960, height: 800 }) {
  const { width, height } = canvas;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 320 ||
    height < 480 ||
    width > 4096 ||
    height > 4096
  )
    throw new Error("SDK_VIEWPORT_INVALID");
  const sw = Math.max(320, width),
    sh = Math.max(480, height);
  // Skeleton CSS: 32px vertical padding, 24px gap, 56px bottom Start; h1 aligns to the first grid row's end.
  const ready = fixture(
    "sdk-ready",
    "游戏标题",
    canvas,
    [
      text(
        "sdk-ready.title",
        "游戏标题",
        box(
          (width - Math.min(width - 48, 760)) / 2,
          height - 112 - 41.04,
          Math.min(width - 48, 760),
          50,
        ),
        38,
        true,
      ),
      button(
        "sdk-ready.start",
        "开始",
        width / 2,
        height - 60,
        Math.min(width - 48, 420),
        56,
        18,
      ),
    ],
    "preload/scripts/create-geminants-webview-skeleton.mjs: makeWebviewCss/.game-ready",
    [
      "Default safe-area insets are zero; start screen is full-canvas, without a card.",
    ],
  );

  const settingsWidth = Math.min(520, Math.max(320, sw - 48)),
    settingsHeight = Math.min(620, Math.max(430, sh - 80));
  const settingsChildren = [
    text("sdk-settings.title", "设置", box(28, 24, 180, 38), 28, true),
    button("sdk-settings.close", "关闭", settingsWidth - 120, 22, 92, 42, 18),
    ...[
      ["motion", "体感倾斜", "关", "使用滑动操作", 96],
      ["music", "音乐", "开", "音乐已开启", 174],
      ["sfx", "音效", "开", "音效已开启", 252],
    ].flatMap(([id, label, value, detail, y]) => [
      text(
        `sdk-settings.${id}.label`,
        label,
        box(28, y + 2, 180, 28),
        21,
        true,
      ),
      text(`sdk-settings.${id}.detail`, detail, box(28, y + 34, 210, 20), 14),
      button(
        `sdk-settings.${id}.toggle`,
        value,
        28 + settingsWidth - 188,
        y + 4,
        112,
        50,
        18,
      ),
    ]),
    text(
      "sdk-settings.language.label",
      "语言",
      box(28, 338, 130, 28),
      21,
      true,
    ),
    {
      id: "sdk-settings.language",
      type: "Select",
      layout: box(28 + settingsWidth - 244, 338, 180, 48),
      props: {
        selectedId: "zh-CN",
        options: [
          { id: "zh-CN", label: "简体中文" },
          { id: "en", label: "English" },
        ],
        enabled: true,
        style: style(16),
      },
    },
  ];
  const settings = fixture(
    "sdk-settings",
    "设置",
    canvas,
    [
      container(
        "sdk-settings.panel",
        box(
          (sw - settingsWidth) / 2,
          (sh - settingsHeight) / 2,
          settingsWidth,
          settingsHeight,
        ),
        settingsChildren,
        true,
      ),
    ],
    "settings/scripts/runtime-generators.mjs: default SettingsPanelSkin",
    [
      "Motion requested and available, saved disabled; music and sfx enabled. Three FancyButtons display state text, not thumb switches.",
    ],
  );

  const pause = (local) => {
    const id = `sdk-pause-${local ? "local" : "online"}`,
      pw = Math.min(520, sw - 48),
      ph = local ? 308 : 228;
    return fixture(
      id,
      "已暂停",
      canvas,
      [
        container(
          `${id}.panel`,
          box((sw - pw) / 2, (sh - ph) / 2, pw, ph),
          [
            text(
              `${id}.title`,
              "已暂停",
              box((pw - 240) / 2, 42, 240, 45),
              34,
              true,
            ),
            button(`${id}.resume`, "继续", pw / 2, 150, 248, 56),
            ...(local
              ? [button(`${id}.menu`, "菜单", pw / 2, 226, 248, 56)]
              : []),
          ],
          true,
        ),
      ],
      "ui/scripts/install.mjs: makePausePanelSkinTs",
    );
  };
  const result = (complete) => {
    const id = `sdk-result-${complete ? "complete" : "failed"}`,
      title = complete ? "通关" : "未通关",
      pw = Math.min(560, sw - 40),
      ph = 250 + 3 * 66;
    return fixture(
      id,
      title,
      canvas,
      [
        container(
          `${id}.panel`,
          box((sw - pw) / 2, Math.max(20, (sh - ph) / 2), pw, ph),
          [
            text(
              `${id}.title`,
              title,
              box((pw - 240) / 2, 30, 240, 50),
              38,
              true,
            ),
            ...[
              ["score", "得分", complete ? "12,800" : "6,400"],
              ["time", "用时", complete ? "92 秒" : "48 秒"],
              ["completion", "完成状态", title],
            ].map(([key, label, value], index) =>
              container(
                `${id}.metric.${key}`,
                box(32, 96 + index * 66, pw - 64, 54),
                [
                  text(
                    `${id}.${key}.label`,
                    label,
                    box(18, 14, 190, 28),
                    20,
                    key === "score",
                  ),
                  text(
                    `${id}.${key}.value`,
                    value,
                    box(pw - 64 - 18 - 180, 12, 180, 30),
                    22,
                    true,
                  ),
                ],
                true,
              ),
            ),
            button(`${id}.restart`, "再来一局", pw / 2, ph - 62, 272, 58),
          ],
          true,
          16,
        ),
      ],
      "ui/scripts/install.mjs: makeResultPanelSkinTs",
      [
        "Panel height = 250 + declared metric count * 66; this example declares exactly three metrics.",
      ],
    );
  };
  const loading = (failed) => {
    const id = `sdk-loading${failed ? "-failed" : ""}`,
      pw = Math.min(520, width - 48);
    // Default skeleton border-box and system-font line metrics; native DOM fonts can differ.
    const ph = failed ? 204.8 : 125.6;
    return fixture(
      id,
      "场景加载",
      canvas,
      [
        container(
          `${id}.content`,
          box((width - pw) / 2, (height - ph) / 2, pw, ph),
          [
            container(
              `${id}.spinner`,
              box((pw - 42) / 2, 0, 42, 42),
              [],
              true,
              21,
            ),
            {
              id: `${id}.progress`,
              type: "ProgressBar",
              layout: box(0, 66, pw, 28),
              props: {
                value: failed ? 40 : 60,
                max: 100,
                style: style(14, { cornerRadius: 14 }),
              },
            },
            text(
              `${id}.percentage`,
              failed ? "40%" : "60%",
              box((pw - 80) / 2, 70, 80, 20),
              14,
              true,
            ),
            text(
              `${id}.stage`,
              "正在准备图片",
              box((pw - 240) / 2, 106, 240, 20),
              14,
            ),
            ...(failed
              ? [
                  text(
                    `${id}.error`,
                    "场景资源加载失败",
                    box((pw - 280) / 2, 143.6, 280, 21),
                    16,
                  ),
                  button(
                    `${id}.retry`,
                    "重试",
                    pw / 2 - 61,
                    182.8,
                    112,
                    44,
                    15,
                  ),
                  button(`${id}.back`, "返回", pw / 2 + 61, 182.8, 112, 44, 15),
                ]
              : []),
          ],
        ),
      ],
      "scene-loader/scripts/runtime-generators.mjs: default SceneLoaderSkin",
      [
        "Full-screen loader has no panel card or heading. Spinner is a static outline placeholder. CSS text flow depends on environment font metrics.",
      ],
    );
  };
  return [
    [
      "ready",
      "开始页",
      "默认",
      "SDK 首屏布局：标题靠近底部，开始按钮位于底部。",
      ready,
    ],
    [
      "settings",
      "设置面板",
      "多语言",
      "SDK 默认位置：右上关闭、三项状态按钮和语言下拉。",
      settings,
    ],
    ["pause", "暂停面板", "在线", "520 × 228；仅显示继续。", pause(false)],
    [
      "pause",
      "暂停面板",
      "本地 / 离线",
      "520 × 308；显示继续和菜单。",
      pause(true),
    ],
    [
      "result",
      "结算面板",
      "完成",
      "560 × 448；声明三项示例指标。",
      result(true),
    ],
    ["result", "结算面板", "失败", "相同布局，保留未通关状态。", result(false)],
    [
      "loading",
      "场景加载",
      "加载中",
      "全屏加载：转圈占位、进度与阶段。",
      loading(false),
    ],
    [
      "loading",
      "场景加载",
      "加载失败",
      "失败时增加错误提示、重试和返回。",
      loading(true),
    ],
  ].map(([group, groupName, variant, description, spec]) => ({
    group,
    groupName,
    variant,
    description,
    spec,
  }));
}
export const sdkPanels = createSdkPanels();

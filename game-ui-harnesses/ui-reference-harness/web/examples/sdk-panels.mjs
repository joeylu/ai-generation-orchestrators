// Authored structural examples of the public game SDK contracts. These are
// ui-panel-harness inputs, not SDK implementations or working game controls.
const recipe = (id) => ({ id, version: "0.1.0" });
const button = (id, buttonLabel, role = "primary") => ({
  id,
  kind: "button",
  recipe: recipe(`settings.button.${role}`),
  label: "",
  buttonLabel,
  enabled: true,
  event: `example.${id}`,
  action: { kind: "emit" },
});
const info = (id, label, text) => ({
  id,
  kind: "text",
  recipe: recipe("settings.text"),
  label,
  text,
});
const section = (id, title, rows) => ({ id, title, rows });
const actions = (
  sectionId,
  { direction = "column", align = "center", buttonWidth = 320 } = {},
) => ({
  sectionId,
  direction,
  align,
  gap: 16,
  buttonWidth,
  buttonHeight: 56,
  shape: "default",
});
const fixture = (
  id,
  title,
  sections,
  state = [],
  actionLayouts = [],
  assumptions = [],
) => ({
  panelSpecVersion: "0.12",
  id,
  title,
  theme: { id: "modern-mint-light", version: "0.20.0" },
  canvas: { width: 960, height: 800 },
  layout: {
    width: 600,
    padding: 32,
    gap: 16,
    sectionGap: 20,
    labelWidth: 144,
    rowHeight: 56,
    titleHeight: 48,
    sectionTitleHeight: 32,
    maxHeight: 720,
    overflow: "error",
    body: {
      id: `${id}-body`,
      kind: "column",
      width: "fill",
      gap: 20,
      align: "start",
      children: sections.map(({ id: sectionId }) => ({
        kind: "section",
        sectionId,
        width: "fill",
      })),
    },
  },
  state,
  sections,
  tabs: null,
  assets: null,
  appearance: null,
  actionLayouts,
  buttonStyles: [],
  buttonFonts: [],
  titleBar: null,
  provenance: {
    kind: "programmatic-fixture",
    description:
      "SDK-aligned structural example. Public ui-panel compiler owns geometry; no artwork, provider call or SDK runtime is included.",
    assumptions: [
      "All values and copy are illustrative. Events only describe prototype actions; they do not call the game SDK.",
      ...assumptions,
    ],
  },
});

const ready = fixture(
  "sdk-ready",
  "游戏标题",
  [section("start", "游戏标题", [button("start-game", "开始")])],
  [],
  [actions("start")],
  [
    "A real game binds Start to the ready controls. No exit, shop or other game-owned feature is assumed.",
  ],
);

const settings = fixture(
  "sdk-settings",
  "设置",
  [
    section("preferences", "设置", [
      ...[
        ["motion", "体感倾斜"],
        ["music", "音乐"],
        ["sfx", "音效"],
      ].map(([id, label]) => ({
        id: `${id}-row`,
        kind: "switch",
        recipe: recipe("settings.switch"),
        label,
        bind: id,
        enabled: true,
        event: `example.${id}`,
      })),
      {
        id: "language-row",
        kind: "select",
        recipe: recipe("settings.select"),
        label: "语言",
        bind: "language",
        enabled: true,
        event: "example.language",
      },
    ]),
    section("close", "关闭", [button("close-settings", "关闭", "secondary")]),
  ],
  [
    { id: "motion", type: "boolean", initial: false },
    { id: "music", type: "boolean", initial: true },
    { id: "sfx", type: "boolean", initial: true },
    {
      id: "language",
      type: "enum",
      initial: "zh-CN",
      options: [
        { id: "zh-CN", label: "简体中文" },
        { id: "en", label: "English" },
      ],
    },
  ],
  [actions("close", { align: "end", buttonWidth: 112 })],
  [
    "Exactly three setting toggles and one language Select. Multi-language example; the real SDK may hide language for a single locale.",
    "Changes apply immediately through managed state. There are no volume sliders, quality settings, tabs, save or reset buttons.",
    "The public panel producer places Close below the fields; the SDK skin may position it in its header. This is a structural reference, not a pixel copy.",
  ],
);

const pause = (local) =>
  fixture(
    `sdk-pause-${local ? "local" : "online"}`,
    "已暂停",
    [
      section("pause", "已暂停", [
        button("resume-game", "继续"),
        ...(local ? [button("return-menu", "菜单", "secondary")] : []),
      ]),
    ],
    [],
    [actions("pause")],
    [
      local
        ? "Local/offline mode exposes Resume and Menu. Menu is local teardown."
        : "Online mode exposes Resume only. Menu must stay hidden.",
    ],
  );

const result = (complete) =>
  fixture(
    `sdk-result-${complete ? "complete" : "failed"}`,
    complete ? "通关" : "未通关",
    [
      section("metrics", complete ? "通关" : "未通关", [
        info("score", "得分", complete ? "12,800" : "6,400"),
        info("time", "用时", complete ? "92 秒" : "48 秒"),
        info("completion", "完成状态", complete ? "通关" : "未通关"),
      ]),
      section("restart", "再来一局", [button("restart-game", "再来一局")]),
    ],
    [],
    [actions("restart")],
    [
      "Three illustrative declared metrics in registry order; real games render only their declared metrics.",
      "Restart remains visible. The SDK controls availability while settlement or restart is pending.",
    ],
  );

const loading = (failed) =>
  fixture(
    `sdk-loading${failed ? "-failed" : ""}`,
    "场景加载",
    [
      section("progress", "场景加载", [
        {
          id: "loading-progress",
          kind: "progress",
          recipe: recipe("settings.progress"),
          label: "加载进度",
          bind: "progress",
          format: { mode: "percent", fractionDigits: 0 },
        },
        info("loading-stage", "加载阶段", "正在准备图片"),
        ...(failed ? [info("loading-error", "提示", "场景资源加载失败")] : []),
      ]),
      ...(failed
        ? [
            section("recovery", "操作", [
              button("retry-loading", "重试"),
              button("back-loading", "返回", "secondary"),
            ]),
          ]
        : []),
    ],
    [{ id: "progress", type: "progress", initial: failed ? 40 : 60, max: 100 }],
    failed ? [actions("recovery", { direction: "row", buttonWidth: 200 })] : [],
    [
      "Read-only SDK-owned progress. Loading has no buttons; failure exposes Retry and Back.",
      "The real scene loader uses its game-owned presentation skin. This prototype does not download resources or implement loading decisions.",
    ],
  );

export const sdkPanels = [
  {
    group: "ready",
    groupName: "开始页",
    variant: "默认",
    description: "游戏标题与开始游戏入口。",
    spec: ready,
  },
  {
    group: "settings",
    groupName: "设置面板",
    variant: "多语言",
    description: "三个设置开关、语言下拉与关闭；修改即时生效。",
    spec: settings,
  },
  {
    group: "pause",
    groupName: "暂停面板",
    variant: "在线",
    description: "在线模式仅显示继续游戏。",
    spec: pause(false),
  },
  {
    group: "pause",
    groupName: "暂停面板",
    variant: "本地 / 离线",
    description: "本地和离线模式额外显示返回菜单。",
    spec: pause(true),
  },
  {
    group: "result",
    groupName: "结算面板",
    variant: "完成",
    description: "示例成绩指标与重新开始；指标按游戏配置确定。",
    spec: result(true),
  },
  {
    group: "result",
    groupName: "结算面板",
    variant: "失败",
    description: "未完成状态，保留成绩指标与重新开始。",
    spec: result(false),
  },
  {
    group: "loading",
    groupName: "场景加载",
    variant: "加载中",
    description: "只读进度条与加载阶段，无操作按钮。",
    spec: loading(false),
  },
  {
    group: "loading",
    groupName: "场景加载",
    variant: "加载失败",
    description: "保留进度，显示失败提示、重试与返回。",
    spec: loading(true),
  },
];

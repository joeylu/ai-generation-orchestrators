export function styleDraftInput({ custom, preset, reference = null, notes }) {
  if (!custom) return { preset, notes, resolveNotes: Boolean(notes.trim()) };
  return {
    pack: {
      kind: "ui_reference_style_pack_v1",
      metadata: {
        id: "custom-reference",
        name: "自定义风格",
        version: "1.0.0",
      },
      render_style: {
        visual_identity:
          "以用户提供的风格参考图与风格描述为准，不混入默认风格。",
        line: "沿用风格参考图与描述的线条语言。",
        shape_language: "沿用参考图与描述的造型语言，保持原型控件结构。",
        color: "沿用参考图与描述的配色，不预设其他流派或固定配色。",
        material: "沿用参考图与描述的材质表现。",
        lighting: "沿用参考图与描述的光影表现。",
        texture: "沿用参考图与描述的纹理。",
        render_finish: "沿用参考图与描述的完成效果，保持游戏 UI 清晰可读。",
      },
      ui_rules: {
        frame: "借鉴参考图与描述的边框语言，保留原型布局。",
        controls:
          "控件数量、类型、位置与状态以面板原型为准，外观遵循参考图与描述。",
        icons: "图标视觉语言遵循参考图与描述，不新增原型中没有的内容。",
        typography: "文字风格遵循参考图与描述，保留原型文案并保证可读性。",
        decoration: "装饰遵循参考图与描述，不遮挡控件或文案。",
        background: "背景遵循参考图与描述，保持完整不透明画布。",
      },
      palette: null,
      negative_rules: [
        "不得改变原型布局、控件数量、状态或原始文案。",
        "不得复制风格参考图的布局、文案或额外内容。",
      ],
    },
    ...(reference ? { reference } : {}),
    notes,
    resolveNotes: Boolean(notes.trim()),
  };
}

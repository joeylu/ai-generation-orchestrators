import matrix from "../../fixtures/component-matrix.json" with { type: "json" };
export { matrix };
export function longProps(type) {
  const long = matrix.longLabel,
    options = [
      { id: "a", label: long, enabled: true },
      { id: "b", label: long + "乙", enabled: true },
    ];
  if (["Button", "Switch", "CheckBox"].includes(type)) return { label: long };
  if (type === "RadioGroup") return { options, selectedId: "a" };
  if (type === "Select") return { options, selectedId: "b", placeholder: long };
  if (type === "Input") return { value: long, maxLength: 128 };
  if (type === "List") return { items: options };
  if (type === "Dialog")
    return {
      title: long,
      actions: options.map((o) => ({
        id: o.id,
        label: o.label,
        variant: "primary",
        closeOnActivate: false,
      })),
    };
  if (type === "Tabs")
    return {
      tabs: options.map((o) => ({ ...o, contentNodeId: "page-" + o.id })),
      activeId: "a",
    };
  if (type === "Text")
    return { text: long.repeat(5), overflow: "ellipsis", wrap: "word" };
  if (type === "Panel") return { title: long };
  return {};
}

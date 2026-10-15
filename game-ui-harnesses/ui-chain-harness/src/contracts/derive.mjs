import { propsSchema, recipeRef } from "./validate.mjs";

const cell = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "&#124;")
    .replaceAll("\n", " ")
    .replaceAll("`", "&#96;")
    .replaceAll("[", "&#91;")
    .replaceAll("]", "&#93;");
const json = (value) => JSON.stringify(value, null, 2) + "\n";
export function deriveContracts(
  { registry, usage, template, blockers },
  sources,
  dependencies,
) {
  const recipes = registry.recipes.map((recipe) => {
    const schema = propsSchema(registry, recipe);
    return {
      ...recipe,
      propsSchema: schema,
      defaults: Object.fromEntries(
        Object.entries(schema.properties)
          .filter(([, v]) => Object.hasOwn(v, "default"))
          .map(([k, v]) => [k, v.default]),
      ),
      implementation: "not-evaluated",
      acceptance: "not-run",
    };
  });
  const types = [...new Set(recipes.map((r) => r.type))];
  const catalog = {
    kind: "ui_component_contract_catalog",
    version: "0.1",
    scope:
      "Design contracts only; implementation and fixture evidence are evaluated by the separate components runner, not this catalog.",
    sources,
    componentTypeCount: types.length,
    recipeCount: recipes.length,
    types,
    runtimeAvailableTypes: [],
    runtimeEvidence: "separate-fixture-report",
    productionReady: false,
    blockers,
    recipes,
  };
  const plan = {
    kind: "ui_component_acceptance_plan",
    version: "0.1",
    scope:
      "Specifications only; this builder does not import execution evidence. See the separate fixture report for assertion subsets.",
    sources,
    cases: registry.acceptanceCases,
    matrix: recipes.flatMap((r) =>
      r.acceptanceCaseIds.map((caseId) => ({
        recipeRef: recipeRef(r),
        componentType: r.type,
        caseId,
        status: "not-run",
        evidence: [],
      })),
    ),
  };
  const projection = {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "Draft properties only; not a runnable AI component whitelist",
    definitions: Object.fromEntries(
      recipes.map((r) => [recipeRef(r), r.propsSchema]),
    ),
  };
  const lines = [
    "# 组件合同目录（自动生成）",
    "",
    "编辑 configs/component-registry.draft.json 与 configs/skin-usage.draft.json 后重建。本页、Schema 投影与验收清单均为派生产物，不手工维护。",
    "",
    `${types.length} 类，${recipes.length} 个配方。本目录不评估适配器实现或导入测试结果；实际离线断言见 components:status 指向的独立报告。正式皮肤包：无。`,
    "",
    "[属性 Schema 投影](props-schema.json) · [验收清单](acceptance-plan.md) · [依赖声明核对](dependency-evidence.json) · [构建记录](build-record.json)",
    "",
    "| 类型 | 配方引用 | 计划库入口 | 计划适配器 | 状态 |",
    "| --- | --- | --- | --- | --- |",
    ...recipes.map(
      (r) =>
        `| ${[r.type, recipeRef(r), r.library.package + ":" + r.library.exportName, r.adapterId, "未由本目录评估"].map(cell).join(" | ")} |`,
    ),
    "",
  ];
  for (const r of recipes) {
    lines.push(
      `## ${cell(recipeRef(r))}`,
      "",
      "| 属性 | 类型 / 枚举 | 默认值 | 必填 |",
      "| --- | --- | --- | --- |",
      ...Object.entries(r.propsSchema.properties).map(
        ([k, v]) =>
          `| ${[k, v.enum?.join(" / ") ?? JSON.stringify(v.type), Object.hasOwn(v, "default") ? JSON.stringify(v.default) : "无", r.propsSchema.required?.includes(k) ? "是" : "否"].map(cell).join(" | ")} |`,
      ),
      "",
      `事件：${r.events.map(cell).join("、") || "无业务事件"}。状态：${r.states.map(cell).join("、")}。`,
      "",
      `使用元数据要求：${cell(r.metadataRequirements)}`,
      "",
      `内容槽：${r.slots.map((s) => `${cell(s.name)} (${s.min}..${s.max ?? "∞"})`).join("、") || "无"}。组合配方：${r.composedRecipes.map(cell).join("、") || "无"}。`,
      "",
      "| 皮肤角色 | 候选资产 | 必需 / 条件 |",
      "| --- | --- | --- |",
      ...r.skinRoles.map(
        (b) =>
          `| ${[b.role, usage.bindings.find((x) => x.role === b.role).assetId, (b.required ? "必需" : "可选") + (b.when ? " / " + JSON.stringify(b.when) : "")].map(cell).join(" | ")} |`,
      ),
      "",
    );
  }
  lines.push(
    "## 尚未满足的交付条件",
    "",
    "这些是显式待定项；草案合法不代表真实皮肤或组件运行时可用。",
    "",
    ...blockers.map((b) => `- ${cell(b.path)}：${cell(b.message)}`),
    "",
  );
  const acceptance = [
    "# 组件验收计划（自动生成）",
    "",
    "本计划不导入执行结果，not-run 仅表示此投影没有绑定完整用例证据。components 报告单独记录已运行的断言子集；不能由子集通过推断完整用例通过。P1/P2/P4/P5 分别取证。",
    "",
    "| 用例 | 阶段 | 操作 | 通过条件 |",
    "| --- | --- | --- | --- |",
    ...plan.cases.map(
      (c) =>
        `| ${[c.id + " " + c.title, c.phase, c.procedure, c.expected].map(cell).join(" | ")} |`,
    ),
    "",
    "| 配方 | 用例集合 | 状态 |",
    "| --- | --- | --- |",
    ...recipes.map(
      (r) =>
        `| ${cell(recipeRef(r))} | ${r.acceptanceCaseIds.map(cell).join(", ")} | 未绑定完整用例证据 |`,
    ),
    "",
  ];
  return {
    "registry.source.json": json(registry),
    "usage.source.json": json(usage),
    "template.source.json": json(template),
    "catalog.json": json(catalog),
    "props-schema.json": json(projection),
    "acceptance-plan.json": json(plan),
    "catalog.md": lines.join("\n"),
    "acceptance-plan.md": acceptance.join("\n"),
    "dependency-evidence.json": json(dependencies),
  };
}

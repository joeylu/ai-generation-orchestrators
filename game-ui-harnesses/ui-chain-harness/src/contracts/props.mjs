import {boundedValidators} from './bounded-validators.mjs';
import {assertInventoryProps} from '../runtime/inventory-policy.mjs';
const defaultsAjv = boundedValidators({
  allErrors: true,
  strict: true,
  strictRequired: true,
  useDefaults: true,
});
const pointer = (s) => s.replaceAll("~", "~0").replaceAll("/", "~1");
export const issuesOf = (errors, prefix) =>
  (errors ?? []).map((e) => ({
    path:
      prefix +
      e.instancePath +
      (e.keyword === "required"
        ? `/${pointer(e.params.missingProperty)}`
        : e.keyword === "additionalProperties"
          ? `/${pointer(e.params.additionalProperty)}`
          : ""),
    code: `schema.${e.keyword}`,
    message: e.message,
  }));
export const recipeRef = (recipe) =>
  `${recipe.recipeId}@${recipe.recipeVersion}`;
export const propsSchema = (registry, recipe) => ({
  ...recipe.propsSchema,
  properties: { ...registry.commonProps, ...recipe.propsSchema.properties },
});
export const arities = {
  selection: 2,
  "selection-required": 2,
  "no-selection": 2,
  "unique-ids": 1,
  "unique-content": 1,
  range: 3,
  quantized: 4,
  "utf16-length": 2,
  "recipe-ref": 1,
  "resource-ref": 1,
  "text-style-ref": 1,
};

export function semanticProps(registry, recipe, props, context = {}) {
  const issues = [],
    unresolved = [];
  const error = (field, code, message) =>
    issues.push({ path: `/${field}`, code, message });
  for (const { kind, fields } of recipe.rules) {
    if (fields.some((f) => !Object.hasOwn(props, f))) continue;
    const [a, b, c, d] = fields.map((f) => props[f]);
    if (
      [
        "selection",
        "selection-required",
        "unique-ids",
        "unique-content",
      ].includes(kind)
    ) {
      const ids = new Set();
      a.forEach((item, i) => {
        const key = kind === "unique-content" ? "contentNodeId" : "id";
        if (ids.has(item[key]))
          error(
            `${fields[0]}/${i}/${key}`,
            "identity.duplicate",
            "集合内 ID 必须唯一。",
          );
        ids.add(item[key]);
        if (kind === "unique-content") {
          if (!context.nodeIds)
            unresolved.push({
              field: `${fields[0]}/${i}/${key}`,
              kind: "node",
              ref: item[key],
            });
          else if (!context.nodeIds.includes(item[key]))
            error(
              `${fields[0]}/${i}/${key}`,
              "reference.node",
              "页面节点不存在。",
            );
        }
      });
      if (kind.startsWith("selection")) {
        if (b !== null && !ids.has(b))
          error(fields[1], "selection.missing", "选择 ID 必须存在于当前集合。");
        if (kind === "selection-required" && a.length && b === null)
          error(fields[1], "selection.required", "非空页签必须声明活动 ID。");
      }
    }
    if (kind === "no-selection" && a === "none" && b !== null)
      error(fields[1], "selection.none", "不选择模式要求 selectedId 为 null。");
    if (kind === "range") {
      if (b <= a) error(fields[1], "number.range", "max 必须大于 min。");
      if (c < a || c > b)
        error(fields[2], "number.bounds", "值必须处于 min/max 范围内。");
    }
    if (kind === "quantized" && b > a && d > 0 && c >= a && c <= b) {
      // max is a legal explicit endpoint even when the span is not divisible by step.
      const q = (c - a) / d;
      if (
        c !== b &&
        (!Number.isFinite(q) ||
          Math.abs(q - Math.round(q)) > registry.quantization.relativeTolerance)
      )
        error(
          fields[2],
          "number.step",
          "值须落在 min + n*step 上，或精确等于 max。",
        );
    }
    if (kind === "utf16-length" && b !== null && a.length > b)
      error(fields[0], "text.length", "初始值超过 UTF-16 长度上限。");
    if (
      kind === "recipe-ref" &&
      !registry.recipes.some((r) => recipeRef(r) === a)
    )
      error(fields[0], "reference.recipe", "配方引用不存在或版本不匹配。");
    if (kind === "resource-ref" || kind === "text-style-ref") {
      const key = kind === "resource-ref" ? "resourceIds" : "textStyleIds";
      if (!context[key]) unresolved.push({ field: fields[0], kind, ref: a });
      else if (!context[key].includes(a))
        error(fields[0], kind, "引用未在当前上下文声明。");
    }
  }
  if (props.gapToken !== undefined) {
    if (!context.layoutTokens)
      unresolved.push({
        field: "gapToken",
        kind: "layout-token",
        ref: props.gapToken,
      });
    else if (!Object.hasOwn(context.layoutTokens, props.gapToken))
      error("gapToken", "reference.token", "间距 token 不存在。");
  }
  if(recipe.type==='List')try{assertInventoryProps(props,{childIds:context.nodeIds??[],itemRecipeType:registry.recipes.find(candidate=>recipeRef(candidate)===props.itemRecipeRef)?.type});}catch(e){error('inventory',e.code,e.message);}
  return { issues, unresolved };
}

// Validates component properties, not a PanelDocument tree or an executable component.
export function validateProps(registry, ref, input, context) {
  const recipe = registry.recipes.find((r) => recipeRef(r) === ref);
  if (!recipe)
    return {
      issues: [
        {
          path: "/recipeRef",
          code: "reference.recipe",
          message: "配方或版本不存在。",
        },
      ],
      unresolved: [],
    };
  const props = structuredClone(input);
  const check = defaultsAjv.compile(propsSchema(registry, recipe));
  if (!check(props))
    return { props, issues: issuesOf(check.errors, ""), unresolved: [] };
  return { props, ...semanticProps(registry, recipe, props, context) };
}

import { readFile } from "node:fs/promises";
import Ajv from "ajv";
import {boundedValidators} from './bounded-validators.mjs';
import {
  root,
  validateTemplate,
  TemplateError,
} from "../templates/contract.mjs";

const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: true });
const dynamicAjv=boundedValidators({allErrors:true,strict:true,strictRequired:true});
const defaultsAjv = boundedValidators({
  allErrors: true,
  strict: true,
  strictRequired: true,
  useDefaults: true,
});
const schemas = await Promise.all(
  ["component-registry", "skin-usage"].map(async (name) =>
    ajv.compile(
      JSON.parse(
        await readFile(new URL(`schemas/${name}.schema.json`, root), "utf8"),
      ),
    ),
  ),
);
import {
  recipeRef,
  propsSchema,
  validateProps,
  issuesOf,
  arities,
  semanticProps,
} from "./props.mjs";
export { recipeRef, propsSchema, validateProps } from "./props.mjs";

export function validateContracts({ registry, usage, template }) {
  const issues = validateTemplate(template).map((i) => ({
    ...i,
    path: "/template" + i.path,
  }));
  for (const [i, value] of [registry, usage].entries())
    if (!schemas[i](value))
      issues.push(
        ...issuesOf(schemas[i].errors, i === 0 ? "/registry" : "/usage"),
      );
  if (issues.length) return { issues, blockers: [] };
  const error = (path, code, message) => issues.push({ path, code, message });
  const blockers = [];
  const pending = (path, code, message) =>
    blockers.push({ path, code, message });
  const unique = (array, key, path) => {
    const seen = new Set();
    array.forEach((v, i) => {
      const value = key(v);
      if (seen.has(value))
        error(`${path}/${i}`, "identity.duplicate", `重复标识 ${value}。`);
      seen.add(value);
    });
    return seen;
  };
  const refs = unique(registry.recipes, recipeRef, "/registry/recipes");
  const cases = unique(
    registry.acceptanceCases,
    (c) => c.id,
    "/registry/acceptanceCases",
  );
  const roles = unique(usage.bindings, (b) => b.role, "/usage/bindings");
  const assets = new Map(
    template.sheets.flatMap((s) => s.parts.map((p) => [p.assetId, p])),
  );
  const types = new Set(registry.recipes.map((r) => r.type));
  for (const type of template.consumerTypes)
    if (!types.has(type))
      error(
        "/registry/recipes",
        "coverage.type",
        `模板使用方 ${type} 缺组件声明。`,
      );
  for (const type of types)
    if (!template.consumerTypes.includes(type))
      error(
        "/registry/recipes",
        "coverage.consumer",
        `组件 ${type} 未在模板使用方声明。`,
      );
  if (
    usage.templateRef.version !== template.version ||
    usage.templateRef.revision !== template.revision
  )
    error(
      "/usage/templateRef",
      "reference.template",
      "皮肤使用配置需显式匹配模板合同与修订；内容摘要由构建自动绑定。",
    );
  const referencedCases = new Set();
  for (const c of registry.acceptanceCases)
    if (
      c.scope === "common"
        ? c.componentType !== null
        : !types.has(c.componentType)
    )
      error(
        "/registry/acceptanceCases",
        "case.type",
        "公共用例不绑定类型，组件用例必须绑定已声明类型。",
      );
  registry.recipes.forEach((recipe, i) => {
    const p = `/registry/recipes/${i}`;
    if (
      recipe.propsSchema.type !== "object" ||
      recipe.propsSchema.additionalProperties !== false
    )
      error(
        `${p}/propsSchema`,
        "props.object",
        "顶层属性必须是关闭未知字段的 object。",
      );
    const properties = propsSchema(registry, recipe).properties;
    for (const k of Object.keys(recipe.propsSchema.properties ?? {}))
      if (Object.hasOwn(registry.commonProps, k))
        error(
          `${p}/propsSchema/properties/${k}`,
          "props.override",
          "不得覆盖公共属性。",
        );
    try {
      dynamicAjv.compile(propsSchema(registry, recipe));
      const visit = (schema, path) => {
        if (Object.hasOwn(schema, "default")) {
          const check = dynamicAjv.compile(schema);
          if (!check(schema.default))
            error(
              path + "/default",
              "props.default",
              "默认值不符合其属性合同。",
            );
        }
        for (const [key, sub] of Object.entries(schema.properties ?? {}))
          visit(sub, `${path}/properties/${key}`);
        if (schema.items) visit(schema.items, `${path}/items`);
        if (
          (schema.type === "object" ||
            (Array.isArray(schema.type) && schema.type.includes("object"))) &&
          schema.additionalProperties !== false
        )
          error(path, "props.open", "对象必须显式禁止未知字段。");
        if (schema.type === "array" && !schema.items)
          error(path, "props.items", "数组必须声明 items。");
      };
      visit(propsSchema(registry, recipe), p + "/propsSchema");
    } catch {
      error(
        `${p}/propsSchema`,
        "props.schema",
        "属性 Schema 无效或使用了不支持的关键词。",
      );
    }
    recipe.rules.forEach((rule, j) => {
      if (
        rule.fields.length !== arities[rule.kind] ||
        rule.fields.some(
          (f) =>
            !properties[f] ||
            (!Object.hasOwn(properties[f], "default") &&
              !recipe.propsSchema.required?.includes(f)),
        )
      )
        error(
          `${p}/rules/${j}`,
          "rule.fields",
          "规则字段数量不符或引用了未声明属性。",
        );
      const expected = {
        selection: ["array", ["string", "null"]],
        "selection-required": ["array", ["string", "null"]],
        "unique-ids": ["array"],
        "unique-content": ["array"],
        range: ["number", "number", "number"],
        quantized: ["number", "number", "number", "number"],
        "utf16-length": ["string", ["integer", "null"]],
        "no-selection": ["string", ["string", "null"]],
        "recipe-ref": ["string"],
        "resource-ref": ["string"],
        "text-style-ref": ["string"],
      }[rule.kind];
      if (
        rule.fields.some(
          (f, k) =>
            JSON.stringify(properties[f]?.type) !== JSON.stringify(expected[k]),
        )
      )
        error(`${p}/rules/${j}`, "rule.types", "规则与属性类型不匹配。");
      if (
        [
          "selection",
          "selection-required",
          "unique-ids",
          "unique-content",
        ].includes(rule.kind)
      ) {
        const item = properties[rule.fields[0]]?.items,
          key = rule.kind === "unique-content" ? "contentNodeId" : "id";
        if (
          item?.type !== "object" ||
          item.properties?.[key]?.type !== "string" ||
          !item.required?.includes(key)
        )
          error(
            `${p}/rules/${j}`,
            "rule.items",
            "集合规则要求每项显式包含稳定字符串 ID。",
          );
      }
    });
    unique(recipe.skinRoles, (r) => r.role, p + "/skinRoles");
    unique(recipe.slots, (s) => s.name, p + "/slots");
    recipe.skinRoles.forEach((binding, j) => {
      if (!roles.has(binding.role))
        error(
          `${p}/skinRoles/${j}`,
          "reference.role",
          "皮肤使用配置缺少角色映射。",
        );
      const asset = assets.get(
        usage.bindings.find((b) => b.role === binding.role)?.assetId,
      );
      if (asset && !asset.consumers.includes(recipe.type))
        error(
          `${p}/skinRoles/${j}`,
          "reference.consumer",
          "部件候选未声明当前组件为使用方。",
        );
      if (binding.when) {
        const w = binding.when,
          values = properties[w.prop]?.enum;
        if (
          Object.hasOwn(w, "equals") === Object.hasOwn(w, "notEquals") ||
          !values?.includes(w.equals ?? w.notEquals)
        )
          error(
            `${p}/skinRoles/${j}/when`,
            "role.condition",
            "条件必须引用已声明枚举，且只设 equals 或 notEquals。",
          );
      }
    });
    for (const ref of recipe.textStyles)
      if (!Object.hasOwn(usage.textStyles, ref))
        error(p + "/textStyles", "reference.style", `缺少文字样式 ${ref}。`);
    for (const ref of recipe.geometryRefs)
      if (!Object.hasOwn(usage.controlGeometry, ref))
        error(
          p + "/geometryRefs",
          "reference.geometry",
          `缺少几何声明 ${ref}。`,
        );
    for (const slot of recipe.slots)
      if (slot.max !== null && slot.min > slot.max)
        error(p + "/slots", "slot.range", "槽位 min 不能大于 max。");
    for (const ref of recipe.composedRecipes)
      if (!refs.has(ref))
        error(
          p + "/composedRecipes",
          "reference.recipe",
          `组合配方 ${ref} 不存在。`,
        );
    for (const ref of recipe.acceptanceCaseIds) {
      referencedCases.add(ref);
      if (!cases.has(ref))
        error(
          p + "/acceptanceCaseIds",
          "reference.case",
          `用例 ${ref} 不存在。`,
        );
    }
    for (const c of registry.acceptanceCases.filter(
      (c) => recipe.acceptanceCaseIds.includes(c.id) && c.scope === "component",
    ))
      if (c.componentType !== recipe.type)
        error(
          p + "/acceptanceCaseIds",
          "coverage.specific-type",
          "不能用其他类型的专属用例替代本组件验收。",
        );
    for (const c of registry.acceptanceCases.filter(
      (c) => c.scope === "common",
    ))
      if (!recipe.acceptanceCaseIds.includes(c.id))
        error(
          p + "/acceptanceCaseIds",
          "coverage.common",
          `缺少公共用例 ${c.id}。`,
        );
    if (
      !recipe.acceptanceCaseIds.some((ref) =>
        registry.acceptanceCases.some(
          (c) => c.id === ref && c.scope === "component",
        ),
      )
    )
      error(
        p + "/acceptanceCaseIds",
        "coverage.specific",
        "每个配方必须有独立组件用例。",
      );
  });
  for (const c of registry.acceptanceCases)
    if (!referencedCases.has(c.id))
      error(
        "/registry/acceptanceCases",
        "coverage.orphan",
        `用例 ${c.id} 未被引用。`,
      );
  const visited = new Set(),
    visiting = new Set();
  const visitRecipe = (ref) => {
    if (visiting.has(ref)) {
      error("/registry/recipes", "reference.cycle", `组合配方出现环：${ref}。`);
      return;
    }
    if (visited.has(ref)) return;
    visiting.add(ref);
    for (const child of registry.recipes.find((r) => recipeRef(r) === ref)
      ?.composedRecipes ?? [])
      visitRecipe(child);
    visiting.delete(ref);
    visited.add(ref);
  };
  for (const ref of refs) visitRecipe(ref);
  usage.bindings.forEach((binding, i) => {
    const p = `/usage/bindings/${i}`,
      asset = assets.get(binding.assetId);
    if (!asset) {
      error(p + "/assetId", "reference.asset", "资产 ID 不在模板中。");
      return;
    }
    const [, , w, h] = asset.bodyRect;
    for (const field of ["nineSlice", "contentInsets"]) {
      const v = binding[field];
      if (v && (v.left + v.right >= w || v.top + v.bottom >= h))
        error(
          p + "/" + field,
          "geometry.insets",
          "边距之和须小于资产主体尺寸。",
        );
      if (
        v &&
        binding.minSize &&
        (v.left + v.right >= binding.minSize.width ||
          v.top + v.bottom >= binding.minSize.height)
      )
        error(p + "/" + field, "geometry.minimum", "边距不可耗尽最小尺寸。");
    }
    for (const field of [
      "contentInsets",
      "minSize",
      ...(asset.stretch !== "uniform" ? ["nineSlice"] : []),
    ])
      if (binding[field] === null)
        pending(p + "/" + field, "skin.metadata", "使用元数据待真实资产确定。");
    if (binding.policy === "undecided")
      pending(p + "/policy", "skin.policy", "结构标记生产方式待定。");
  });
  for (const [name, v] of Object.entries(usage.controlGeometry)) {
    if (v === null) {
      pending(
        "/usage/controlGeometry/" + name,
        "skin.geometry",
        "控制几何待 fixture/真实资产定义。",
      );
      continue;
    }
    const asset = assets.get(v.assetId),
      limit = asset?.bodyRect[v.axis === "x" ? 2 : 3],
      cross = asset?.bodyRect[v.axis === "x" ? 3 : 2];
    if (!asset || v.start >= v.end || v.end > limit || v.crossOffset > cross)
      error(
        "/usage/controlGeometry/" + name,
        "geometry.travel",
        "几何引用或行程超出资产主体。",
      );
  }
  for (const field of ["textStyles", "stateStyles"])
    for (const [key, value] of Object.entries(usage[field]))
      if (value === null)
        pending(`/usage/${field}/${key}`, "skin.pending", "样式尚未确定。");
  // Do not fabricate a deliverable merely because all editable metadata is filled in.
  pending(
    "/usage/sourceKind",
    "skin.no-accepted-pack",
    "仅模板候选；没有真实资产 manifest、字体资源及人工接受证据。",
  );
  pending(
    "/registry/recipes",
    "runtime.production-unverified",
    "声明不提供生产运行时证据；程序夹具子集通过不能替代完整组件和真实皮肤验收。",
  );
  if (!issues.length)
    for (const [i, recipe] of registry.recipes.entries()) {
      const check = defaultsAjv.compile(propsSchema(registry, recipe)),
        values = {};
      check(values);
      const result = semanticProps(registry, recipe, values, {
        layoutTokens: usage.layoutTokens,
        textStyleIds: Object.keys(usage.textStyles),
      });
      issues.push(
        ...result.issues.map((e) => ({
          ...e,
          path: `/registry/recipes/${i}/defaults${e.path}`,
        })),
      );
    }
  return { issues, blockers };
}

export async function readContracts(paths) {
  const inputs = {},
    bytes = {};
  for (const key of ["registry", "usage", "template"]) {
    try {
      bytes[key] = await readFile(paths[key]);
      inputs[key] = JSON.parse(bytes[key]);
    } catch {
      throw new TemplateError([
        {
          path: `/${key}`,
          code: "source.read",
          message: "源文件无法读取或不是合法 JSON。",
        },
      ]);
    }
  }
  const result = validateContracts(inputs);
  if (result.issues.length) throw new TemplateError(result.issues);
  return { ...inputs, bytes, ...result };
}

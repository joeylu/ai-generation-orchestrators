import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  validateContracts,
  validateProps,
  readContracts,
  recipeRef,
} from "../src/contracts/validate.mjs";
import {
  defaults,
  buildContracts,
  contractStatus,
} from "../src/contracts/build.mjs";
import { deriveContracts } from "../src/contracts/derive.mjs";
import { dependencyEvidence } from "../src/contracts/dependencies.mjs";
import { workspace, save } from "./helpers.mjs";

const original = await readContracts(defaults);
const clone = () =>
  structuredClone({
    registry: original.registry,
    usage: original.usage,
    template: original.template,
  });
const check = (mutate) => {
  const b = clone();
  mutate(b);
  return validateContracts(b);
};
const has = (result, code) =>
  assert.ok(
    result.issues.some((i) => i.code === code),
    JSON.stringify(result.issues),
  );
const props = (ref, input, context) =>
  validateProps(original.registry, ref + "@1.0.0", input, context);
test('dedicated square slot roles are additive and frozen revision 2 contracts remain valid', () => {
  const current = clone();
  assert.equal(current.template.revision,3);
  assert.equal(current.usage.revision,2);
  assert.deepEqual(current.usage.templateRef,{version:'0.2',revision:3});
  assert.deepEqual(current.usage.bindings.filter(b => b.role.startsWith('skin.slot.')).map(b => [b.role,b.assetId]),[
    ['skin.slot.normal','slot.normal'],['skin.slot.selected','slot.selected'],
  ]);
  assert.deepEqual(validateContracts(current).issues,[]);
  const legacy = structuredClone(current);
  legacy.template.revision=2;
  legacy.template.stateGroups=legacy.template.stateGroups.filter(g => g.id !== 'slot');
  for(const sheet of legacy.template.sheets)sheet.parts=sheet.parts.filter(p => !p.assetId.startsWith('slot.'));
  legacy.usage.revision=1;
  legacy.usage.templateRef.revision=2;
  legacy.usage.bindings=legacy.usage.bindings.filter(b => !b.role.startsWith('skin.slot.'));
  assert.deepEqual(validateContracts(legacy).issues,[]);
});
test("全部 16 类独立声明，23 份用例规格；128 项计划不擅自引入运行时结果", () => {
  const b = clone(),
    result = validateContracts(b);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(
    b.registry.recipes.map((r) => r.type),
    [
      "Button",
      "Switch",
      "CheckBox",
      "RadioGroup",
      "Input",
      "Select",
      "Slider",
      "ProgressBar",
      "ScrollView",
      "List",
      "Dialog",
      "Tabs",
      "Image",
      "Text",
      "Container",
      "Panel",
    ],
  );
  const outputs = deriveContracts({ ...b, ...result }, {}, { packages: [] }),
    catalog = JSON.parse(outputs["catalog.json"]),
    plan = JSON.parse(outputs["acceptance-plan.json"]);
  assert.equal(catalog.componentTypeCount, 16);
  assert.equal(plan.cases.length, 23);
  assert.equal(plan.matrix.length, 128);
  assert.ok(
    plan.matrix.every((c) => c.status === "not-run" && c.evidence.length === 0),
  );
  assert.deepEqual(catalog.runtimeAvailableTypes, []);
  assert.equal(catalog.runtimeEvidence, "separate-fixture-report");
  assert.ok(catalog.recipes.every((r) => r.implementation === "not-evaluated"));
  assert.equal(catalog.productionReady, false);
});
test("仅添加注册配方即可扩展已有 Button 变体的派生产物", () => {
  const b = clone(),
    variant = structuredClone(b.registry.recipes[0]);
  variant.recipeId = "button-secondary";
  variant.propsSchema.properties.variant.default = "secondary";
  b.registry.recipes.push(variant);
  const result = validateContracts(b);
  assert.deepEqual(result.issues, []);
  const out = deriveContracts({ ...b, ...result }, {}, {}),
    catalog = JSON.parse(out["catalog.json"]);
  assert.equal(catalog.recipeCount, 17);
  assert.equal(catalog.componentTypeCount, 16);
  assert.equal(catalog.recipes.at(-1).defaults.variant, "secondary");
  assert.ok(out["catalog.md"].includes("button-secondary@1.0.0"));
});
for (const [name, mutate, code] of [
  [
    "重复配方",
    (b) => b.registry.recipes.push(b.registry.recipes[0]),
    "identity.duplicate",
  ],
  ["遗漏类型", (b) => b.registry.recipes.pop(), "coverage.type"],
  [
    "未知字段",
    (b) => (b.registry.recipes[0].verified = true),
    "schema.additionalProperties",
  ],
  [
    "默认值类型",
    (b) => (b.registry.recipes[0].propsSchema.properties.label.default = 3),
    "props.default",
  ],
  [
    "语义默认值",
    (b) => (b.registry.recipes[6].propsSchema.properties.value.default = 0.25),
    "number.step",
  ],
  [
    "非法规则字段",
    (b) => (b.registry.recipes[6].rules[0].fields[0] = "missing"),
    "rule.fields",
  ],
  [
    "集合规则误用",
    (b) =>
      (b.registry.recipes[3].propsSchema.properties.options.items = {
        type: "string",
      }),
    "rule.items",
  ],
  [
    "重复状态",
    (b) => b.registry.recipes[0].states.push("normal"),
    "schema.uniqueItems",
  ],
  [
    "失效条件",
    (b) => (b.registry.recipes[0].skinRoles[0].when.equals = "unknown"),
    "role.condition",
  ],
  ["悬空角色", (b) => b.usage.bindings.shift(), "reference.role"],
  [
    "悬空资产",
    (b) => (b.usage.bindings[0].assetId = "absent"),
    "reference.asset",
  ],
  [
    "错误使用方",
    (b) => (b.usage.bindings[0].assetId = "radio.dot"),
    "reference.consumer",
  ],
  ["过期模板引用", (b) => b.usage.templateRef.revision++, "reference.template"],
  [
    "切片超界",
    (b) =>
      (b.usage.bindings[0].nineSlice = {
        left: 9999,
        right: 0,
        top: 0,
        bottom: 0,
      }),
    "geometry.insets",
  ],
  [
    "最小尺寸耗尽",
    (b) => {
      b.usage.bindings[0].nineSlice = { left: 5, right: 5, top: 5, bottom: 5 };
      b.usage.bindings[0].minSize = { width: 10, height: 10 };
    },
    "geometry.minimum",
  ],
  [
    "行程超界",
    (b) =>
      (b.usage.controlGeometry.switchTravel = {
        coordinateSpace: "asset-body",
        assetId: "switch.track.off",
        axis: "x",
        start: 0,
        end: 9999,
        crossOffset: 0,
      }),
    "geometry.travel",
  ],
  ["缺少字体角色", (b) => delete b.usage.textStyles.body, "reference.style"],
  [
    "缺少几何入口",
    (b) => delete b.usage.controlGeometry.switchTravel,
    "reference.geometry",
  ],
  [
    "组合环",
    (b) => b.registry.recipes[0].composedRecipes.push("dialog@1.0.0"),
    "reference.cycle",
  ],
  [
    "用其他类型顶替用例",
    (b) => (b.registry.recipes[0].acceptanceCaseIds[7] = "T02"),
    "coverage.specific-type",
  ],
  [
    "省略公共用例",
    (b) => b.registry.recipes[0].acceptanceCaseIds.shift(),
    "coverage.common",
  ],
])
  test(name, () => has(check(mutate), code));
test("合法草案保留切片/字体/结构标记等阻断，无法填写一个 verified 字段伪造交付", () => {
  const { issues, blockers } = validateContracts(clone());
  assert.deepEqual(issues, []);
  for (const code of [
    "skin.metadata",
    "skin.policy",
    "skin.pending",
    "skin.no-accepted-pack",
    "runtime.production-unverified",
  ])
    assert.ok(blockers.some((b) => b.code === code));
});
test("属性默认值从 Schema 派生且不修改调用者对象；未知字段拒绝", () => {
  const input = { label: "确定" };
  const r = props("button", input);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(input, { label: "确定" });
  assert.equal(r.props.visible, true);
  assert.equal(r.props.enabled, true);
  assert.equal(r.props.variant, "primary");
  has(props("button", { icon: "sword" }), "schema.additionalProperties");
  has(props("button", { enabled: "true" }), "schema.type");
});
test("所有组件默认值可解析；三个外部必填属性不能被默认值掩盖", () => {
  const required = {
    List: "itemRecipeRef",
    Image: "sourceRef",
    Text: "textStyleRef",
  };
  for (const recipe of original.registry.recipes) {
    const result = validateProps(original.registry, recipeRef(recipe), {});
    if (required[recipe.type]) {
      assert.ok(
        result.issues.some((i) => i.path.endsWith(required[recipe.type])),
      );
    } else assert.deepEqual(result.issues, [], recipe.type);
  }
});
test("选择按稳定 ID 校验，重复标签合法，集合内重复 ID 和不存在选择拒绝", () => {
  const options = [
    { id: "a", label: "相同" },
    { id: "b", label: "相同" },
  ];
  assert.deepEqual(props("select", { options, selectedId: "b" }).issues, []);
  has(props("select", { options, selectedId: "missing" }), "selection.missing");
  has(
    props("radio-group", { options: [options[0], options[0]] }),
    "identity.duplicate",
  );
  has(
    props("tabs", { tabs: [{ id: "a", label: "A", contentNodeId: "pageA" }] }),
    "selection.required",
  );
  has(
    props("list", {
      items: options,
      itemRecipeRef: "button@1.0.0",
      selection: "none",
      selectedId: "a",
    }),
    "selection.none",
  );
  has(props("list", { itemRecipeRef: "missing@1.0.0" }), "reference.recipe");
});
test("小数步长、负 min 和不可整除的 max 端点；非有限数、越界和非法范围拒绝", () => {
  assert.deepEqual(
    props("slider", { min: -0.1, max: 1, step: 0.2, value: 0.3 }).issues,
    [],
  );
  assert.deepEqual(
    props("slider", { min: 0, max: 1, step: 0.3, value: 1 }).issues,
    [],
  );
  has(props("slider", { step: 0.3, value: 0.5 }), "number.step");
  has(props("slider", { min: 3, max: 2 }), "number.range");
  has(props("slider", { value: Infinity }), "schema.type");
  has(props("slider", { step: 0 }), "schema.exclusiveMinimum");
  has(props("progress-bar", { value: 101 }), "number.bounds");
});
test("Input 初始值使用 UTF-16 长度；不是 IME 行为验收", () => {
  assert.deepEqual(props("input", { value: "🙂", maxLength: 2 }).issues, []);
  has(props("input", { value: "🙂", maxLength: 1 }), "text.length");
  has(props("input", { value: 5 }), "schema.type");
});
test("属性校验明确返回待解析引用；提供上下文后悬空资源/页节点拒绝", () => {
  const input = { sourceRef: "portrait" };
  assert.equal(props("image", input).unresolved.length, 1);
  has(props("image", input, { resourceIds: [] }), "resource-ref");
  assert.deepEqual(
    props("image", input, { resourceIds: ["portrait"] }).unresolved,
    [],
  );
  has(
    props(
      "tabs",
      {
        tabs: [{ id: "a", label: "A", contentNodeId: "pageA" }],
        activeId: "a",
      },
      { nodeIds: [] },
    ),
    "reference.node",
  );
});
test("精确安装版本和扩展点声明匹配 lock，证据不包含主机绝对路径", async () => {
  const evidence = await dependencyEvidence();
  assert.equal(
    evidence.packages.find((p) => p.name === "@pixi/ui").version,
    "2.4.1",
  );
  assert.equal(
    evidence.packages.find((p) => p.name === "@pixi/layout").version,
    "3.2.0",
  );
  assert.ok(
    evidence.files.some((f) =>
      f.observedSymbols.includes("protected convertItemsToButtons"),
    ),
  );
  assert.ok(!JSON.stringify(evidence).includes(":\\"));
});

async function files() {
  const w = await workspace();
  const paths = {
    template: w.config,
    registry: join(w.directory, "registry.json"),
    usage: join(w.directory, "usage.json"),
    output: w.output,
  };
  await save(paths.registry, original.registry);
  await save(paths.usage, original.usage);
  return paths;
}
test("原子构建、精确源字节快照、源内容变更过期且 revision 不必先改", async () => {
  const paths = await files();
  await writeFile(
    paths.registry,
    " \n" + (await readFile(paths.registry, "utf8")),
  );
  const built = await buildContracts(paths);
  assert.equal(built.status, "built-draft");
  assert.equal((await contractStatus(paths)).status, "current");
  assert.deepEqual(
    await readFile(
      join(paths.output, "builds", built.buildId, "registry.source.json"),
    ),
    await readFile(paths.registry),
  );
  const r = structuredClone(original.registry);
  r.recipes[0].propsSchema.properties.label.default = "继续";
  await save(paths.registry, r);
  assert.equal((await contractStatus(paths)).status, "stale");
});
test("无效源与锁冲突都保留上一版入口；状态能识别坏产物", async () => {
  const paths = await files(),
    built = await buildContracts(paths),
    before = await readFile(join(paths.output, "current.json"));
  const bad = structuredClone(original.usage);
  bad.bindings[0].assetId = "missing";
  await save(paths.usage, bad);
  await assert.rejects(buildContracts(paths));
  assert.deepEqual(before, await readFile(join(paths.output, "current.json")));
  assert.equal((await contractStatus(paths)).status, "invalid-source");
  await save(paths.usage, original.usage);
  await writeFile(join(paths.output, ".build.lock"), "test-lock");
  await assert.rejects(
    buildContracts(paths),
    (e) => e.issues?.[0].code === "build.busy",
  );
  assert.deepEqual(before, await readFile(join(paths.output, "current.json")));
  await writeFile(
    join(paths.output, "builds", built.buildId, "catalog.json"),
    "{}",
  );
  assert.equal((await contractStatus(paths)).status, "corrupt");
});
test("派生目录不得包含输入源；坏 current 路径不得跳出 builds", async () => {
  const paths = await files();
  await assert.rejects(
    buildContracts({ ...paths, output: join(paths.registry, "..") }),
    (e) => e.issues?.[0].code === "output.source",
  );
  assert.equal((await contractStatus(paths)).status, "missing");
  await mkdir(paths.output, { recursive: true });
  await save(join(paths.output, "current.json"), {
    kind: "ui_contract_current",
    version: "0.1",
    buildId: "../../escape",
    recordSha256: "0".repeat(64),
  });
  assert.equal((await contractStatus(paths)).status, "corrupt");
});

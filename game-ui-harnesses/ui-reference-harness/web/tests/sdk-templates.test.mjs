import test from "node:test";
import assert from "node:assert/strict";
import {
  templateInput,
  templateList,
  templatePreview,
} from "../template-previews.mjs";
import {
  createPanelBundle,
  validatePanelBundle,
} from "../../../ui-panel-harness/src/panel-bundle.mjs";
import { loadWorkspaceCore } from "../../../ui-panel-harness/src/component-adapter.mjs";
import { visualStructure } from "../../src/panel.mjs";

test("selected example layouts and controls survive public producer round-trip", async () => {
  const core = await loadWorkspaceCore(),
    compiled = new Map();
  for (const template of templateList) {
    const { spec, catalog } = templateInput(template.id),
      bundle = await createPanelBundle(spec, catalog, core);
    await validatePanelBundle(JSON.parse(JSON.stringify(bundle)), core);
    const nodes = visualStructure(bundle.componentBundle.document);
    compiled.set(template.id, { spec, nodes });
    const interactive = nodes.filter((node) =>
      ["Button", "Switch", "Select", "Slider", "Tabs", "Input"].includes(
        node.type,
      ),
    );
    const settings = template.id === "sdk-settings";
    assert.equal(
      bundle.panelBundleVersion,
      settings ? "0.12" : "fixed-reference-1",
    );
    if (!settings) assert.equal(bundle.capabilities.target, "reference-only");
    assert.ok(
      interactive.every(
        (node) =>
          node.type === "Button" ||
          node.type === "Select" ||
          (settings && node.type === "Switch"),
      ),
    );
    for (const node of nodes)
      assert.ok(
        node.box.every(
          (value, index) => Math.abs(value - node.visibleBox[index]) < 1e-6,
        ),
        `${node.id} must be fully visible`,
      );
  }
  const nodes = (id, type) =>
    compiled.get(id).nodes.filter((node) => node.type === type);
  assert.equal(nodes("sdk-ready", "Button").length, 1);
  assert.equal(nodes("sdk-settings", "Switch").length, 3);
  assert.equal(nodes("sdk-settings", "Select").length, 1);
  assert.equal(nodes("sdk-settings", "Button").length, 1);
  assert.equal(nodes("sdk-settings", "Slider").length, 0);
  assert.equal(nodes("sdk-settings", "Tabs").length, 0);
  assert.equal(nodes("sdk-pause-online", "Button").length, 1);
  assert.equal(nodes("sdk-pause-local", "Button").length, 2);
  for (const id of ["sdk-result-complete", "sdk-result-failed"]) {
    assert.equal(
      nodes(id, "Container").filter((node) => node.id.includes(".metric."))
        .length,
      3,
    );
    assert.equal(nodes(id, "Button").length, 1);
  }
  for (const id of ["sdk-loading", "sdk-loading-failed"]) {
    assert.equal(nodes(id, "ProgressBar").length, 1);
    assert.equal(nodes(id, "Slider").length, 0);
  }
  assert.equal(nodes("sdk-loading", "Button").length, 0);
  assert.equal(nodes("sdk-loading-failed", "Button").length, 2);
  assert.equal(nodes("sdk-loading", "ProgressBar")[0].content.value, 60);
  assert.equal(nodes("sdk-loading-failed", "ProgressBar")[0].content.value, 40);
  assert.throws(() => templateInput("../../outside"), /TEMPLATE_UNKNOWN/);
  const find = (id, suffix) =>
    compiled.get(id).nodes.find((node) => node.id.endsWith(suffix));
  assert.deepEqual(find("sdk-settings", ".panel").box, [180, 164, 600, 472]);
  assert.deepEqual(
    find("sdk-settings", ".row.close-settings.control").box,
    [424, 548, 112, 56],
  );
  assert.deepEqual(
    find("sdk-settings", ".row.language-row.control").box,
    [384, 484, 352, 40],
  );
  assert.deepEqual(
    find("sdk-pause-online", ".panel").box,
    [220, 286, 520, 228],
  );
  assert.deepEqual(find("sdk-pause-local", ".panel").box, [220, 246, 520, 308]);
  assert.deepEqual(find("sdk-pause-local", ".resume").box, [356, 368, 248, 56]);
  assert.deepEqual(find("sdk-pause-local", ".menu").box, [356, 444, 248, 56]);
  assert.deepEqual(
    find("sdk-result-complete", ".panel").box,
    [200, 176, 560, 448],
  );
  assert.deepEqual(
    find("sdk-result-complete", ".restart").box,
    [344, 533, 272, 58],
  );
  assert.deepEqual(find("sdk-ready", ".panel").box, [220, 250, 520, 300]);
  assert.equal(nodes("sdk-ready", "Container").length, 2);
  const readyPanel = find("sdk-ready", ".panel").box;
  const readyTitle = find("sdk-ready", ".title").box;
  const readyStart = find("sdk-ready", ".start").box;
  for (const box of [readyPanel, readyTitle, readyStart])
    assert.equal(
      box[0] + box[2] / 2,
      480,
      "ready elements must share a horizontal center",
    );
  assert.equal(readyPanel[1] + readyPanel[3] / 2, 400);
  assert.ok(readyStart[1] - readyTitle[1] - readyTitle[3] >= 32);
  for (const id of ["sdk-loading", "sdk-loading-failed"]) {
    const plate = find(id, ".panel");
    assert.deepEqual(
      plate.box,
      id === "sdk-loading" ? [180, 296, 600, 208] : [180, 250, 600, 300],
    );
    const document = compiled.get(id).spec.document;
    assert.equal(document.root.children[0].props.drawBackground, true);
    assert.equal(plate.box[0] + plate.box[2] / 2, 480);
    assert.equal(plate.box[1] + plate.box[3] / 2, 400);
    const progress = find(id, ".progress").box;
    assert.equal(progress[0] + progress[2] / 2, 480);
    assert.equal(progress[1] + progress[3] / 2, 400);
  }
  for (const id of ["sdk-loading", "sdk-loading-failed"]) {
    const spinner = find(id, ".spinner");
    assert.ok(spinner);
    assert.equal(spinner.box[0] + spinner.box[2] / 2, 480);
    assert.ok(spinner.box[1] + spinner.box[3] < find(id, ".progress").box[1]);
    assert.equal(
      spinner.box[1] - find(id, ".panel").box[1],
      find(id, ".progress").box[1] - spinner.box[1] - spinner.box[3],
      "spinner must be centered between the card top and progress bar",
    );
  }
  assert.deepEqual(
    find("sdk-loading", ".progress").box,
    find("sdk-loading-failed", ".progress").box,
  );
  assert.deepEqual(
    find("sdk-loading", ".stage").box,
    find("sdk-loading-failed", ".error").box,
  );
  const failureText = nodes("sdk-loading-failed", "Text").map(
    (node) => node.content.text,
  );
  assert.ok(failureText.includes("场景资源加载失败"));
  assert.ok(!failureText.includes("正在准备图片"));
  const failedPreview = await templatePreview("sdk-loading-failed");
  assert.doesNotMatch(failedPreview, /正在准备图片/);
  assert.match(failedPreview, /\.spinner/);
  assert.match(failedPreview, /场景资源加载失败/);
  const { spec: flow, catalog: flowCatalog } =
    templateInput("flow-sdk-settings");
  const old = await createPanelBundle(flow, flowCatalog, core);
  const selectedSettings = templateInput("sdk-settings");
  assert.deepEqual(
    selectedSettings.spec.sections.flatMap((section) => section.rows),
    flow.sections.flatMap((section) => section.rows),
  );
  assert.deepEqual(selectedSettings.spec.state, flow.state);
  assert.equal(selectedSettings.spec.sections.length, 1);
  assert.deepEqual(selectedSettings.spec.actionLayouts, []);
  assert.ok(
    !nodes("sdk-settings", "Text").some((node) =>
      node.id.endsWith(".section.close.title"),
    ),
  );
  assert.equal(
    nodes("sdk-settings", "Text").filter((node) => node.content.text === "关闭")
      .length,
    1,
  );
  assert.equal(
    (await templatePreview("sdk-settings")).match(/>关闭<\/text>/g)?.length,
    1,
  );
  assert.deepEqual(
    selectedSettings.catalog.themes[0].tokens,
    flowCatalog.themes.find((theme) => theme.id === flow.theme.id).tokens,
  );
  assert.equal(
    nodes("sdk-settings", "Text").filter((node) => node.content.text === "设置")
      .length,
    1,
  );
  assert.equal(
    (await templatePreview("sdk-settings")).match(/>设置<\/text>/g)?.length,
    1,
  );
  assert.notEqual(
    await templatePreview("sdk-settings"),
    await templatePreview("flow-sdk-settings"),
  );
  assert.notEqual(
    await templatePreview("sdk-settings"),
    await templatePreview("fixed-sdk-settings"),
  );
  assert.equal(old.spec.layout.width, 600);
  assert.equal(
    visualStructure(old.componentBundle.document).filter(
      (node) => node.type === "Switch",
    ).length,
    3,
  );
  const forged = structuredClone(
    await createPanelBundle(
      templateInput("fixed-sdk-settings").spec,
      null,
      core,
    ),
  );
  forged.componentBundle.document.root.children[0].layout.width = 600;
  await assert.rejects(
    () => validatePanelBundle(forged, core),
    /FIXED_REFERENCE_REPLAY_MISMATCH/,
  );
});

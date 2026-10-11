import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { createStudio } from "../host.mjs";
import * as api from "../../src/index.mjs";
import { readJson, local, sha256, verifyBlob } from "../../src/common.mjs";
import { builtinPack } from "../../src/packs.mjs";
import { loadProject } from "../../src/project.mjs";
import { loadPrototype } from "../../src/panel.mjs";
import { archiveSyntheticRun, syntheticImage } from "../../tests/helpers.mjs";
import {
  DEVELOPMENT_0_7_RUNTIME_SHA256,
  SOURCE_0_6_RUNTIME_SHA256,
  SOURCE_0_7_RUNTIME_SHA256,
  SOURCE_0_7_1_RUNTIME_SHA256,
  SOURCE_0_7_2_RUNTIME_SHA256,
} from "../../src/compiler.mjs";
import { readImageZip } from "./read-image-zip.mjs";
import { templateInput } from "../template-previews.mjs";
import { styleDraftInput } from "../src/style-input.js";

function fileSnapshot(directory) {
  return Object.fromEntries(
    fs
      .readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const file = path.join(entry.parentPath, entry.name);
        return [path.relative(directory, file), sha256(fs.readFileSync(file))];
      }),
  );
}

test("panel trash is reversible in every manual workflow state and leaves core files unchanged", async (t) => {
  const { call, configured, workspace, restart } = await host(t),
    id = await configured();
  const base = `/projects/${id}`,
    panelRoute = `${base}/panels/main-menu`,
    directory = local(workspace, `projects/${id}`);
  async function cycle() {
    const before = fileSnapshot(directory),
      original = (await call(base)).panels[0];
    assert.equal((await call(`${panelRoute}/trash`, {})).status, "trashed");
    await call(`${panelRoute}/trash`, {});
    restart();
    const hidden = await call(base);
    assert.equal(hidden.panels.length, 0);
    assert.equal(hidden.deletedPanels[0].panelId, "main-menu");
    assert.deepEqual(hidden.deletedPanels[0].history, original.history);
    assert.equal(
      (await call("/bootstrap")).projects.find((project) => project.id === id)
        .panelCount,
      0,
    );
    assert.equal(
      (await call(`${panelRoute}/session`, undefined, 410)).error,
      "PANEL_TRASHED",
    );
    assert.equal(
      (await call(`${base}/plan`, { panelId: "main-menu" }, 410)).error,
      "PANEL_TRASHED",
    );
    assert.deepEqual(fileSnapshot(directory), before);
    await call(`${panelRoute}/restore`, {});
    await call(`${panelRoute}/restore`, {});
    assert.deepEqual((await call(base)).panels[0], original);
    assert.deepEqual(fileSnapshot(directory), before);
  }
  await cycle(); // No plan / needs generation.
  const plan = await call(`${base}/plan`, { panelId: "main-menu" }),
    route = `${base}/runs/${plan.run.slice(5)}`;
  await cycle(); // Awaiting authorization.
  await call(`${route}/authorize`, {
    planSha256: plan.planSha256,
    approval: "Synthetic test authorization.",
  });
  await cycle(); // Authorized.
  const reserved = await call(`${route}/request`, {});
  await cycle(); // Reserved manual exchange.
  await call(`${panelRoute}/trash`, {});
  const result = await call(`${route}/receive`, {
    requestSha256: reserved.requestSha256,
    image: syntheticImage(960, 800).toString("base64"),
  });
  assert.equal(result.status, "pending_visual_review"); // Already submitted external results may still finish.
  assert.equal((await call(base)).panels.length, 0);
  const review = {
    imageSha256: result.imageSha256,
    layout: "pass",
    style: "pass",
    copy: "pass",
    decision: "accept",
    note: "Synthetic test acceptance.",
  };
  assert.equal(
    (await call(`${route}/review`, review, 410)).error,
    "PANEL_TRASHED",
  );
  assert.equal(
    (await call(`${route}/generate`, {}, 410)).error,
    "PANEL_TRASHED",
  );
  await call(`${panelRoute}/restore`, {});
  await cycle(); // Pending review.
  await call(`${route}/review`, {
    ...review,
    layout: "fail",
    decision: "reject",
  });
  await cycle(); // Rejected review.
  assert.equal(
    (await call(`${base}/panels/missing/trash`, {}, 404)).error,
    "PANEL_UNKNOWN",
  );
});

for (const outcome of ["completed", "unknown"]) {
  test(`deleting a panel during session generation preserves the ${outcome} outcome without resubmitting`, async (t) => {
    let release,
      began,
      calls = 0;
    const gate = new Promise((resolve) => {
        release = resolve;
      }),
      started = new Promise((resolve) => {
        began = resolve;
      });
    const { call, configured, workspace, restart } = await host(t, {
      adapter: {
        generate: async ({ width, height }) => {
          calls++;
          began();
          await gate;
          if (outcome === "unknown")
            throw new Error("Synthetic provider outcome unknown.");
          return syntheticImage(width, height);
        },
      },
    });
    const id = await configured(),
      base = `/projects/${id}`,
      panelRoute = `${base}/panels/main-menu`,
      route = `${panelRoute}/session`;
    const session = await call(route),
      payload = sessionBody(session);
    const generating = call(
      `${route}/generate`,
      payload,
      outcome === "completed" ? 200 : 400,
    );
    await started;
    try {
      assert.equal((await call(`${panelRoute}/trash`, {})).status, "trashed");
      assert.equal((await call(base)).panels.length, 0);
      assert.equal(
        (await call(`${route}/generate`, payload, 410)).error,
        "PANEL_TRASHED",
      );
      assert.equal(calls, 1);
    } finally {
      release();
    }
    const result = await generating;
    assert.equal(
      outcome === "completed" ? result.source.status : result.error,
      outcome === "completed"
        ? "pending_visual_review"
        : "ADAPTER_INDETERMINATE_NO_RESUBMIT",
    );
    restart();
    const hidden = await call(base);
    assert.equal(hidden.panels.length, 0);
    assert.equal(
      hidden.deletedPanels[0].latestRun.status,
      outcome === "completed" ? "pending_visual_review" : "indeterminate",
    );
    const before = fileSnapshot(local(workspace, `projects/${id}`));
    await call(`${panelRoute}/restore`, {});
    const restored = await call(route);
    assert.equal(restored.key, session.key);
    assert.equal(restored.turns.length, 1);
    assert.equal(restored.revisionsRemaining, 3);
    assert.equal(restored.active, false);
    assert.equal(calls, 1);
    assert.deepEqual(fileSnapshot(local(workspace, `projects/${id}`)), before);
  });
}

test("deleting an accepted anchor excludes its panel from new exports while preserving anchor, history and old deliveries", async (t) => {
  let calls = 0;
  const { call, configured, workspace, origin, restart } = await host(t, {
    adapter: {
      generate: async ({ width, height }) => {
        calls++;
        return syntheticImage(width, height);
      },
    },
  });
  const id = await configured(),
    base = `/projects/${id}`;
  const beforeSession = await call(`${base}/panels/main-menu/session`);
  async function generateAndAccept(panelId, anchor = false) {
    const route = `${base}/panels/${panelId}/session`,
      session = await call(route),
      generated = await call(`${route}/generate`, sessionBody(session));
    await call(`${base}/runs/${generated.source.run.slice(5)}/review`, {
      imageSha256: generated.source.imageSha256,
      layout: "pass",
      style: "pass",
      copy: "pass",
      decision: "accept",
      note: "Synthetic fixture visual review.",
      useAsAnchor: anchor,
    });
  }
  await generateAndAccept("main-menu", true);
  await call(`${base}/import`, { template: "sdk-settings" });
  await generateAndAccept("sdk-settings");
  // A second image consumes one revision; trash/restore must preserve that count.
  const first = await call(`${base}/panels/sdk-settings/session`);
  await call(
    `${base}/panels/sdk-settings/session/generate`,
    sessionBody(first, "Synthetic revision."),
  );
  await call(`${base}/panels/sdk-settings/trash`, {});
  await call(`${base}/panels/sdk-settings/restore`, {});
  assert.equal(
    (await call(`${base}/panels/sdk-settings/session`)).revisionsRemaining,
    2,
  );
  const before = await call(base),
    all = await call(`${base}/export`, { format: "complete" });
  const deliveryBefore = fileSnapshot(
    local(workspace, `exports/${id}/${all.exportId}`),
  );
  const coreBefore = fileSnapshot(local(workspace, `projects/${id}`));
  await call(`${base}/panels/main-menu/trash`, {});
  restart();
  const hidden = await call(base);
  assert.equal(hidden.panels.length, 1);
  assert.deepEqual(hidden.anchor, before.anchor);
  assert.equal(
    sha256(
      Buffer.from(
        await (await fetch(`${origin}${hidden.anchor.image}`)).arrayBuffer(),
      ),
    ),
    before.anchor.imageSha256,
  );
  assert.equal(
    (await call(`${base}/import`, { template: "main-menu" }, 410)).error,
    "PANEL_TRASHED",
  );
  const exported = await call(`${base}/export`, {});
  assert.deepEqual(exported.panelIds, ["sdk-settings"]);
  assert.deepEqual(exported.excludedPanelIds, ["main-menu"]);
  assert.equal(
    api.validateDelivery(local(workspace, `exports/${id}/${exported.exportId}`))
      .status,
    "valid",
  );
  assert.equal(
    (await call(`${base}/export`, { panels: ["main-menu"] }, 410)).error,
    "PANEL_TRASHED",
  );
  assert.equal(
    (await call(`${base}/plan-project`, {})).status,
    "nothing_to_plan",
  );
  assert.equal(
    (await call(`${base}/plan-project`, { panelIds: null })).status,
    "nothing_to_plan",
  );
  assert.deepEqual(
    fileSnapshot(local(workspace, `projects/${id}`)),
    coreBefore,
  );
  assert.deepEqual(
    fileSnapshot(local(workspace, `exports/${id}/${all.exportId}`)),
    deliveryBefore,
  );
  await call(`${base}/panels/main-menu/restore`, {});
  assert.equal(
    (await call(`${base}/panels/main-menu/session`)).key,
    beforeSession.key,
  );
  assert.deepEqual((await call(`${base}/export`, {})).panelIds, [
    "main-menu",
    "sdk-settings",
  ]);
  assert.equal(calls, 3);
});

const sessionBody = (session, feedback = "") => ({
  sessionKey: session.key,
  version: session.version,
  operationId: randomUUID(),
  note: session.note,
  feedback,
  sourceImageSha256: session.source?.imageSha256 ?? null,
});

for (const runtime of [
  SOURCE_0_6_RUNTIME_SHA256,
  DEVELOPMENT_0_7_RUNTIME_SHA256,
  SOURCE_0_7_RUNTIME_SHA256,
  SOURCE_0_7_1_RUNTIME_SHA256,
  SOURCE_0_7_2_RUNTIME_SHA256,
]) {
  test(`completed archived Studio image remains reviewable after restart: ${runtime.slice(0, 8)}`, async (t) => {
    let calls = 0;
    const { call, configured, restart, workspace } = await host(t, {
      adapter: {
        generate: async () => {
          calls++;
          return syntheticImage(384, 320);
        },
      },
    });
    const id = await configured(),
      sessionRoute = `/projects/${id}/panels/main-menu/session`;
    let session = await call(sessionRoute);
    session = await call(`${sessionRoute}/generate`, sessionBody(session));
    const { run, imageSha256 } = session.source,
      directory = local(workspace, `projects/${id}`),
      route = `/projects/${id}/runs/${run.slice(5)}`;
    archiveSyntheticRun(directory, run, runtime);
    const immutableNames = [
      "plan.json",
      "authorization.json",
      "attempt.json",
      "request.json",
      "raw.png",
      "receipt.json",
      "technical.json",
      "reference.png",
    ];
    const before = immutableNames.map((name) =>
      fs.readFileSync(local(directory, `${run}/${name}`)),
    );
    restart();
    const state = (await call(route)).state;
    assert.equal(state.status, "pending_visual_review");
    assert.equal(state.executable, false);
    assert.equal((await call(sessionRoute)).source.imageSha256, imageSha256);
    const review = {
      imageSha256,
      layout: "pass",
      style: "pass",
      copy: "pass",
      decision: "accept",
      note: "Synthetic archived image acceptance.",
      useAsAnchor: true,
    };
    assert.equal(
      (
        await call(
          `${route}/review`,
          { ...review, imageSha256: "0".repeat(64) },
          400,
        )
      ).error,
      "REVIEW_IMAGE_MISMATCH",
    );
    assert.equal(fs.existsSync(local(directory, `${run}/review.json`)), false);
    assert.equal(
      (await call(`${route}/generate`, {}, 400)).error,
      "PLAN_CONTRACT_OR_RUNTIME_CHANGED",
    );
    assert.equal((await call(`${route}/review`, review)).status, "accepted");
    assert.equal((await call(sessionRoute)).source.status, "accepted");
    const project = await call(`/projects/${id}`);
    assert.equal(project.anchor.imageSha256, imageSha256);
    assert.equal(project.panels[0].acceptedRun, run);
    const exported = await call(`/projects/${id}/export`, {});
    assert.equal(
      api.validateDelivery(
        local(workspace, `exports/${id}/${exported.exportId}`),
      ).status,
      "valid",
    );
    assert.equal(calls, 1);
    immutableNames.forEach((name, index) =>
      assert.ok(
        fs
          .readFileSync(local(directory, `${run}/${name}`))
          .equals(before[index]),
      ),
    );
  });
}

for (const [scope, runtime] of [
  ["project-drafts", SOURCE_0_6_RUNTIME_SHA256],
  ["projects", DEVELOPMENT_0_7_RUNTIME_SHA256],
  ["project-drafts", SOURCE_0_7_RUNTIME_SHA256],
  ["projects", SOURCE_0_7_RUNTIME_SHA256],
  ["project-drafts", SOURCE_0_7_1_RUNTIME_SHA256],
  ["projects", SOURCE_0_7_1_RUNTIME_SHA256],
  ["project-drafts", SOURCE_0_7_2_RUNTIME_SHA256],
  ["projects", SOURCE_0_7_2_RUNTIME_SHA256],
]) {
  test(`archived style preview stays readable and adoptable without generation: ${scope}/${runtime.slice(0, 8)}`, async (t) => {
    let calls = 0;
    const { call, configured, restart, workspace, origin } = await host(t, {
      adapter: {
        generate: async (input) => {
          calls++;
          return syntheticImage(input.width, input.height);
        },
      },
    });
    const draft =
      scope === "project-drafts"
        ? await call("/project-drafts", {
            name: "Archived preview fixture",
            style: { preset: "fantasy-handpainted" },
          })
        : { id: await configured() };
    const style =
      draft.style ??
      (await call(`/projects/${draft.id}/style-draft`, {
        preset: "fantasy-handpainted",
      }));
    const route = `/${scope}/${draft.id}/style-preview`,
      operationId = randomUUID();
    const body = {
      styleSha256: style.sha256,
      operationId,
      approval: "Synthetic preview compute decision.",
    };
    const preview = await call(route, body);
    const relative = `style-previews/${scope}/${draft.id}/${operationId}`;
    const recordFile = local(workspace, `${relative}/record.json`),
      record = readJson(recordFile);
    const directory = local(workspace, `${relative}/project`);
    record.planSha256 = archiveSyntheticRun(
      directory,
      record.run,
      runtime,
    ).sha256;
    fs.writeFileSync(recordFile, JSON.stringify(record)); // Historical synthetic fixture only.
    const before = fs.readFileSync(local(directory, `${record.run}/raw.png`));
    restart();
    const saved = await call(`${route}/${operationId}`);
    assert.equal(saved.imageSha256, preview.imageSha256);
    assert.equal(saved.status, "pending_visual_review");
    assert.deepEqual(await call(route, body), saved);
    const image = await fetch(`${origin}${saved.image}`);
    assert.equal(image.status, 200);
    assert.equal(
      sha256(Buffer.from(await image.arrayBuffer())),
      saved.imageSha256,
    );
    const confirmation = {
      styleSha256: style.sha256,
      approval: "Synthetic archived preview visual acceptance.",
      preview: { operationId, imageSha256: saved.imageSha256 },
    };
    const adopted =
      scope === "project-drafts"
        ? await call(
            "/projects",
            {
              name: "Archived preview fixture",
              draftId: draft.id,
              ...confirmation,
            },
            201,
          )
        : await call(`/projects/${draft.id}/style-activate`, confirmation);
    const project = await call(`/projects/${draft.id}`);
    assert.equal(project.activeStyle, adopted.activeStyle);
    assert.equal(
      api.loadStyle(
        local(workspace, `projects/${draft.id}`),
        project.activeStyle,
      ).references[0].artifact.sha256,
      saved.imageSha256,
    );
    assert.equal(api.inspectRun(directory, record.run).status, "accepted");
    assert.equal(api.inspectRun(directory, record.run).executable, false);
    assert.ok(
      fs.readFileSync(local(directory, `${record.run}/raw.png`)).equals(before),
    );
    assert.equal(calls, 1);
  });
}

test("custom reference previews do not inherit the previously selected default style", async (t) => {
  let captured,
    calls = 0;
  const { call, workspace } = await host(t, {
    adapter: {
      generate: async (input) => {
        captured = input;
        calls++;
        return syntheticImage(input.width, input.height);
      },
    },
  });
  const original = syntheticImage(160, 100);
  const input = styleDraftInput({
    custom: true,
    preset: "chinese-fantasy",
    reference: original.toString("base64"),
    notes: "",
  });
  assert.equal(Object.hasOwn(input, "preset"), false);
  assert.equal(Object.hasOwn(input, "packFile"), false);
  const draft = await call("/project-drafts", {
    name: "Custom reference only",
    style: input,
  });
  assert.equal(draft.style.source.kind, "custom");
  assert.equal(draft.style.source.basePack, null);
  assert.equal(draft.style.pack.base_style, null);
  assert.equal(draft.style.rules.palette, null);
  assert.ok(
    verifyBlob(
      local(workspace, `drafts/${draft.id}`),
      draft.style.references[0].artifact,
    ).equals(original),
  );
  await call(`/project-drafts/${draft.id}/style-preview`, {
    styleSha256: draft.style.sha256,
    operationId: randomUUID(),
    approval: "Synthetic custom reference preview decision.",
  });
  assert.ok(
    captured.images.some(
      (image) =>
        image.role === "primary-style" && image.sha256 === sha256(original),
    ),
  );
  const previous = builtinPack("chinese-fantasy");
  for (const value of Object.values(previous.render_style))
    assert.ok(!captured.prompt.includes(value));
  assert.equal(calls, 1);
  assert.equal((await call("/bootstrap")).projects.length, 0);
  assert.deepEqual(
    styleDraftInput({ custom: false, preset: "chinese-fantasy", notes: "" }),
    {
      preset: "chinese-fantasy",
      notes: "",
      resolveNotes: false,
    },
  );
});

test("style preview freezes complete rules, generates once and adopts its image only on final project confirmation", async (t) => {
  let calls = 0,
    captured;
  const { call, workspace, restart, origin } = await host(t, {
    adapter: {
      generate: async (input) => {
        calls++;
        captured = input;
        return syntheticImage(input.width, input.height);
      },
    },
  });
  const pack = structuredClone(builtinPack("western-cartoon"));
  pack.render_style.color = "青紫赛博朋克配色";
  pack.palette.primary = "#00E5FF";
  const original = syntheticImage(160, 100);
  const draft = await call("/project-drafts", {
    name: "Preview fixture",
    style: {
      pack,
      reference: original.toString("base64"),
      notes: "颜色以赛博朋克风格为主",
    },
  });
  assert.equal(calls, 0);
  const route = `/project-drafts/${draft.id}/style-preview`,
    operationId = randomUUID();
  const body = {
    styleSha256: draft.style.sha256,
    operationId,
    approval: "Synthetic one-image preview decision.",
  };
  const preview = await call(route, body);
  assert.equal(preview.status, "pending_visual_review");
  assert.equal(preview.active, false);
  assert.equal(calls, 1);
  assert.equal(captured.attemptSha256, preview.planSha256);
  assert.match(captured.prompt, /青紫赛博朋克配色/);
  assert.match(captured.prompt, /#00E5FF/);
  assert.equal(captured.width, 960);
  assert.equal(captured.height, 800);
  const source = local(workspace, `drafts/${draft.id}`);
  assert.equal(readJson(local(source, "project.json")).activeStyle, null);
  assert.equal((await call("/bootstrap")).projects.length, 0);
  const image = Buffer.from(
    await (await fetch(`${origin}${preview.image}`)).arrayBuffer(),
  );
  assert.equal(sha256(image), preview.imageSha256);
  const isolated = local(
    workspace,
    `style-previews/project-drafts/${draft.id}/${operationId}/project`,
  );
  const saved = readJson(
    local(
      workspace,
      `style-previews/project-drafts/${draft.id}/${operationId}/record.json`,
    ),
  );
  assert.equal(
    fs.existsSync(local(isolated, `${saved.run}/review.json`)),
    false,
  );
  restart();
  assert.deepEqual(await call(`${route}/${operationId}`), preview);
  assert.deepEqual(await call(route, body), preview);
  assert.equal(calls, 1);
  await call(
    "/projects",
    {
      name: "Preview fixture",
      draftId: draft.id,
      styleSha256: draft.style.sha256,
      approval: "Synthetic wrong image decision.",
      preview: { operationId, imageSha256: "0".repeat(64) },
    },
    400,
  );
  assert.equal(
    fs.existsSync(local(isolated, `${saved.run}/review.json`)),
    false,
  );
  const confirmation = {
    name: "Preview fixture",
    draftId: draft.id,
    styleSha256: draft.style.sha256,
    approval: "Synthetic final image layout/style/copy acceptance.",
    preview: { operationId, imageSha256: preview.imageSha256 },
  };
  const created = await call("/projects", confirmation, 201);
  assert.notEqual(created.activeStyle, draft.style.sha256);
  assert.equal(created.panels.length, 0);
  assert.equal(created.anchor, null);
  const directory = local(workspace, `projects/${created.id}`),
    style = api.loadStyle(directory, created.activeStyle);
  assert.equal(style.references[0].artifact.sha256, preview.imageSha256);
  assert.ok(
    verifyBlob(directory, draft.style.references[0].artifact).equals(original),
  );
  assert.equal(style.pack.render_style.color, pack.render_style.color);
  assert.equal(
    (await call("/projects", confirmation, 201)).activeStyle,
    created.activeStyle,
  );
  await call(`/projects/${created.id}/import`, { template: "main-menu" });
  const plan = await call(`/projects/${created.id}/plan`, {
    panelId: "main-menu",
  });
  assert.equal(plan.styleSha256, created.activeStyle);
  assert.ok(
    plan.request.images.some(
      (item) => item.artifact.sha256 === preview.imageSha256,
    ),
  );
  assert.equal(calls, 1);
});

test("existing project style previews leave the current project intact and reject foreign preview adoption", async (t) => {
  let calls = 0;
  const { call, configured, workspace } = await host(t, {
    adapter: {
      generate: async (input) => {
        calls++;
        return syntheticImage(input.width, input.height);
      },
    },
  });
  const id = await configured(),
    other = await configured();
  const before = await call(`/projects/${id}`),
    draft = await call(`/projects/${id}/style-draft`, {
      preset: "pixel-cartoon",
    });
  const body = {
    styleSha256: draft.sha256,
    operationId: randomUUID(),
    approval: "Synthetic preview click.",
  };
  const preview = await call(`/projects/${id}/style-preview`, body);
  assert.equal((await call(`/projects/${id}`)).activeStyle, before.activeStyle);
  assert.deepEqual((await call(`/projects/${id}`)).panels, before.panels);
  const otherDraft = await call(`/projects/${other}/style-draft`, {
    preset: "pixel-cartoon",
  });
  await call(
    `/projects/${other}/style-activate`,
    {
      styleSha256: otherDraft.sha256,
      approval: "Foreign preview must fail.",
      preview: {
        operationId: body.operationId,
        imageSha256: preview.imageSha256,
      },
    },
    400,
  );
  await call(`/projects/${id}/style-activate`, {
    styleSha256: draft.sha256,
    approval: "Synthetic final preview acceptance.",
    preview: {
      operationId: body.operationId,
      imageSha256: preview.imageSha256,
    },
  });
  const after = await call(`/projects/${id}`);
  assert.notEqual(after.activeStyle, before.activeStyle);
  assert.equal(
    api.loadStyle(local(workspace, `projects/${id}`), after.activeStyle)
      .references[0].artifact.sha256,
    preview.imageSha256,
  );
  assert.equal(after.panels.length, before.panels.length);
  assert.equal(calls, 1);
});

test("failed style previews are terminal, survive restart and never automatically resubmit", async (t) => {
  let calls = 0;
  const { call, restart } = await host(t, {
    adapter: {
      generate: async () => {
        calls++;
        throw new Error("Synthetic unknown outcome.");
      },
    },
  });
  const draft = await call("/project-drafts", {
    name: "Failure preview",
    style: { preset: "concept-art" },
  });
  const route = `/project-drafts/${draft.id}/style-preview`,
    body = {
      styleSha256: draft.style.sha256,
      operationId: randomUUID(),
      approval: "Synthetic one-image decision.",
    };
  assert.equal(
    (await call(route, body, 400)).error,
    "ADAPTER_INDETERMINATE_NO_RESUBMIT",
  );
  assert.equal(
    (await call(`${route}/${body.operationId}`)).status,
    "indeterminate",
  );
  restart();
  assert.equal((await call(route, body)).status, "indeterminate");
  assert.equal(calls, 1);
  await call(
    route,
    {
      ...body,
      operationId: randomUUID(),
      approval: "Synthetic new explicit decision.",
    },
    400,
  );
  assert.equal(calls, 2);
  assert.equal((await call("/bootstrap")).projects.length, 0);
});

test("pending style preview blocks competing generation and final adoption until a result exists", async (t) => {
  let release, started;
  const pending = new Promise((resolve) => {
    started = resolve;
  });
  const { call } = await host(t, {
    adapter: {
      generate: async (input) => {
        started();
        await new Promise((resolve) => {
          release = resolve;
        });
        return syntheticImage(input.width, input.height);
      },
    },
  });
  const draft = await call("/project-drafts", {
    name: "Pending preview",
    style: { preset: "concept-art" },
  });
  const route = `/project-drafts/${draft.id}/style-preview`,
    body = {
      styleSha256: draft.style.sha256,
      operationId: randomUUID(),
      approval: "Synthetic preview decision.",
    };
  const first = call(route, body);
  await pending;
  try {
    assert.equal((await call("/bootstrap")).stylePreviewActive, true);
    assert.equal(
      (await call(route, { ...body, operationId: randomUUID() }, 400)).error,
      "PROJECT_BUSY",
    );
    assert.equal((await call(route, body)).active, true);
    await call(
      "/projects",
      {
        name: "Pending preview",
        draftId: draft.id,
        styleSha256: draft.style.sha256,
        approval: "Cannot accept missing image.",
        preview: { operationId: body.operationId, imageSha256: "0".repeat(64) },
      },
      400,
    );
  } finally {
    release();
  }
  assert.equal((await first).status, "pending_visual_review");
  assert.equal((await call("/bootstrap")).stylePreviewActive, false);
});

test("resolved project preferences freeze full rules and palette for every panel only after approval", async (t) => {
  let resolves = 0,
    imageCalls = 0,
    captured;
  const { call, configured, workspace, restart } = await host(t, {
    adapter: {
      generate: async () => {
        imageCalls++;
        throw new Error("must not generate");
      },
      resolveStyle: async ({ base, notes }) => {
        resolves++;
        captured = base;
        assert.equal(notes, "颜色以赛博朋克风格为主");
        return {
          render_style: {
            ...base.pack.render_style,
            color: "青紫霓虹配色",
            lighting: "克制霓虹边光",
          },
          ui_rules: { ...base.pack.ui_rules, frame: "保留轮廓，青紫描边" },
          palette: {
            background: "#101426",
            surface: "#202740",
            primary: "#00DFFF",
            secondary: "#F040FF",
            text: "#F1F4FF",
          },
          negative_rules: base.pack.negative_rules.filter(
            (rule) => !rule.includes("禁止霓虹"),
          ),
          summary: "采用青紫赛博朋克配色。",
        };
      },
    },
  });
  const id = await configured(),
    before = await call(`/projects/${id}`);
  const pack = structuredClone(builtinPack("chinese-fantasy"));
  pack.negative_rules.push("禁止霓虹色。");
  const image = syntheticImage(160, 100);
  const draft = await call(`/projects/${id}/style-draft`, {
    pack,
    reference: image.toString("base64"),
    notes: "颜色以赛博朋克风格为主",
    resolveNotes: true,
  });
  assert.equal(resolves, 1);
  assert.equal((await call(`/projects/${id}`)).activeStyle, before.activeStyle);
  assert.equal(draft.rules.palette.primary, "#00DFFF");
  assert.equal(draft.pack.render_style.color, "青紫霓虹配色");
  assert.ok(!draft.pack.negative_rules.includes("禁止霓虹色。"));
  assert.equal(draft.source.kind, "custom");
  assert.ok(draft.resolution.changes.includes("配色"));
  const directory = local(workspace, `projects/${id}`);
  assert.ok(verifyBlob(directory, draft.references[0].artifact).equals(image));
  assert.equal(
    api.loadStyle(directory, captured.sha256).pack.negative_rules.at(-1),
    "禁止霓虹色。",
  );
  await call(`/projects/${id}/style-activate`, {
    styleSha256: draft.sha256,
    approval: "Synthetic review of final resolved draft.",
  });
  await call(`/projects/${id}/import`, { template: "exit-confirm" });
  restart();
  for (const panelId of ["main-menu", "exit-confirm"]) {
    const plan = await call(`/projects/${id}/plan`, { panelId });
    assert.equal(plan.styleSha256, draft.sha256);
    assert.match(plan.request.prompt, /#00DFFF/);
    assert.match(plan.request.prompt, /青紫霓虹配色/);
    assert.ok(!plan.request.prompt.includes("禁止霓虹色。"));
  }
  assert.equal(resolves, 1);
  assert.equal(imageCalls, 0);
});

test("text resolution needs an explicit flag; failure, unavailable resolver and cancellation never publish a project", async (t) => {
  let resolves = 0;
  const { call } = await host(t, {
    adapter: {
      generate: async () => {
        throw new Error("must not generate");
      },
      resolveStyle: async () => {
        resolves++;
        throw new Error("STYLE_RESOLUTION_FAILED");
      },
    },
  });
  await call(
    "/project-drafts",
    {
      name: "Failure",
      style: { preset: "concept-art", notes: "蓝色", resolveNotes: true },
    },
    400,
  );
  assert.equal(resolves, 1);
  assert.equal((await call("/bootstrap")).projects.length, 0);
  await call("/project-drafts", {
    name: "Blank default",
    style: { preset: "concept-art", notes: "", resolveNotes: false },
  });
  await call("/project-drafts", {
    name: "Legacy API notes",
    style: { preset: "concept-art", notes: "plain note" },
  });
  assert.equal(resolves, 1);
  assert.equal((await call("/bootstrap")).projects.length, 0);
  const noResolver = await host(t);
  const failure = await noResolver.call(
    "/project-drafts",
    {
      name: "No resolver",
      style: { preset: "concept-art", notes: "蓝色", resolveNotes: true },
    },
    400,
  );
  assert.equal(failure.error, "STYLE_RESOLVER_NOT_CONFIGURED");
  assert.equal((await noResolver.call("/bootstrap")).projects.length, 0);
});

test("pending style resolution blocks competing writes and an invalid result leaves the active style intact", async (t) => {
  let release, started;
  const pending = new Promise((resolve) => {
    started = resolve;
  });
  const { call, configured } = await host(t, {
    adapter: {
      generate: async () => {
        throw new Error("must not generate");
      },
      resolveStyle: async () => {
        started();
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    },
  });
  const id = await configured(),
    before = await call(`/projects/${id}`);
  const draft = call(
    `/projects/${id}/style-draft`,
    { preset: "concept-art", notes: "蓝色", resolveNotes: true },
    400,
  );
  await pending;
  assert.equal(
    (await call(`/projects/${id}/trash`, {}, 400)).error,
    "PROJECT_BUSY",
  );
  assert.equal(
    (await call(`/projects/${id}/plan`, { panelId: "main-menu" }, 400)).error,
    "PROJECT_BUSY",
  );
  release({ unexpected: "invalid output" });
  await draft;
  assert.equal((await call(`/projects/${id}`)).activeStyle, before.activeStyle);
  const next = await call(`/projects/${id}/style-draft`, {
    preset: "pixel-cartoon",
  });
  assert.ok(next.sha256);
});

test("restart recovery closes an interrupted reservation only after a fresh click, counts its round and never dispatches it", async (t) => {
  let calls = 0;
  const { call, configured, restart, workspace } = await host(t, {
    adapter: {
      generate: async () => {
        calls++;
        return syntheticImage(384, 320);
      },
    },
  });
  const id = await configured(),
    route = `/projects/${id}/panels/main-menu/session`;
  let session = await call(route);
  session = await call(`${route}/generate`, sessionBody(session));
  const directory = local(workspace, `projects/${id}`);
  const interrupted = api.createRevisionPlan(directory, {
    sourceRun: session.source.run,
    note: "Synthetic interrupted edit.",
  });
  api.authorize(
    directory,
    interrupted.run,
    interrupted.planSha256,
    "Synthetic fresh click before interruption.",
  );
  api.reserve(directory, interrupted.run);
  const file = local(workspace, `panel-sessions/${id}/${session.key}.json`),
    saved = readJson(file);
  saved.turns.push({
    operationId: randomUUID(),
    run: interrupted.run,
    round: 1,
    note: "Synthetic interrupted edit.",
    created: new Date().toISOString(),
    error: null,
  });
  saved.version++;
  fs.writeFileSync(file, JSON.stringify(saved)); // Synthetic crash fixture, never a core attempt edit.
  restart();
  session = await call(route);
  assert.equal(session.interrupted, true);
  assert.equal(session.revisionsUsed, 1);
  assert.equal(calls, 1);
  assert.equal(
    api.inspectRun(directory, interrupted.run).status,
    "reserved_no_resubmit",
  );
  session = await call(
    `${route}/generate`,
    sessionBody(session, "A fresh explicit replacement decision."),
  );
  assert.equal(
    api.inspectRun(directory, interrupted.run).status,
    "indeterminate",
  );
  assert.equal(session.revisionsUsed, 2);
  assert.equal(session.source.round, 2);
  assert.equal(calls, 2);
});

test("one-click sessions freeze and authorize once, persist drafts/history across restart and enforce three revisions", async (t) => {
  const requests = [];
  const { call, configured, restart, workspace } = await host(t, {
    adapter: {
      generate: async (input) => {
        requests.push(input);
        return syntheticImage(384, 320);
      },
    },
  });
  const id = await configured(),
    route = `/projects/${id}/panels/main-menu/session`;
  let session = await call(route);
  assert.equal(session.version, 0);
  assert.equal(requests.length, 0);
  session = await call(`${route}/draft`, {
    sessionKey: session.key,
    version: session.version,
    note: "Keep buttons readable.",
    feedback: "",
  });
  restart();
  session = await call(route);
  assert.equal(session.note, "Keep buttons readable.");
  const click = sessionBody(session);
  session = await call(`${route}/generate`, click);
  assert.equal(session.source.status, "pending_visual_review");
  assert.equal((await call(`/projects/${id}`)).anchor, null);
  assert.equal((await call(`/projects/${id}`)).panels[0].acceptedRun, null);
  await call(`${route}/generate`, click);
  assert.equal(requests.length, 1);
  for (let round = 1; round <= 3; round++) {
    session = await call(
      `${route}/generate`,
      sessionBody(session, `Feedback ${round}`),
    );
    assert.equal(session.revisionsUsed, round);
    assert.equal(session.revisionsRemaining, 3 - round);
    assert.equal(requests[round].images[0].role, "revision-source");
    assert.equal(requests[round].sessionKey, requests[0].sessionKey);
    const plan = api.verifyPlan(
      local(workspace, `projects/${id}`),
      session.source.run,
    );
    assert.equal(plan.revision.round, round);
    assert.equal(plan.intent.note, "Keep buttons readable.");
    restart();
    session = await call(route);
  }
  assert.equal(session.turns.length, 4);
  await call(`${route}/generate`, sessionBody(session, "Fourth revision"), 400);
  assert.equal(requests.length, 4);
  const source = session.source;
  await call(`/projects/${id}/runs/${source.run.slice(5)}/review`, {
    imageSha256: source.imageSha256,
    layout: "pass",
    style: "pass",
    copy: "pass",
    decision: "accept",
    note: "Synthetic one-click acceptance.",
  });
  assert.equal((await call(route)).source.status, "accepted");
  assert.equal((await call(`/projects/${id}/export`, {})).status, "exported");
});

test("sessions preserve the previous preview while generating, reject stale tabs and never replay an unknown attempt", async (t) => {
  let calls = 0,
    release,
    fail = false;
  const { call, configured, restart } = await host(t, {
    adapter: {
      generate: async () => {
        calls++;
        if (calls > 1) {
          await new Promise((resolve) => {
            release = resolve;
          });
          if (fail) throw new Error("Synthetic unknown result.");
        }
        return syntheticImage(384, 320);
      },
    },
  });
  const id = await configured(),
    route = `/projects/${id}/panels/main-menu/session`;
  let session = await call(route);
  session = await call(`${route}/generate`, sessionBody(session));
  const old = session,
    payload = sessionBody(session, "Refine border");
  fail = true;
  const pending = call(`${route}/generate`, payload, 400);
  for (let count = 0; count < 100 && !release; count++)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(typeof release, "function");
  const active = await call(route);
  assert.equal(active.active, true);
  assert.equal(active.source.run, old.source.run);
  assert.equal(
    (await call(`/projects/${id}`)).panels[0].displayRun,
    old.source.run,
  );
  await call(`${route}/generate`, payload, 400);
  assert.equal(calls, 2);
  release();
  await pending;
  restart();
  session = await call(route);
  assert.equal(session.active, false);
  assert.equal(session.revisionsUsed, 1);
  assert.equal(session.turns.at(-1).status, "indeterminate");
  assert.equal(session.source.run, old.source.run);
  await call(`${route}/generate`, payload);
  assert.equal(calls, 2);
  await call(
    `${route}/draft`,
    { sessionKey: old.key, version: old.version, note: "stale", feedback: "" },
    400,
  );
  const before = session.key;
  const style = await call(`/projects/${id}/style-draft`, {
    preset: "chinese-fantasy",
  });
  await call(`/projects/${id}/style-activate`, {
    styleSha256: style.sha256,
    approval: "Synthetic style switch.",
  });
  const changed = await call(route);
  assert.notEqual(changed.key, before);
  assert.equal(changed.source, null);
  await call(`${route}/generate`, sessionBody(session, "stale style"), 400);
  assert.equal(calls, 2);
});

test("session setup failure consumes no generation or revision and an existing verified image can be adopted without compute", async (t) => {
  let unavailable = true,
    calls = 0;
  const { call, configured } = await host(t, {
    adapter: {
      preflight: async () => {
        if (unavailable) throw new Error("CODEX_IMAGE_GATE_UNAVAILABLE");
      },
      generate: async () => {
        calls++;
        return syntheticImage(384, 320);
      },
    },
  });
  const id = await configured(),
    route = `/projects/${id}/panels/main-menu/session`;
  const session = await call(route);
  await call(`${route}/generate`, sessionBody(session), 400);
  let after = await call(route);
  assert.equal(after.revisionsUsed, 0);
  assert.equal(after.turns[0].run, null);
  assert.equal(calls, 0);
  unavailable = false;
  after = await call(`${route}/generate`, sessionBody(after));
  assert.equal(calls, 1);
  const plan = await call(`/projects/${id}/plan`, { panelId: "main-menu" });
  await call(`/projects/${id}/runs/${plan.run.slice(5)}/authorize`, {
    planSha256: plan.planSha256,
    approval: "Synthetic manual first image.",
  });
  await call(`/projects/${id}/runs/${plan.run.slice(5)}/generate`, {});
  // The existing session keeps its own immutable version history, rather than
  // silently importing an unrelated new attempt into that conversation.
  assert.equal((await call(route)).source.run, after.source.run);
});

async function host(t, options = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ui-reference-web-test-"));
  const studio = createStudio({
    workspace: path.join(temp, "workspace"),
    ...options,
  });
  const server = http.createServer(studio.handler);
  let origin;
  // Some OS-assigned ephemeral ports are forbidden by fetch (e.g. 6000).
  // Probe a side-effect-free unknown route and bind again only for that case.
  for (;;) {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    origin = `http://127.0.0.1:${server.address().port}`;
    studio.setOrigin(origin);
    try {
      await (await fetch(`${origin}/__test_port_probe__`)).arrayBuffer();
      break;
    } catch (error) {
      if (error.cause?.message !== "bad port") throw error;
      await new Promise((resolve) => server.close(resolve));
    }
  }
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temp).startsWith("ui-reference-web-test-"));
    fs.rmSync(temp, { recursive: true, force: true });
  });
  async function call(route, body, expected = 200) {
    const response = await fetch(
      `${origin}/api${route}`,
      body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json", Origin: origin },
            body: JSON.stringify(body),
          },
    );
    const value = await response.json();
    assert.equal(response.status, expected, JSON.stringify(value));
    return value;
  }
  async function configured(name = "Synthetic fixture only") {
    const project = await call("/projects", { name }, 201),
      id = project.id;
    const draft = await call(`/projects/${id}/style-draft`, {
      preset: "concept-art",
    });
    await call(`/projects/${id}/style-activate`, {
      styleSha256: draft.sha256,
      approval: "Synthetic test style decision.",
    });
    await call(`/projects/${id}/import`, { template: "main-menu" });
    return id;
  }
  return {
    temp,
    origin,
    call,
    configured,
    workspace: path.join(temp, "workspace"),
    restart() {
      const next = createStudio({
        workspace: path.join(temp, "workspace"),
        ...options,
      });
      next.setOrigin(origin);
      server.removeAllListeners("request");
      server.on("request", next.handler);
    },
  };
}

test("local host rejects foreign origins, arbitrary paths and raw diagnostics", async (t) => {
  const { origin, call } = await host(t);
  const boot = await call("/bootstrap");
  assert.equal(boot.presets.length, 6);
  assert.equal(boot.generationMode, "host-exchange");
  const foreign = await fetch(`${origin}/api/projects`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://example.com",
    },
    body: "{}",
  });
  assert.equal(foreign.status, 403);
  assert.equal((await foreign.json()).error, "LOCAL_ORIGIN_REQUIRED");
  const missingOrigin = await fetch(`${origin}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(missingOrigin.status, 403);
  const diagnostics = await call("/projects/unknown", undefined, 404);
  assert.equal(diagnostics.error, "PROJECT_UNKNOWN");
  assert.ok(!JSON.stringify(diagnostics).includes(os.tmpdir()));
  await call("/projects", { name: "Unsafe", path: "Z:/private" }, 400);
  const noFiles = await fetch(`${origin}/api/files?path=project.json`);
  assert.equal(noFiles.status, 404);
});

test("an ungenerated panel is never labelled as a project anchor", async (t) => {
  const { call, configured } = await host(t);
  const id = await configured();
  const project = await call(`/projects/${id}`);
  assert.equal(project.anchor, null);
  assert.equal(project.panels[0].isAnchor, false);
});

test("adapter setup failure does not consume an authorized plan", async (t) => {
  let calls = 0,
    unavailable = true;
  const { call, configured, workspace } = await host(t, {
    adapter: {
      metadata: {
        name: "Codex CLI",
        model: "gpt-6-luna",
        effort: "xhigh",
        secret: "must-not-publish",
      },
      preflight: async () => {
        if (unavailable) throw new Error("CODEX_CHATGPT_LOGIN_REQUIRED");
      },
      generate: async () => {
        calls++;
        return syntheticImage(960, 800);
      },
    },
  });
  const id = await configured(),
    plan = await call(`/projects/${id}/plan`, { panelId: "main-menu" });
  const route = `/projects/${id}/runs/${plan.run.slice(5)}`;
  await call(`${route}/authorize`, {
    planSha256: plan.planSha256,
    approval: "Synthetic decision.",
  });
  const boot = await call("/bootstrap");
  assert.equal(boot.generation.ready, false);
  assert.equal(boot.generation.secret, undefined);
  await call(`${route}/generate`, {}, 400);
  assert.equal((await call(route)).state.status, "authorized");
  assert.equal(
    fs.existsSync(local(workspace, `projects/${id}/${plan.run}/attempt.json`)),
    false,
  );
  assert.equal(calls, 0);
  unavailable = false;
  await call(`${route}/generate`, {});
  assert.equal(calls, 1);
});

test("an undispatched exchange requires explicit confirmation and can reach an adapter only once", async (t) => {
  let calls = 0;
  let submittedInput;
  const { call, configured } = await host(t, {
    adapter: {
      generate: async (input) => {
        submittedInput = input;
        calls++;
        return syntheticImage(960, 800);
      },
    },
  });
  const id = await configured(),
    plan = await call(`/projects/${id}/plan`, { panelId: "main-menu" });
  const route = `/projects/${id}/runs/${plan.run.slice(5)}`;
  await call(`${route}/authorize`, {
    planSha256: plan.planSha256,
    approval: "Synthetic exchange decision.",
  });
  const reserved = await call(`${route}/request`, {});
  await call(
    `${route}/dispatch-reserved`,
    { requestSha256: reserved.requestSha256, notSubmitted: false },
    400,
  );
  await call(
    `${route}/dispatch-reserved`,
    { requestSha256: "0".repeat(64), notSubmitted: true },
    400,
  );
  assert.equal(calls, 0);
  await call(`${route}/dispatch-reserved`, {
    requestSha256: reserved.requestSha256,
    notSubmitted: true,
  });
  assert.equal(calls, 1);
  assert.equal(submittedInput.attemptSha256, plan.planSha256);
  assert.equal((await call(route)).execution.dispatched, true);
  await call(
    `${route}/dispatch-reserved`,
    { requestSha256: reserved.requestSha256, notSubmitted: true },
    400,
  );
  assert.equal(calls, 1);
});

test("public template previews show saved visible copy without creating projects or invoking generation", async (t) => {
  let calls = 0;
  const { call, origin, workspace } = await host(t, {
    adapter: {
      generate: async () => {
        calls++;
        throw new Error("UNEXPECTED_COMPUTE");
      },
    },
  });
  const before = fs.readdirSync(workspace, { recursive: true });
  const boot = await call("/bootstrap");
  const previews = new Map();
  assert.equal(boot.templates.length, 8);
  assert.equal(new Set(boot.templates.map((item) => item.group)).size, 5);
  for (const template of boot.templates) {
    const response = await fetch(`${origin}${template.image}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/svg+xml");
    assert.equal(template.width, 960);
    assert.equal(template.height, 800);
    const svg = await response.text();
    assert.match(svg, /viewBox="0 0 960 800"/);
    assert.ok(!svg.includes("<script") && !svg.includes("<foreignObject"));
    previews.set(template.id, svg);
  }
  assert.match(previews.get("sdk-ready"), /开始/);
  assert.match(previews.get("sdk-settings"), /体感倾斜/);
  assert.match(previews.get("sdk-settings"), /简体中文/);
  assert.equal(previews.get("sdk-settings").match(/>设置<\/text>/g)?.length, 1);
  for (const id of ["sdk-loading", "sdk-loading-failed"])
    assert.match(previews.get(id), new RegExp(`data-node="${id}\\.panel"`));
  assert.doesNotMatch(
    previews.get("sdk-settings"),
    /主音量|画面质量|保存设置|恢复默认|<circle[^>]*r="10"/,
  );
  assert.doesNotMatch(previews.get("sdk-pause-online"), /菜单/);
  assert.match(previews.get("sdk-pause-local"), /菜单/);
  assert.match(previews.get("sdk-result-complete"), /12,800/);
  assert.match(previews.get("sdk-result-complete"), /92 秒/);
  assert.match(previews.get("sdk-result-failed"), /未通关/);
  assert.match(previews.get("sdk-result-failed"), /再来一局/);
  assert.match(previews.get("sdk-loading"), /60%/);
  assert.doesNotMatch(previews.get("sdk-loading"), /重试|返回|<circle/);
  assert.match(previews.get("sdk-loading-failed"), /场景资源加载失败/);
  assert.match(previews.get("sdk-loading-failed"), /返回/);
  await call("/templates/unknown/image", undefined, 404);
  assert.deepEqual(fs.readdirSync(workspace, { recursive: true }), before);
  assert.equal((await call("/bootstrap")).projects.length, 0);
  assert.equal(calls, 0);
});

test("all SDK examples import their compiled structure and freeze a plan without submitting compute", async (t) => {
  let calls = 0;
  const { call, configured, workspace, restart } = await host(t, {
    adapter: {
      generate: async () => {
        calls++;
        throw new Error("UNEXPECTED_COMPUTE");
      },
    },
  });
  const id = await configured(),
    before = await call(`/projects/${id}`),
    templates = (await call("/bootstrap")).templates;
  for (const template of templates) {
    const imported = await call(`/projects/${id}/import`, {
      template: template.id,
    });
    assert.equal(imported.panelId, template.id);
    const source = templateInput(template.id),
      plan = await call(`/projects/${id}/plan`, { panelId: template.id });
    assert.equal(
      api.verifyPlan(local(workspace, `projects/${id}`), plan.run).panelId,
      source.spec.id,
    );
    assert.equal(plan.styleSha256, before.activeStyle);
    const prompt = plan.request.prompt;
    if (template.id === "sdk-loading-failed") {
      assert.match(prompt, /场景资源加载失败/);
      assert.doesNotMatch(prompt, /正在准备图片/);
    }
    if (template.id === "sdk-loading" || template.id === "sdk-loading-failed")
      assert.match(prompt, /\.spinner/);
    function visit(node) {
      for (const copy of [node.props?.label, node.props?.text].filter(
        Boolean,
      )) {
        assert.ok(
          prompt.includes(copy),
          `${template.id}: ${copy} must survive into frozen input`,
        );
      }
      for (const child of node.children ?? []) visit(child);
    }
    if (source.spec.document) visit(source.spec.document.root);
    else {
      for (const section of source.spec.sections)
        for (const row of section.rows)
          for (const copy of [row.label, row.buttonLabel, row.text].filter(
            Boolean,
          ))
            assert.ok(
              prompt.includes(copy),
              `${template.id}: ${copy} must survive into frozen input`,
            );
      assert.match(prompt, /Switch/);
    }
    assert.equal(
      fs.existsSync(
        local(workspace, `projects/${id}/${plan.run}/attempt.json`),
      ),
      false,
    );
  }
  restart();
  const after = await call(`/projects/${id}`);
  assert.equal(after.panels.length, before.panels.length + templates.length);
  assert.equal(after.activeStyle, before.activeStyle);
  for (const template of templates.filter((item) =>
    ["pause", "result", "loading"].includes(item.group),
  )) {
    const panel = after.panels.find((item) => item.panelId === template.id);
    assert.equal(panel.title, template.name);
    const stored = loadPrototype(
      local(workspace, `projects/${id}`),
      loadProject(local(workspace, `projects/${id}`)).panels[template.id]
        .prototype,
    );
    assert.equal(stored.title, templateInput(template.id).spec.title);
  }
  assert.deepEqual(
    after.panels.find((item) => item.panelId === "main-menu"),
    before.panels[0],
  );
  assert.equal(calls, 0);
});

test("trash and restore preserve every project and export byte, reject archived access and retain accepted identity", async (t) => {
  const { call, configured, workspace, origin } = await host(t);
  const id = await configured();
  const plan = await call(`/projects/${id}/plan`, { panelId: "main-menu" });
  const route = `/projects/${id}/runs/${plan.run.slice(5)}`;
  await call(`${route}/authorize`, {
    planSha256: plan.planSha256,
    approval: "Synthetic single-use decision.",
  });
  const reserved = await call(`${route}/request`, {});
  const result = await call(`${route}/receive`, {
    requestSha256: reserved.requestSha256,
    image: syntheticImage(960, 800).toString("base64"),
  });
  await call(`${route}/review`, {
    imageSha256: result.imageSha256,
    layout: "pass",
    style: "pass",
    copy: "pass",
    decision: "accept",
    note: "Synthetic recovery fixture.",
    useAsAnchor: true,
  });
  const before = await call(`/projects/${id}`);
  const exported = await call(`/projects/${id}/export`, {});
  function snapshot(directory, relative = "") {
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((entry) => {
        const name = `${relative}${entry.name}`;
        const file = local(directory, entry.name);
        return entry.isDirectory()
          ? snapshot(file, `${name}/`)
          : [[name, sha256(fs.readFileSync(file))]];
      });
  }
  const projectDirectory = local(workspace, `projects/${id}`);
  const exportDirectory = local(workspace, `exports/${id}`);
  const originalProject = snapshot(projectDirectory),
    originalExports = snapshot(exportDirectory);
  await call(`/projects/${id}/trash`, {});
  const boot = await call("/bootstrap");
  assert.equal(boot.projects.length, 0);
  assert.equal(boot.trash[0].id, id);
  await call(`/projects/${id}/trash`, {});
  assert.equal(
    (await call("/bootstrap")).trash[0].deletedAt,
    boot.trash[0].deletedAt,
  );
  assert.equal(
    (await call(`/projects/${id}`, undefined, 410)).error,
    "PROJECT_TRASHED",
  );
  await call(`${route}/request`, {}, 410);
  await call(`/projects/${id}/plan`, { panelId: "main-menu" }, 410);
  assert.equal((await fetch(`${origin}${before.anchor.image}`)).status, 410);
  assert.equal((await fetch(`${origin}${exported.download}`)).status, 410);
  assert.deepEqual(snapshot(projectDirectory), originalProject);
  assert.deepEqual(snapshot(exportDirectory), originalExports);
  await call(`/projects/${id}/restore`, {});
  await call(`/projects/${id}/restore`, {});
  assert.deepEqual(await call(`/projects/${id}`), before);
  assert.equal((await call("/bootstrap")).trash.length, 0);
  assert.deepEqual(snapshot(projectDirectory), originalProject);
  assert.deepEqual(snapshot(exportDirectory), originalExports);
  assert.equal((await fetch(`${origin}${exported.download}`)).status, 200);
  await call(`${route}/request`, {}, 400);
});

test("deleting the last or same-named project persists across host restart and restores only that identity", async (t) => {
  const first = await host(t);
  const a = await first.call("/projects", { name: "Same name" }, 201);
  const b = await first.call("/projects", { name: "Same name" }, 201);
  await first.call(`/projects/${a.id}/trash`, {});
  assert.deepEqual(
    (await first.call("/bootstrap")).projects.map((p) => p.id),
    [b.id],
  );
  await first.call(`/projects/${b.id}/trash`, {});
  const second = await host(t, { workspace: first.workspace });
  const boot = await second.call("/bootstrap");
  assert.equal(boot.projects.length, 0);
  assert.equal(boot.trash.length, 2);
  await second.call(`/projects/${a.id}/restore`, {});
  const restored = await second.call("/bootstrap");
  assert.deepEqual(
    restored.projects.map((p) => p.id),
    [a.id],
  );
  assert.deepEqual(
    restored.trash.map((p) => p.id),
    [b.id],
  );
  await second.call("/projects/unknown/trash", {}, 404);
  await second.call(`/projects/${a.id}/trash`, { path: "Z:/private" }, 400);
});

test("new-project style previews stay unpublished when abandoned and only explicit final confirmation creates one project", async (t) => {
  let computeCalls = 0;
  const { call, workspace, origin } = await host(t, {
    adapter: {
      generate: async () => {
        computeCalls++;
        throw new Error("must not generate");
      },
    },
  });
  const image = syntheticImage(160, 100);
  const abandoned = await call("/project-drafts", {
    name: "Cancelled creation",
    style: { preset: "concept-art", reference: image.toString("base64") },
  });
  assert.equal((await call("/bootstrap")).projects.length, 0);
  assert.equal(
    fs.existsSync(local(workspace, `projects/${abandoned.id}`)),
    false,
  );
  await call(`/projects/${abandoned.id}`, undefined, 404);
  await call(`/projects/${abandoned.id}/plan`, { panelId: "main-menu" }, 404);
  const preview = await fetch(
    `${origin}/api/project-drafts/${abandoned.id}/image`,
  );
  assert.equal(preview.status, 200);
  assert.ok(Buffer.from(await preview.arrayBuffer()).equals(image));
  const next = await call("/project-drafts", {
    name: "Confirmed creation",
    style: { preset: "pixel-cartoon" },
  });
  const commit = {
    name: "Confirmed creation",
    draftId: next.id,
    styleSha256: next.style.sha256,
    approval: "Synthetic final project and style decision.",
  };
  await call(
    "/projects",
    { ...commit, styleSha256: abandoned.style.sha256 },
    400,
  );
  await call("/projects", { ...commit, name: "Another project name" }, 400);
  await call(
    "/projects",
    { name: commit.name, draftId: next.id, styleSha256: next.style.sha256 },
    400,
  );
  assert.equal((await call("/bootstrap")).projects.length, 0);
  const created = await call("/projects", commit, 201);
  assert.equal(created.id, next.id);
  assert.equal(created.activeStyle, next.style.sha256);
  assert.equal((await call("/bootstrap")).projects.length, 1);
  const repeated = await call("/projects", commit, 201);
  assert.equal(repeated.id, next.id);
  assert.equal((await call("/bootstrap")).projects.length, 1);
  const directory = local(workspace, `projects/${next.id}`);
  assert.equal(fs.readdirSync(local(directory, "activations")).length, 1);
  assert.equal(fs.existsSync(local(workspace, `drafts/${next.id}`)), false);
  assert.equal(
    fs.existsSync(local(workspace, `projects/${abandoned.id}`)),
    false,
  );
  assert.equal(computeCalls, 0);
});

test("project drafts, prototype import and plan preparation never authorize or generate media", async (t) => {
  let calls = 0;
  const { call, configured, workspace } = await host(t, {
    adapter: {
      generate: async () => {
        calls++;
        return syntheticImage(960, 800);
      },
    },
  });
  const id = await configured(),
    root = local(workspace, `projects/${id}`);
  const value = await call(`/projects/${id}`);
  assert.equal(value.panels.length, 1);
  assert.equal(value.activeStyle, value.style.sha256);
  const plan = await call(`/projects/${id}/plan`, {
    panelId: "main-menu",
    note: "Synthetic test emphasis.",
  });
  assert.equal(plan.maximumCalls, 1);
  assert.deepEqual(fs.readdirSync(local(root, plan.run)), ["plan.json"]);
  await call(`/projects/${id}/runs/${plan.run.slice(5)}/generate`, {}, 400);
  await call(`/projects/${id}/runs/${plan.run.slice(5)}/request`, {}, 400);
  await call(`/projects/${id}/plan-project`, {}, 400);
  assert.equal(calls, 0);
});

test("manual exchange preserves one reservation, requires explicit review and exports only the accepted project set", async (t) => {
  const { origin, call, configured, workspace } = await host(t);
  const id = await configured("幻想冒险：UI / 展示");
  const first = await call(`/projects/${id}/plan`, { panelId: "main-menu" }),
    route = `/projects/${id}/runs/${first.run.slice(5)}`;
  await call(
    `${route}/authorize`,
    { planSha256: "0".repeat(64), approval: "Wrong synthetic digest." },
    400,
  );
  await call(`${route}/authorize`, {
    planSha256: first.planSha256,
    approval: "Synthetic one-call decision.",
  });
  const reserved = await call(`${route}/request`, {});
  await call(`${route}/request`, {}, 400);
  const zip = await fetch(`${origin}/api${route}/exchange`);
  assert.equal(zip.status, 200);
  assert.equal(zip.headers.get("content-type"), "application/zip");
  assert.equal(Buffer.from(await zip.arrayBuffer()).readUInt32LE(), 0x04034b50);
  const input = await fetch(`${origin}/api${route}/input?index=0`);
  assert.equal(input.status, 200);
  assert.equal(input.headers.get("content-type"), "image/png");
  const generated = await call(`${route}/receive`, {
    requestSha256: reserved.requestSha256,
    image: syntheticImage(960, 800).toString("base64"),
  });
  await call(`/projects/${id}/export`, {}, 400);
  await call(`${route}/review`, {
    imageSha256: generated.imageSha256,
    layout: "pass",
    style: "pass",
    copy: "pass",
    decision: "accept",
    note: "Synthetic reference acceptance.",
    useAsAnchor: true,
  });
  await call(`/projects/${id}/import`, { template: "exit-confirm" });
  const batch = await call(`/projects/${id}/plan-project`, {});
  assert.equal(batch.maximumCalls, 1);
  assert.equal(batch.anchor.imageSha256, generated.imageSha256);
  await call(`/projects/${id}/export`, {}, 400);
  const second = batch.plans[0],
    nextRoute = `/projects/${id}/runs/${second.run.slice(5)}`;
  await call(`${nextRoute}/authorize`, {
    planSha256: second.planSha256,
    approval: "Synthetic second-plan decision.",
  });
  const nextRequest = await call(`${nextRoute}/request`, {});
  const nextImage = await call(`${nextRoute}/receive`, {
    requestSha256: nextRequest.requestSha256,
    image: syntheticImage(960, 800).toString("base64"),
  });
  await call(`${nextRoute}/review`, {
    imageSha256: nextImage.imageSha256,
    layout: "pass",
    style: "pass",
    copy: "pass",
    decision: "accept",
    note: "Synthetic second-panel acceptance.",
  });
  const exported = await call(`/projects/${id}/export`, {}),
    downloaded = await fetch(`${origin}${exported.download}`);
  assert.equal(downloaded.status, 200);
  assert.equal(exported.panelIds.length, 2);
  assert.equal(exported.format, "images");
  const downloadFilename = (response) =>
    decodeURIComponent(
      response.headers.get("content-disposition").split("UTF-8''")[1],
    );
  assert.equal(
    downloadFilename(downloaded),
    "幻想冒险：UI _ 展示-reference-images.zip",
  );
  const images = readImageZip(Buffer.from(await downloaded.arrayBuffer()));
  assert.deepEqual([...images.keys()].sort(), ["游戏大厅.png", "退出确认.png"]);
  assert.ok(
    [...images.values()].every((bytes) =>
      bytes.equals(syntheticImage(960, 800)),
    ),
  );
  const directory = local(workspace, `exports/${id}/${exported.exportId}`);
  assert.equal(api.validateDelivery(directory).status, "valid");
  const complete = await call(`/projects/${id}/export`, { format: "complete" });
  assert.equal(complete.format, "complete");
  const fullZip = await fetch(`${origin}${complete.download}`);
  assert.equal(downloadFilename(fullZip), "幻想冒险：UI _ 展示-references.zip");
  assert.deepEqual(
    Buffer.from(await fullZip.arrayBuffer()),
    fs.readFileSync(
      local(workspace, `exports/${id}/${complete.exportId}/references.zip`),
    ),
  );
  const legacy = await fetch(`${origin}${complete.download.split("?")[0]}`);
  assert.equal(downloadFilename(legacy), "幻想冒险：UI _ 展示-references.zip");
  assert.deepEqual(
    Buffer.from(await legacy.arrayBuffer()),
    fs.readFileSync(local(directory, "references.zip")),
  );
  await call(`/projects/${id}/export`, { format: "unknown" }, 400);
  const damaged = local(directory, "panels/main-menu/reference.png");
  const original = fs.readFileSync(damaged);
  fs.writeFileSync(damaged, Buffer.from("tampered synthetic output"));
  assert.equal((await fetch(`${origin}${exported.download}`)).status, 400);
  fs.writeFileSync(damaged, original);
  const project = await call(`/projects/${id}`);
  assert.ok(
    project.panels.every((panel) => panel.status === "accepted_current_style"),
  );
  const noOp = await call(`/projects/${id}/plan-project`, {});
  assert.equal(noOp.status, "nothing_to_plan");
});

test("adapter failure is terminal and cannot be resubmitted by the browser", async (t) => {
  let calls = 0;
  const { call, configured } = await host(t, {
    adapter: {
      generate: async () => {
        calls++;
        throw new Error("private endpoint and credentials");
      },
    },
  });
  const id = await configured(),
    plan = await call(`/projects/${id}/plan`, { panelId: "main-menu" }),
    route = `/projects/${id}/runs/${plan.run.slice(5)}`;
  await call(`${route}/authorize`, {
    planSha256: plan.planSha256,
    approval: "Synthetic failure-path decision.",
  });
  const failed = await call(`${route}/generate`, {}, 400);
  assert.equal(failed.error, "ADAPTER_INDETERMINATE_NO_RESUBMIT");
  await call(`${route}/generate`, {}, 400);
  assert.equal(calls, 1);
  assert.equal((await call(route)).state.status, "indeterminate");
});

test("a supplied showcase is read-only, while its accepted reference assets remain viewable", async (t) => {
  const first = await host(t),
    id = await first.configured(),
    projectRoot = local(first.workspace, `projects/${id}`);
  const { call, origin } = await host(t, { showcaseProject: projectRoot });
  const boot = await call("/bootstrap");
  assert.equal(boot.projects[0].readOnly, true);
  const project = await call("/projects/showcase");
  assert.equal(project.name, "概念图示例");
  const image = await fetch(`${origin}${project.panels[0].prototypeImage}`);
  assert.equal(image.status, 200);
  await call("/projects/showcase/import", { template: "exit-confirm" }, 403);
  await call("/projects/showcase/style-draft", { preset: "concept-art" }, 403);
  await call("/projects/showcase/trash", {}, 403);
  await call("/projects/showcase/restore", {}, 403);
  await call("/projects/showcase/panels/main-menu/trash", {}, 403);
  await call("/projects/showcase/panels/main-menu/restore", {}, 403);
  const unchanged = readJson(local(projectRoot, "project.json"));
  assert.equal(Object.keys(unchanged.panels).length, 1);
});

test("custom uploaded pack and primary PNG preserve their exact original bytes without activating themselves", async (t) => {
  const { call, configured, workspace, origin } = await host(t),
    id = await configured();
  const before = await call(`/projects/${id}`),
    pack = structuredClone(builtinPack("concept-art"));
  pack.metadata = {
    id: "uploaded-ui-pack",
    name: "Synthetic custom UI",
    version: "1.0.0",
  };
  pack.references = { primary: "art/primary.png" };
  const packBytes = Buffer.from("  \n" + JSON.stringify(pack, null, 4) + "\n"),
    image = syntheticImage(160, 100);
  const draft = await call(`/projects/${id}/style-draft`, {
    packFile: packBytes.toString("base64"),
    reference: image.toString("base64"),
    notes: "Synthetic import only.",
  });
  assert.equal(draft.source.kind, "custom");
  assert.equal(draft.source.pack.sha256, sha256(packBytes));
  assert.equal(draft.references[0].artifact.sha256, sha256(image));
  const projectRoot = local(workspace, `projects/${id}`);
  assert.ok(verifyBlob(projectRoot, draft.source.pack).equals(packBytes));
  assert.equal((await call(`/projects/${id}`)).activeStyle, before.activeStyle);
  const preview = await fetch(
    `${origin}/api/projects/${id}/image?kind=style&style=${draft.sha256}`,
  );
  assert.ok(Buffer.from(await preview.arrayBuffer()).equals(image));
  pack.references.primary = "reference.png";
  const rootNamedBytes = Buffer.from(JSON.stringify(pack, null, 2));
  const rootNamed = await call(`/projects/${id}/style-draft`, {
    packFile: rootNamedBytes.toString("base64"),
    reference: image.toString("base64"),
  });
  assert.equal(rootNamed.source.pack.sha256, sha256(rootNamedBytes));
  assert.equal(rootNamed.references[0].artifact.sha256, sha256(image));
});

test("one unreadable project is disclosed without blocking valid projects or startup", async (t) => {
  const { call, configured, workspace } = await host(t);
  const healthy = await configured(),
    bad = await call("/projects", { name: "Broken synthetic fixture" }, 201);
  fs.writeFileSync(
    local(workspace, `projects/${bad.id}/project.json`),
    "{broken",
  );
  const boot = await call("/bootstrap");
  assert.equal(boot.projects.find((p) => p.id === healthy).error, undefined);
  assert.equal(
    boot.projects.find((p) => p.id === bad.id).error,
    "JSON_READ_FAILED",
  );
  await call(`/projects/${bad.id}`, undefined, 400);
  const secondStudio = createStudio({ workspace });
  assert.equal(secondStudio.preload().length, 2);
  await call(`/projects/${bad.id}/trash`, {});
  assert.equal((await call("/bootstrap")).projects.length, 1);
  await call(`/projects/${bad.id}/restore`, {});
  assert.equal(
    (await call("/bootstrap")).projects.find((p) => p.id === bad.id).error,
    "JSON_READ_FAILED",
  );
});

test("concurrent generation requests reserve once and reach only one provider double", async (t) => {
  let release,
    began,
    calls = 0;
  const gate = new Promise((resolve) => {
      release = resolve;
    }),
    started = new Promise((resolve) => {
      began = resolve;
    });
  const { call, configured } = await host(t, {
    adapter: {
      generate: async () => {
        calls++;
        began();
        await gate;
        return syntheticImage(960, 800);
      },
    },
  });
  const id = await configured(),
    plan = await call(`/projects/${id}/plan`, { panelId: "main-menu" }),
    route = `/projects/${id}/runs/${plan.run.slice(5)}`;
  await call(`${route}/authorize`, {
    planSha256: plan.planSha256,
    approval: "Synthetic concurrency decision.",
  });
  const first = call(`${route}/generate`, {});
  await started;
  try {
    await call(`${route}/generate`, {}, 400);
    assert.equal(calls, 1);
    const blocked = await call(`/projects/${id}/trash`, {}, 400);
    assert.equal(blocked.error, "PROJECT_BUSY");
    assert.equal((await call("/bootstrap")).trash.length, 0);
  } finally {
    release();
  }
  assert.equal((await first).status, "pending_visual_review");
});

test("optimizing an anchor panel preserves the fixed anchor and exports only its accepted version", async (t) => {
  const { call, configured, workspace, origin } = await host(t),
    id = await configured();
  async function generate(width, height) {
    const plan = await call(`/projects/${id}/plan`, { panelId: "main-menu" }),
      route = `/projects/${id}/runs/${plan.run.slice(5)}`;
    await call(`${route}/authorize`, {
      planSha256: plan.planSha256,
      approval: "Synthetic reference decision.",
    });
    const reserved = await call(`${route}/request`, {});
    const result = await call(`${route}/receive`, {
      requestSha256: reserved.requestSha256,
      image: syntheticImage(width, height).toString("base64"),
    });
    return { plan, route, result };
  }
  const first = await generate(960, 800);
  await call(`${first.route}/review`, {
    imageSha256: first.result.imageSha256,
    layout: "pass",
    style: "pass",
    copy: "pass",
    decision: "accept",
    note: "Synthetic anchor acceptance.",
    useAsAnchor: true,
  });
  const second = await generate(1200, 1000),
    project = await call(`/projects/${id}`);
  assert.equal(project.anchor.run, first.plan.run);
  assert.equal(project.anchor.imageSha256, first.result.imageSha256);
  assert.equal(project.panels[0].displayRun, second.plan.run);
  assert.equal(project.panels[0].displayImageSha256, second.result.imageSha256);
  assert.equal(project.panels[0].isAnchor, false);
  const anchor = await fetch(`${origin}${project.anchor.image}`);
  assert.equal(
    sha256(Buffer.from(await anchor.arrayBuffer())),
    first.result.imageSha256,
  );
  const exported = await call(`/projects/${id}/export`, {}),
    output = local(workspace, `exports/${id}/${exported.exportId}`);
  const imageDownload = await fetch(`${origin}${exported.download}`);
  const images = readImageZip(Buffer.from(await imageDownload.arrayBuffer()));
  assert.equal(sha256([...images.values()][0]), first.result.imageSha256);
  assert.equal(
    readJson(local(output, "panels/main-menu/provenance.json")).imageSha256,
    first.result.imageSha256,
  );
  await call(`${second.route}/review`, {
    imageSha256: second.result.imageSha256,
    layout: "pass",
    style: "pass",
    copy: "pass",
    decision: "accept",
    note: "Synthetic optimized image acceptance.",
  });
  const accepted = await call(`/projects/${id}`);
  assert.equal(accepted.panels[0].acceptedRun, second.plan.run);
  assert.equal(accepted.anchor.imageSha256, first.result.imageSha256);
});

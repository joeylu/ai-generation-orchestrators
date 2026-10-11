import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import * as api from "../src/index.mjs";
import { verifyResult } from "../src/generation.mjs";
import {
  exact,
  isDigest,
  isId,
  local,
  readJson,
  requireThat,
  textValue,
  verifyBlob,
  withLock,
  writeJsonNew,
} from "../src/common.mjs";

const spec = fileURLToPath(
  new URL("../examples/style-showcase.panel.json", import.meta.url),
);
const catalog = fileURLToPath(
  new URL(
    "../../ui-panel-harness/examples/modern-controls.catalog.json",
    import.meta.url,
  ),
);

// Full standalone snapshots allow replacing the sample without retaining a
// references.primary filename or reintroducing inherited negative rules.
function snapshot(style) {
  requireThat(
    style.kind === "ui_reference_style_v2",
    "STYLE_PREVIEW_SOURCE_UNSUPPORTED",
  );
  const { metadata, render_style, ui_rules, palette, negative_rules, origin } =
    style.pack;
  return {
    kind: "ui_reference_style_pack_v1",
    metadata,
    render_style,
    ui_rules,
    palette,
    negative_rules,
    ...(origin ? { origin } : {}),
  };
}

export function stylePreviews({ workspace, adapter }) {
  const active = new Set();
  function location(scope, id, operationId) {
    requireThat(
      ["projects", "project-drafts"].includes(scope) &&
        isId(id) &&
        /^[a-f0-9-]{36}$/.test(operationId),
      "STYLE_PREVIEW_ID_INVALID",
    );
    const relative = `style-previews/${scope}/${id}/${operationId}`;
    return { relative, directory: local(workspace, `${relative}/project`) };
  }
  function record(scope, id, operationId) {
    const target = location(scope, id, operationId);
    const value = readJson(local(workspace, `${target.relative}/record.json`));
    exact(value, [
      "baseStyleSha256",
      "operationId",
      "created",
      "run",
      "planSha256",
    ]);
    requireThat(
      value.operationId === operationId &&
        isDigest(value.baseStyleSha256) &&
        /^runs\/[a-f0-9-]{36}$/.test(value.run) &&
        isDigest(value.planSha256),
      "STYLE_PREVIEW_RECORD_INVALID",
    );
    // Reading/adopting verified output is not another generation attempt.
    const plan = api.verifyPlan(target.directory, value.run, {
      allowLegacy: true,
    });
    requireThat(
      plan.sha256 === value.planSha256 &&
        plan.projectId === `preview-${operationId}` &&
        plan.panelId === "style-showcase",
      "STYLE_PREVIEW_RECORD_INVALID",
    );
    return { ...target, value };
  }
  function read(scope, id, operationId) {
    const { relative, directory, value } = record(scope, id, operationId);
    const state = api.inspectRun(directory, value.run);
    const running =
      active.has(relative) &&
      ![
        "pending_visual_review",
        "accepted",
        "indeterminate",
        "failed",
        "rejected_technical",
      ].includes(state.status);
    const imageSha256 = ["pending_visual_review", "accepted"].includes(
      state.status,
    )
      ? verifyResult(directory, value.run).technical.imageSha256
      : null;
    return {
      operationId,
      baseStyleSha256: value.baseStyleSha256,
      planSha256: value.planSha256,
      status: state.status,
      active: running,
      imageSha256,
      created: value.created,
      interrupted:
        !running &&
        [
          "authorized",
          "awaiting_authorization",
          "reserved_no_resubmit",
          "raw_received_needs_finish",
        ].includes(state.status),
      image: imageSha256
        ? `/api/${scope}/${id}/style-preview/${operationId}/image`
        : null,
    };
  }
  function image(scope, id, operationId) {
    const { directory, value } = record(scope, id, operationId);
    return verifyResult(directory, value.run).reference;
  }
  async function generate(scope, id, source, payload) {
    exact(payload, ["styleSha256", "operationId", "approval"]);
    textValue(payload.approval, 2000);
    const target = location(scope, id, payload.operationId);
    const base = api.loadStyle(source, payload.styleSha256);
    snapshot(base);
    if (fs.existsSync(local(workspace, `${target.relative}/record.json`))) {
      const previous = read(scope, id, payload.operationId);
      requireThat(
        previous.baseStyleSha256 === base.sha256,
        "STYLE_PREVIEW_STYLE_MISMATCH",
      );
      return previous;
    }
    requireThat(
      adapter && typeof adapter.generate === "function",
      "GENERATION_ADAPTER_NOT_CONFIGURED",
    );
    requireThat(
      ![...active].some((key) =>
        key.startsWith(`style-previews/${scope}/${id}/`),
      ),
      "PROJECT_BUSY",
    );
    // Exclusive directory claims the click across processes and restarts.
    fs.mkdirSync(local(workspace, `style-previews/${scope}/${id}`), {
      recursive: true,
    });
    try {
      fs.mkdirSync(local(workspace, target.relative));
    } catch {
      throw new Error("STYLE_PREVIEW_ALREADY_STARTED");
    }
    active.add(target.relative);
    try {
      await adapter.preflight?.();
      api.initialize(target.directory, `preview-${payload.operationId}`);
      writeJsonNew(target.directory, "base-pack.json", snapshot(base));
      const style = api.createStyle(target.directory, {
        pack: local(target.directory, "base-pack.json"),
        notes: base.notes,
        reference: base.references[0]
          ? local(source, base.references[0].artifact.path)
          : null,
      });
      // This click approves the displayed rules for an isolated preview only.
      api.activateStyle(target.directory, style.sha256, payload.approval);
      await api.addPanel(target.directory, { spec, catalog });
      const plan = api.createPlan(target.directory, {
        panelId: "style-showcase",
        resolution: "native",
      });
      writeJsonNew(workspace, `${target.relative}/record.json`, {
        baseStyleSha256: base.sha256,
        operationId: payload.operationId,
        created: new Date().toISOString(),
        run: plan.run,
        planSha256: plan.planSha256,
      });
      api.authorize(
        target.directory,
        plan.run,
        plan.planSha256,
        payload.approval,
      );
      await api.generateWithAdapter(target.directory, plan.run, {
        generate: (input) =>
          adapter.generate({ ...input, attemptSha256: plan.planSha256 }),
      });
      return read(scope, id, payload.operationId);
    } finally {
      active.delete(target.relative);
    }
  }
  function adopt(scope, id, source, styleSha256, preview, approval) {
    exact(preview, ["operationId", "imageSha256"]);
    const { directory, value } = record(scope, id, preview.operationId);
    requireThat(
      value.baseStyleSha256 === styleSha256,
      "STYLE_PREVIEW_STYLE_MISMATCH",
    );
    const base = api.loadStyle(source, styleSha256),
      result = verifyResult(directory, value.run);
    requireThat(
      result.technical.imageSha256 === preview.imageSha256,
      "STYLE_PREVIEW_IMAGE_MISMATCH",
    );
    textValue(approval, 2000);
    // Final confirmation explicitly reviews the displayed image; generation alone
    // cannot accept it, change the project or establish a project anchor.
    api.reviewRun(directory, value.run, {
      imageSha256: preview.imageSha256,
      layout: "pass",
      style: "pass",
      copy: "pass",
      decision: "accept",
      note: approval,
      useAsAnchor: false,
    });
    return withLock(source, () => {
      const relative = `preview-sources/${preview.operationId}/pack.json`;
      if (!fs.existsSync(local(source, relative)))
        writeJsonNew(source, relative, snapshot(base));
      verifyBlob(source, base.source.pack);
      return api.createStyle(source, {
        pack: local(source, relative),
        reference: local(directory, `${value.run}/reference.png`),
        notes: base.notes,
      });
    });
  }
  function busy() {
    return active.size > 0;
  }
  return { generate, read, image, adopt, busy };
}

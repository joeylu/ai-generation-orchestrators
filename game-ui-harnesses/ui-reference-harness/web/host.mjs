import * as fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as api from "../src/index.mjs";
import {
  canonical,
  atomicJson,
  exact,
  isDigest,
  isId,
  jsonBytes,
  local,
  readBytes,
  readJson,
  requireThat,
  sha256,
  textValue,
  verifyBlob,
  validationScope,
  withLock,
  writeJsonNew,
  writeNew,
} from "../src/common.mjs";
import { loadProject } from "../src/project.mjs";
import { assertCurrent } from "../src/compiler.mjs";
import { loadPrototype } from "../src/panel.mjs";
import { readSampleCatalog } from "../src/sample-catalog.mjs";
import { verifyResult, verifyReview } from "../src/generation.mjs";
import { createStoredZip } from "../../ui-panel-harness/src/zip-store.mjs";
import {
  templateInput,
  templateList,
  templatePreview,
} from "./template-previews.mjs";
import { panelSessions } from "./panel-sessions.mjs";
import {
  attachmentDisposition,
  createImageExport,
  projectExportFilename,
} from "./image-export.mjs";
import { panelDisplayTitle } from "./examples/panel-names.mjs";
import { resolvedStylePack } from "./style-resolution.mjs";
import { stylePreviews } from "./style-previews.mjs";

const webRoot = fileURLToPath(new URL("./", import.meta.url));
const defaultCatalog = fileURLToPath(
  new URL(
    "../../ui-panel-harness/examples/modern-controls.catalog.json",
    import.meta.url,
  ),
);
const runPath = (id) => {
  requireThat(
    typeof id === "string" && /^[a-f0-9-]{36}$/.test(id),
    "RUN_PATH_INVALID",
  );
  return `runs/${id}`;
};
const safeError = (error) =>
  /^[A-Z][A-Z0-9_]{1,100}$/.test(error.message)
    ? error.message
    : "OPERATION_FAILED";
const assetUrl = (id, query) =>
  `/api/projects/${id}/image?${new URLSearchParams(query)}`;

async function bodyJson(req) {
  requireThat(
    req.headers["content-type"]?.split(";")[0] === "application/json",
    "JSON_CONTENT_TYPE_REQUIRED",
  );
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    requireThat(size <= 32 * 1024 * 1024, "UPLOAD_TOO_LARGE");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("JSON_BODY_INVALID");
  }
}
function uploadBytes(value, max = 20 * 1024 * 1024) {
  requireThat(
    typeof value === "string" &&
      value.length > 0 &&
      value.length % 4 === 0 &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(value),
    "UPLOAD_BASE64_INVALID",
  );
  const bytes = Buffer.from(value, "base64");
  requireThat(
    bytes.length > 0 &&
      bytes.length <= max &&
      bytes.toString("base64") === value,
    "UPLOAD_TOO_LARGE",
  );
  return bytes;
}
function send(
  res,
  status,
  value,
  type = "application/json; charset=utf-8",
  filename = null,
) {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...(filename
      ? { "Content-Disposition": attachmentDisposition(filename) }
      : {}),
  });
  res.end(type.startsWith("application/json") ? JSON.stringify(value) : value);
}

/** Loopback host adapter. All program-owned Harness records are written by core APIs. */
export function createStudio({
  workspace,
  sampleCatalog = null,
  showcaseProject = null,
  adapter = null,
} = {}) {
  requireThat(
    typeof workspace === "string" && workspace.length > 0,
    "WORKSPACE_REQUIRED",
  );
  const root = path.resolve(workspace);
  local(root, "projects");
  fs.mkdirSync(root, { recursive: true });
  const previews = stylePreviews({ workspace: root, adapter });
  const activeRuns = new Set();
  async function generationInfo() {
    if (!adapter) return null;
    const value = { name: "图片适配器", ready: true };
    for (const key of ["name", "model", "effort"])
      if (/^[A-Za-z0-9 _.-]{1,80}$/.test(adapter.metadata?.[key] ?? ""))
        value[key] = adapter.metadata[key];
    try {
      await adapter.preflight?.();
    } catch (error) {
      value.ready = false;
      value.error = safeError(error);
    }
    return value;
  }
  const dispatchPath = (id, run) => `dispatches/${id}/${run.slice(5)}.json`;
  function claimedAdapter(id, run, sessionKey = undefined) {
    return {
      generate: async (input) => {
        const attemptSha256 = api.verifyPlan(projectRoot(id), run).sha256;
        writeJsonNew(root, dispatchPath(id, run), {
          requestSha256: input.requestSha256,
          attemptSha256,
        });
        return adapter.generate({
          ...input,
          attemptSha256,
          ...(sessionKey ? { sessionKey } : {}),
        });
      },
    };
  }
  const sampleData = sampleCatalog ? readSampleCatalog(sampleCatalog) : null;
  const presets = api.presetList().map((preset, index) => ({
    ...preset,
    sample: sampleData
      ? {
          status: "accepted",
          url: `/api/presets/${preset.id}/image`,
          sha256: sampleData.catalog.entries[index].image.sha256,
        }
      : preset.sample,
  }));
  const viewCache = new Map(),
    imageRecords = new Map(),
    activeGenerations = new Map();
  let origin = null;

  function projectRoot(id, writable = false, allowTrashed = false) {
    requireThat(isId(id), "PROJECT_ID");
    if (id === "showcase" && showcaseProject) {
      requireThat(!writable, "SHOWCASE_READ_ONLY");
      return path.resolve(showcaseProject);
    }
    const directory = local(root, `projects/${id}`);
    requireThat(
      fs.existsSync(local(directory, "project.json")),
      "PROJECT_UNKNOWN",
    );
    requireThat(allowTrashed || !metadata(id).deletedAt, "PROJECT_TRASHED");
    return directory;
  }
  function metadata(id) {
    if (id === "showcase" && showcaseProject)
      return { id, name: "概念图示例", readOnly: true };
    const file = local(root, `metadata/${id}.json`);
    const meta = readJson(file);
    exact(meta, ["id", "name", "readOnly"], ["deletedAt", "deletedPanels"]);
    requireThat(
      meta.id === id && meta.readOnly === false,
      "STUDIO_METADATA_INVALID",
    );
    textValue(meta.name, 80);
    if (Object.hasOwn(meta, "deletedPanels")) {
      requireThat(
        meta.deletedPanels &&
          typeof meta.deletedPanels === "object" &&
          !Array.isArray(meta.deletedPanels),
        "STUDIO_METADATA_INVALID",
      );
      for (const [panelId, deletedAt] of Object.entries(meta.deletedPanels))
        requireThat(
          isId(panelId) &&
            typeof deletedAt === "string" &&
            Number.isFinite(Date.parse(deletedAt)) &&
            new Date(deletedAt).toISOString() === deletedAt,
          "STUDIO_METADATA_INVALID",
        );
    }
    if (Object.hasOwn(meta, "deletedAt"))
      requireThat(
        typeof meta.deletedAt === "string" &&
          Number.isFinite(Date.parse(meta.deletedAt)) &&
          new Date(meta.deletedAt).toISOString() === meta.deletedAt,
        "STUDIO_METADATA_INVALID",
      );
    return meta;
  }
  function stamp(directory) {
    const files = ["project.json"];
    const runs = local(directory, "runs");
    if (fs.existsSync(runs))
      for (const name of fs.readdirSync(runs)) {
        if (!/^[a-f0-9-]{36}$/.test(name)) continue;
        for (const file of fs.readdirSync(local(directory, `runs/${name}`)))
          if (file.endsWith(".json")) files.push(`runs/${name}/${file}`);
      }
    return canonical(
      files.map((file) => {
        const stat = fs.statSync(local(directory, file));
        return [file, stat.size, stat.mtimeMs];
      }),
    );
  }
  function recordImage(id, key, directory, relative, digest) {
    imageRecords.set(`${id}:${key}`, { directory, relative, digest });
  }
  function view(id) {
    return validationScope(() => validatedView(id));
  }
  function validatedView(id) {
    const directory = projectRoot(id),
      meta = metadata(id),
      identity = canonical([stamp(directory), meta]);
    const old = viewCache.get(id);
    if (old?.identity === identity) return old.value;
    const project = loadProject(directory),
      state = api.projectStatus(directory);
    const style = project.activeStyle
      ? api.loadStyle(directory, project.activeStyle)
      : null;
    const styleName =
      style?.pack?.metadata.name ??
      (style ? "自定义参考图风格" : "尚未选择风格");
    const baseline = project.activeStyle
      ? (project.baselines[project.activeStyle] ?? null)
      : null;
    const history = [];
    const runsDirectory = local(directory, "runs");
    if (fs.existsSync(runsDirectory))
      for (const name of fs.readdirSync(runsDirectory)) {
        if (!/^[a-f0-9-]{36}$/.test(name)) continue;
        const run = runPath(name),
          file = local(directory, `${run}/plan.json`);
        if (!fs.existsSync(file)) continue;
        const inspected = api.inspectRun(directory, run),
          plan = api.verifyPlan(directory, run, { allowLegacy: true });
        history.push({
          ...inspected,
          panelId: plan.panelId,
          prototypeSha256: plan.prototype.sha256,
          round: plan.revision?.round ?? 0,
          current:
            plan.styleSha256 === project.activeStyle &&
            project.panels[plan.panelId]?.prototype.sha256 ===
              plan.prototype.sha256,
          created: fs.statSync(file).mtimeMs,
        });
      }
    history.sort((a, b) => b.created - a.created);
    for (const item of history.filter((item) => item.imageSha256)) {
      const result = verifyResult(directory, item.run);
      recordImage(
        id,
        `run:${item.run}`,
        directory,
        `${item.run}/reference.png`,
        result.technical.imageSha256,
      );
      item.image = assetUrl(id, {
        kind: "run",
        run: item.run.slice(5),
        v: item.imageSha256,
      });
    }
    const panels = state.panels.map((panel) => {
      const prototype = loadPrototype(
        directory,
        project.panels[panel.panelId].prototype,
      );
      const latest =
        history.find((run) => run.panelId === panel.panelId && run.current) ??
        history.find((run) => run.panelId === panel.panelId) ??
        null;
      const display =
        history.find(
          (run) =>
            run.panelId === panel.panelId && run.current && run.imageSha256,
        ) ??
        (latest?.imageSha256
          ? latest
          : panel.acceptedRun
            ? history.find((run) => run.run === panel.acceptedRun)
            : null);
      recordImage(
        id,
        `layout:${panel.panelId}`,
        directory,
        prototype.layout.path,
        prototype.layout.sha256,
      );
      let image = null;
      if (display?.imageSha256) {
        const verified = verifyResult(directory, display.run);
        recordImage(
          id,
          `run:${display.run}`,
          directory,
          `${display.run}/reference.png`,
          verified.technical.imageSha256,
        );
        image = assetUrl(id, {
          kind: "run",
          run: display.run.slice(5),
          v: display.imageSha256,
        });
      }
      return {
        ...panel,
        title: panelDisplayTitle(prototype),
        canvas: prototype.canvas,
        prototypeSha256: project.panels[panel.panelId].prototype.sha256,
        history: history.filter((run) => run.panelId === panel.panelId),
        latestRun: latest,
        isAnchor: !!baseline && baseline.run === display?.run,
        displayRun: display?.run ?? null,
        displayImageSha256: display?.imageSha256 ?? null,
        image,
        prototypeImage: assetUrl(id, {
          kind: "layout",
          panel: panel.panelId,
          v: prototype.layout.sha256,
        }),
      };
    });
    let styleImage = null;
    if (style?.references.length) {
      const artifact = style.references[0].artifact;
      verifyBlob(directory, artifact);
      recordImage(
        id,
        `style:${style.sha256}`,
        directory,
        artifact.path,
        artifact.sha256,
      );
      styleImage = assetUrl(id, { kind: "style", style: style.sha256 });
    }
    let anchor = null;
    if (baseline) {
      const result = verifyResult(directory, baseline.run);
      const review = verifyReview(directory, baseline.run, result);
      verifyBlob(directory, baseline.image);
      requireThat(
        result.technical.imageSha256 === baseline.image.sha256 &&
          result.plan.sha256 === baseline.planSha256 &&
          result.plan.styleSha256 === project.activeStyle &&
          review.sha256 === baseline.reviewSha256 &&
          review.decision === "accept" &&
          review.useAsAnchor,
        "ANCHOR_ACCEPTANCE_MISMATCH",
      );
      recordImage(
        id,
        `anchor:${baseline.image.sha256}`,
        directory,
        baseline.image.path,
        baseline.image.sha256,
      );
      anchor = {
        panelId: result.plan.panelId,
        title: panelDisplayTitle(
          loadPrototype(directory, result.plan.prototype),
        ),
        run: baseline.run,
        imageSha256: baseline.image.sha256,
        image: assetUrl(id, { kind: "anchor", v: baseline.image.sha256 }),
      };
    }
    const value = {
      ...meta,
      projectId: project.id,
      activeStyle: project.activeStyle,
      styleName,
      style,
      styleImage,
      anchor,
      panels: panels.filter(
        (panel) => !Object.hasOwn(meta.deletedPanels ?? {}, panel.panelId),
      ),
      deletedPanels: panels
        .filter((panel) =>
          Object.hasOwn(meta.deletedPanels ?? {}, panel.panelId),
        )
        .map((panel) => ({
          ...panel,
          deletedAt: meta.deletedPanels[panel.panelId],
        })),
    };
    viewCache.set(id, { identity, value });
    return value;
  }
  function projects() {
    const ids = [];
    if (showcaseProject) ids.push("showcase");
    const directory = local(root, "metadata");
    if (fs.existsSync(directory))
      for (const file of fs.readdirSync(directory).sort()) {
        if (file.endsWith(".json") && isId(file.slice(0, -5)))
          ids.push(file.slice(0, -5));
      }
    return ids.flatMap((id) => {
      let project;
      try {
        if (metadata(id).deletedAt) return [];
        project = view(id);
      } catch (error) {
        let meta;
        try {
          meta = metadata(id);
        } catch {
          meta = { id, name: "无法读取的项目", readOnly: id === "showcase" };
        }
        return {
          ...meta,
          panelCount: null,
          styleName: "读取失败",
          error: safeError(error),
        };
      }
      return {
        id,
        name: project.name,
        readOnly: project.readOnly,
        panelCount: project.panels.length,
        styleName: project.styleName,
      };
    });
  }
  function trashedProjects() {
    const directory = local(root, "metadata");
    if (!fs.existsSync(directory)) return [];
    return fs
      .readdirSync(directory)
      .flatMap((file) => {
        if (!file.endsWith(".json") || !isId(file.slice(0, -5))) return [];
        try {
          const meta = metadata(file.slice(0, -5));
          return meta.deletedAt ? [meta] : [];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }
  function setTrashed(id, trashed) {
    const directory = projectRoot(id, true, true);
    requireThat(!activeGenerations.get(id), "PROJECT_BUSY");
    return withLock(root, () =>
      withLock(directory, () => {
        const meta = metadata(id);
        if (trashed) meta.deletedAt ??= new Date().toISOString();
        else delete meta.deletedAt;
        atomicJson(root, `metadata/${id}.json`, meta);
        viewCache.delete(id);
        return { id, status: trashed ? "trashed" : "restored" };
      }),
    );
  }
  function requireVisiblePanel(id, panelId) {
    requireThat(
      isId(panelId) &&
        Object.hasOwn(loadProject(projectRoot(id)).panels, panelId),
      "PANEL_UNKNOWN",
    );
    requireThat(
      !Object.hasOwn(metadata(id).deletedPanels ?? {}, panelId),
      "PANEL_TRASHED",
    );
  }
  function selectedPanels(id, requested = null) {
    const project = loadProject(projectRoot(id)),
      hidden = metadata(id).deletedPanels ?? {};
    if (requested !== null) {
      requireThat(Array.isArray(requested), "EXPORT_PANELS_INVALID");
      for (const panelId of requested) requireVisiblePanel(id, panelId);
      return requested;
    }
    // Null preserves the core's all-registered selection when nothing is hidden.
    return Object.keys(hidden).length
      ? Object.keys(project.panels).filter(
          (panelId) => !Object.hasOwn(hidden, panelId),
        )
      : null;
  }
  function setPanelTrashed(id, panelId, trashed) {
    const directory = projectRoot(id, true);
    requireThat(
      isId(panelId) && Object.hasOwn(loadProject(directory).panels, panelId),
      "PANEL_UNKNOWN",
    );
    // Workbench visibility only: do not remove core inputs/results or interrupt
    // an already reserved provider request, even while generation is in flight.
    return withLock(root, () => {
      const meta = metadata(id);
      meta.deletedPanels ??= {};
      if (trashed) meta.deletedPanels[panelId] ??= new Date().toISOString();
      else delete meta.deletedPanels[panelId];
      atomicJson(root, `metadata/${id}.json`, meta);
      viewCache.delete(id);
      return { panelId, status: trashed ? "trashed" : "restored" };
    });
  }
  function image(id, query, res) {
    const directory = projectRoot(id),
      kind = query.get("kind");
    let key;
    if (kind === "layout") {
      requireThat(isId(query.get("panel")), "PANEL_UNKNOWN");
      key = `layout:${query.get("panel")}`;
    } else if (kind === "run") key = `run:${runPath(query.get("run"))}`;
    else if (kind === "style") {
      requireThat(isDigest(query.get("style")), "STYLE_DIGEST");
      key = `style:${query.get("style")}`;
    } else if (kind === "anchor") {
      requireThat(isDigest(query.get("v")), "ANCHOR_ACCEPTANCE_MISMATCH");
      key = `anchor:${query.get("v")}`;
    } else throw new Error("IMAGE_KIND_INVALID");
    let record = imageRecords.get(`${id}:${key}`);
    if (!record && kind === "style") {
      const style = api.loadStyle(directory, query.get("style"));
      requireThat(style.references.length, "STYLE_IMAGE_MISSING");
      const artifact = style.references[0].artifact;
      recordImage(id, key, directory, artifact.path, artifact.sha256);
      record = imageRecords.get(`${id}:${key}`);
    }
    if (!record) {
      view(id);
      record = imageRecords.get(`${id}:${key}`);
    }
    requireThat(record, "IMAGE_UNKNOWN");
    const bytes = readBytes(local(record.directory, record.relative));
    requireThat(sha256(bytes) === record.digest, "IMAGE_CHECKSUM");
    send(res, 200, bytes, "image/png");
  }
  async function draftStyle(id, payload, draftDirectory = null) {
    exact(
      payload,
      [],
      [
        "preset",
        "pack",
        "packFile",
        "reference",
        "notes",
        "rules",
        "resolveNotes",
      ],
    );
    requireThat(
      payload.resolveNotes === undefined ||
        typeof payload.resolveNotes === "boolean",
      "STYLE_RESOLUTION_INVALID",
    );
    textValue(payload.notes ?? "", 8000, true);
    if (payload.resolveNotes) {
      textValue((payload.notes ?? "").trim(), 8000);
      requireThat(
        typeof adapter?.resolveStyle === "function",
        "STYLE_RESOLVER_NOT_CONFIGURED",
      );
    }
    requireThat(
      !(payload.pack && payload.packFile),
      "STYLE_PACK_SOURCE_CONFLICT",
    );
    const directory = draftDirectory ?? projectRoot(id, true),
      upload = `uploads/${randomUUID()}`;
    let reference = null,
      pack = null;
    if (payload.reference) {
      const relative = `${upload}/reference.png`;
      writeNew(root, relative, uploadBytes(payload.reference));
      reference = local(root, relative);
    }
    if (payload.pack || payload.packFile) {
      const packBytes = payload.packFile
        ? uploadBytes(payload.packFile, 256 * 1024)
        : jsonBytes(payload.pack);
      requireThat(packBytes.length <= 256 * 1024, "PACK_SIZE_LIMIT");
      let packData;
      try {
        packData = JSON.parse(packBytes.toString("utf8"));
      } catch {
        throw new Error("PACK_JSON_INVALID");
      }
      const relative = `${upload}/pack.json`;
      writeNew(root, relative, packBytes);
      pack = local(root, relative);
      if (packData.references?.primary && reference) {
        const target = `${upload}/${packData.references.primary}`;
        requireThat(target.endsWith(".png"), "STYLE_REFERENCE_ARTIFACT");
        const bytes = readBytes(reference),
          targetFile = local(root, target);
        if (fs.existsSync(targetFile))
          requireThat(
            readBytes(targetFile).equals(bytes),
            "STYLE_REFERENCE_ARTIFACT",
          );
        else writeNew(root, target, bytes);
        reference = null;
      }
    }
    const base = withLock(directory, () =>
      api.createStyle(directory, {
        preset: payload.preset ?? null,
        pack,
        reference,
        sampleCatalog:
          payload.preset && !pack && !reference && sampleCatalog
            ? sampleCatalog
            : null,
        notes: payload.notes ?? "",
        rules: payload.rules ?? null,
      }),
    );
    if (!payload.resolveNotes) return base;
    const output = await adapter.resolveStyle({
      base,
      notes: payload.notes.trim(),
    });
    const { pack: finalPack, resolution } = resolvedStylePack(base, output);
    const relative = `${upload}/resolved-pack.json`;
    writeJsonNew(root, relative, finalPack);
    // Original pack/PNG and the base style are retained. The core freezes the
    // entire derived pack so color-language and negative-rule conflicts resolve too.
    const style = withLock(directory, () =>
      api.createStyle(directory, {
        pack: local(root, relative),
        reference: base.references[0]
          ? local(directory, base.references[0].artifact.path)
          : null,
        notes: payload.notes.trim(),
      }),
    );
    return { ...style, resolution };
  }
  function projectDraft(id) {
    requireThat(isId(id) && id.startsWith("game-"), "PROJECT_DRAFT_ID");
    const value = readJson(local(root, `draft-metadata/${id}.json`));
    exact(value, ["id", "name", "styleSha256"]);
    requireThat(
      value.id === id && isDigest(value.styleSha256),
      "PROJECT_DRAFT_INVALID",
    );
    return value;
  }
  function completeProjectDraft(payload) {
    exact(payload, ["name", "draftId", "styleSha256", "approval"], ["preview"]);
    textValue(payload.name, 80);
    textValue(payload.approval, 2000);
    const draft = projectDraft(payload.draftId);
    requireThat(
      draft.name === payload.name.trim() &&
        draft.styleSha256 === payload.styleSha256,
      "PROJECT_DRAFT_MISMATCH",
    );
    return withLock(root, () => {
      const source = local(root, `drafts/${draft.id}`),
        target = local(root, `projects/${draft.id}`);
      const directory = fs.existsSync(target) ? target : source;
      const project = loadProject(directory);
      let selectedStyle = payload.styleSha256;
      api.loadStyle(directory, selectedStyle);
      if (payload.preview) {
        selectedStyle = previews.adopt(
          "project-drafts",
          draft.id,
          directory,
          payload.styleSha256,
          payload.preview,
          payload.approval,
        ).sha256;
      }
      requireThat(
        project.id === draft.id &&
          (!project.activeStyle || project.activeStyle === selectedStyle),
        "PROJECT_DRAFT_MISMATCH",
      );
      if (!project.activeStyle)
        api.activateStyle(directory, selectedStyle, payload.approval);
      if (directory === source) {
        requireThat(
          path.dirname(source) === local(root, "drafts") &&
            path.dirname(target) === local(root, "projects"),
          "PROJECT_DRAFT_PATH",
        );
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.renameSync(source, target);
      }
      const metaPath = local(root, `metadata/${draft.id}.json`);
      if (!fs.existsSync(metaPath))
        writeJsonNew(root, `metadata/${draft.id}.json`, {
          id: draft.id,
          name: draft.name,
          readOnly: false,
        });
      viewCache.delete(draft.id);
      return view(draft.id);
    });
  }
  async function mutation(id, action, payload) {
    const directory = projectRoot(id, true);
    requireThat(!activeGenerations.get(id), "PROJECT_BUSY");
    if (action === "style-draft") {
      activeGenerations.set(id, 1);
      try {
        return await draftStyle(id, payload);
      } finally {
        activeGenerations.delete(id);
      }
    }
    if (action === "style-activate") {
      exact(payload, ["styleSha256", "approval"], ["preview"]);
      const selectedStyle = payload.preview
        ? previews.adopt(
            "projects",
            id,
            directory,
            payload.styleSha256,
            payload.preview,
            payload.approval,
          ).sha256
        : payload.styleSha256;
      return api.activateStyle(directory, selectedStyle, payload.approval);
    }
    if (action === "style-preview") {
      activeGenerations.set(id, 1);
      try {
        return await previews.generate("projects", id, directory, payload);
      } finally {
        activeGenerations.delete(id);
      }
    }
    if (action === "import") {
      exact(payload, [], ["template", "spec", "catalog", "bundle", "preview"]);
      const upload = `uploads/${randomUUID()}`;
      let options;
      if (payload.template) {
        requireThat(Object.keys(payload).length === 1, "TEMPLATE_INVALID");
        const input = templateInput(payload.template);
        if (input.spec.panelSpecVersion === "fixed-reference-1") {
          const [{ createPanelBundle }, { loadWorkspaceCore }] =
            await Promise.all([
              import("../../ui-panel-harness/src/panel-bundle.mjs"),
              import("../../ui-panel-harness/src/component-adapter.mjs"),
            ]);
          const bundle = await createPanelBundle(
            input.spec,
            null,
            await loadWorkspaceCore(),
          );
          writeJsonNew(root, `${upload}/bundle.json`, bundle);
          options = { bundle: local(root, `${upload}/bundle.json`) };
        } else {
          writeJsonNew(root, `${upload}/spec.json`, input.spec);
          writeJsonNew(root, `${upload}/catalog.json`, input.catalog);
          options = {
            spec: local(root, `${upload}/spec.json`),
            catalog: local(root, `${upload}/catalog.json`),
          };
        }
      } else {
        requireThat(
          Boolean(payload.spec) !== Boolean(payload.bundle),
          "PANEL_INPUT_REQUIRED",
        );
        options = {};
        for (const key of ["spec", "catalog", "bundle"])
          if (payload[key]) {
            const relative = `${upload}/${key}.json`;
            writeJsonNew(root, relative, payload[key]);
            options[key] = local(root, relative);
          }
        if (options.spec && !options.catalog) options.catalog = defaultCatalog;
        if (payload.preview) {
          const relative = `${upload}/preview.png`;
          writeNew(root, relative, uploadBytes(payload.preview));
          options.preview = local(root, relative);
        }
      }
      const inputId = options.spec
        ? readJson(options.spec).id
        : readJson(options.bundle).spec?.id;
      requireThat(
        !Object.hasOwn(metadata(id).deletedPanels ?? {}, inputId),
        "PANEL_TRASHED",
      );
      return api.addPanel(directory, options);
    }
    if (action === "plan") {
      exact(payload, ["panelId"], ["note", "resolution", "parentRun"]);
      requireVisiblePanel(id, payload.panelId);
      return api.createPlan(directory, payload);
    }
    if (action === "plan-project") {
      exact(payload, [], ["panelIds", "intents", "resolution"]);
      let panelIds = selectedPanels(id, payload.panelIds ?? null);
      if (payload.panelIds == null && panelIds !== null) {
        const pending = api
          .projectStatus(directory)
          .panels.filter((panel) => panel.status !== "accepted_current_style");
        panelIds = panelIds.filter((id) =>
          pending.some((panel) => panel.panelId === id),
        );
        if (!panelIds.length) {
          const project = loadProject(directory);
          return {
            status: "nothing_to_plan",
            projectId: project.id,
            styleSha256: project.activeStyle,
            plans: [],
            maximumCalls: 0,
            computeCalls: 0,
          };
        }
      }
      return api.createProjectPlans(directory, { ...payload, panelIds });
    }
    throw new Error("ACTION_UNKNOWN");
  }

  const sessions = panelSessions({
    workspace: root,
    projectRoot,
    history: (id, panelId) => {
      const project = view(id);
      return (
        [...project.panels, ...project.deletedPanels].find(
          (panel) => panel.panelId === panelId,
        )?.history ?? []
      );
    },
    preflight: async () => {
      requireThat(adapter, "GENERATION_ADAPTER_NOT_CONFIGURED");
      await adapter.preflight?.();
    },
    execute: async (id, run, sessionKey) => {
      activeRuns.add(`${id}/${run}`);
      try {
        return await api.generateWithAdapter(
          projectRoot(id, true),
          run,
          claimedAdapter(id, run, sessionKey),
        );
      } finally {
        activeRuns.delete(`${id}/${run}`);
        viewCache.delete(id);
      }
    },
  });
  async function handler(req, res) {
    try {
      requireThat(origin, "HOST_NOT_BOUND");
      const expected = new URL(origin);
      requireThat(req.headers.host === expected.host, "LOCAL_HOST_REQUIRED");
      requireThat(
        !req.headers.origin || req.headers.origin === origin,
        "LOCAL_ORIGIN_REQUIRED",
      );
      requireThat(
        !req.headers["sec-fetch-site"] ||
          ["same-origin", "none"].includes(req.headers["sec-fetch-site"]),
        "LOCAL_ORIGIN_REQUIRED",
      );
      if (!["GET", "HEAD"].includes(req.method))
        requireThat(req.headers.origin === origin, "LOCAL_ORIGIN_REQUIRED");
      const url = new URL(req.url, origin),
        parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      if (parts[0] !== "api") {
        if (req.method !== "GET" && req.method !== "HEAD")
          return send(res, 405, { error: "METHOD_NOT_ALLOWED" });
        if (handler.frontend) return handler.frontend(req, res);
        const relative =
          url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        requireThat(/^[A-Za-z0-9._/-]+$/.test(relative), "PATH_INVALID");
        const file = local(path.join(webRoot, "dist"), relative);
        if (!fs.existsSync(file))
          return send(res, 404, { error: "FRONTEND_BUILD_REQUIRED" });
        const type =
          {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".svg": "image/svg+xml",
          }[path.extname(file)] ?? "application/octet-stream";
        return send(res, 200, readBytes(file), type);
      }
      if (
        req.method === "GET" &&
        parts.length === 2 &&
        parts[1] === "bootstrap"
      )
        return send(res, 200, {
          version: api.VERSION,
          presets,
          projects: projects(),
          trash: trashedProjects(),
          generationMode: adapter ? "adapter" : "host-exchange",
          generation: await generationInfo(),
          templates: templateList,
          stylePreviewActive: previews.busy(),
        });
      if (
        req.method === "GET" &&
        parts[1] === "templates" &&
        parts.length === 4 &&
        parts[3] === "image"
      )
        return send(res, 200, await templatePreview(parts[2]), "image/svg+xml");
      if (
        req.method === "GET" &&
        parts[1] === "presets" &&
        parts.length === 4 &&
        parts[3] === "image"
      ) {
        requireThat(sampleData?.images.has(parts[2]), "SAMPLE_IMAGE_UNKNOWN");
        return send(res, 200, sampleData.images.get(parts[2]), "image/png");
      }
      if (
        req.method === "POST" &&
        parts.length === 2 &&
        parts[1] === "project-drafts"
      ) {
        const payload = await bodyJson(req);
        exact(payload, ["name", "style"]);
        textValue(payload.name, 80);
        const id = `game-${randomUUID()}`,
          directory = local(root, `drafts/${id}`);
        api.initialize(directory, id);
        const style = await draftStyle(id, payload.style, directory);
        writeJsonNew(root, `draft-metadata/${id}.json`, {
          id,
          name: payload.name.trim(),
          styleSha256: style.sha256,
        });
        return send(res, 200, { id, style });
      }
      if (
        ["project-drafts", "projects"].includes(parts[1]) &&
        parts[3] === "style-preview" &&
        parts.length >= 4 &&
        parts.length <= 6
      ) {
        const scope = parts[1],
          previewId = parts[2];
        let previewSource;
        if (scope === "project-drafts") {
          const draft = projectDraft(previewId);
          previewSource = fs.existsSync(local(root, `drafts/${previewId}`))
            ? local(root, `drafts/${previewId}`)
            : projectRoot(previewId, true);
          if (req.method === "POST" && parts.length === 4) {
            const payload = await bodyJson(req);
            requireThat(
              payload.styleSha256 === draft.styleSha256,
              "PROJECT_DRAFT_MISMATCH",
            );
            return send(
              res,
              200,
              await previews.generate(scope, previewId, previewSource, payload),
            );
          }
        } else previewSource = projectRoot(previewId, true);
        if (req.method === "GET" && parts.length === 5)
          return send(res, 200, previews.read(scope, previewId, parts[4]));
        if (req.method === "GET" && parts.length === 6 && parts[5] === "image")
          return send(
            res,
            200,
            previews.image(scope, previewId, parts[4]),
            "image/png",
          );
      }
      if (
        req.method === "GET" &&
        parts[1] === "project-drafts" &&
        parts.length === 4 &&
        parts[3] === "image"
      ) {
        const draft = projectDraft(parts[2]),
          directory = local(root, `drafts/${draft.id}`);
        const style = api.loadStyle(directory, draft.styleSha256);
        requireThat(style.references.length > 0, "STYLE_IMAGE_MISSING");
        return send(
          res,
          200,
          verifyBlob(directory, style.references[0].artifact),
          "image/png",
        );
      }
      if (parts[1] !== "projects")
        return send(res, 404, { error: "ROUTE_UNKNOWN" });
      if (req.method === "POST" && parts.length === 2) {
        const payload = await bodyJson(req);
        if (Object.hasOwn(payload, "draftId"))
          return send(res, 201, completeProjectDraft(payload));
        exact(payload, ["name"]);
        textValue(payload.name, 80);
        const id = `game-${randomUUID()}`;
        api.initialize(local(root, `projects/${id}`), id);
        writeJsonNew(root, `metadata/${id}.json`, {
          id,
          name: payload.name.trim(),
          readOnly: false,
        });
        return send(res, 201, view(id));
      }
      const id = parts[2];
      if (
        req.method === "POST" &&
        parts.length === 4 &&
        ["trash", "restore"].includes(parts[3])
      ) {
        exact(await bodyJson(req), []);
        return send(res, 200, setTrashed(id, parts[3] === "trash"));
      }
      const directory = projectRoot(id);
      if (req.method === "GET" && parts.length === 3)
        return send(res, 200, view(id));
      if (req.method === "GET" && parts.length === 4 && parts[3] === "image")
        return image(id, url.searchParams, res);
      if (
        req.method === "POST" &&
        parts.length === 6 &&
        parts[3] === "panels" &&
        ["trash", "restore"].includes(parts[5])
      ) {
        exact(await bodyJson(req), []);
        return send(
          res,
          200,
          setPanelTrashed(id, parts[4], parts[5] === "trash"),
        );
      }
      if (
        parts[3] === "panels" &&
        parts[5] === "session" &&
        parts.length >= 6
      ) {
        const panelId = parts[4];
        requireThat(isId(panelId), "PANEL_UNKNOWN");
        requireVisiblePanel(id, panelId);
        if (req.method === "GET" && parts.length === 6)
          return send(res, 200, sessions.read(id, panelId));
        if (req.method === "POST" && parts.length === 7) {
          projectRoot(id, true);
          const payload = await bodyJson(req);
          requireVisiblePanel(id, panelId);
          if (parts[6] === "draft")
            return send(res, 200, sessions.save(id, panelId, payload));
          if (parts[6] === "generate") {
            requireThat(!activeGenerations.get(id), "PROJECT_BUSY");
            activeGenerations.set(id, 1);
            try {
              return send(
                res,
                200,
                await sessions.generate(id, panelId, payload),
              );
            } finally {
              activeGenerations.delete(id);
              viewCache.delete(id);
            }
          }
        }
        throw new Error("ACTION_UNKNOWN");
      }
      if (
        req.method === "POST" &&
        parts.length === 4 &&
        [
          "style-draft",
          "style-activate",
          "style-preview",
          "import",
          "plan",
          "plan-project",
        ].includes(parts[3])
      ) {
        const value = await mutation(id, parts[3], await bodyJson(req));
        viewCache.delete(id);
        return send(res, 200, value);
      }
      if (
        req.method === "POST" &&
        parts.length === 4 &&
        parts[3] === "export"
      ) {
        const payload = await bodyJson(req);
        exact(payload, [], ["panels", "format"]);
        const format = payload.format ?? "images";
        requireThat(
          ["images", "complete"].includes(format),
          "EXPORT_FORMAT_INVALID",
        );
        const exportId = randomUUID(),
          output = local(root, `exports/${id}/${exportId}`);
        const delivery = api.exportProject(
          directory,
          output,
          selectedPanels(id, payload.panels ?? null),
        );
        api.validateDelivery(output);
        return send(res, 200, {
          ...delivery,
          format,
          download: `/api/projects/${id}/exports/${exportId}?format=${format}`,
          exportId,
          excludedPanelIds: Object.keys(
            metadata(id).deletedPanels ?? {},
          ).sort(),
        });
      }
      if (
        req.method === "GET" &&
        parts.length === 5 &&
        parts[3] === "exports"
      ) {
        requireThat(/^[a-f0-9-]{36}$/.test(parts[4]), "EXPORT_ID_INVALID");
        const output = local(root, `exports/${id}/${parts[4]}`);
        // Old download URLs retain the original full delivery format.
        const format = url.searchParams.get("format") ?? "complete";
        requireThat(
          ["images", "complete"].includes(format),
          "EXPORT_FORMAT_INVALID",
        );
        const filename = projectExportFilename(metadata(id).name, format);
        if (format === "images")
          return send(
            res,
            200,
            createImageExport(output),
            "application/zip",
            filename,
          );
        api.validateDelivery(output);
        return send(
          res,
          200,
          readBytes(local(output, "references.zip")),
          "application/zip",
          filename,
        );
      }
      if (parts[3] === "runs" && parts.length >= 5) {
        const run = runPath(parts[4]);
        if (req.method === "GET" && parts.length === 5)
          return send(res, 200, {
            plan: api.verifyPlan(directory, run, { allowLegacy: true }),
            state: api.inspectRun(directory, run),
            execution: {
              active: activeRuns.has(`${id}/${run}`),
              dispatched: fs.existsSync(local(root, dispatchPath(id, run))),
            },
          });
        if (
          req.method === "GET" &&
          parts.length === 6 &&
          parts[5] === "input"
        ) {
          const plan = api.verifyPlan(directory, run, { allowLegacy: true }),
            index = Number(url.searchParams.get("index"));
          requireThat(
            url.searchParams.has("index") &&
              Number.isSafeInteger(index) &&
              index >= 0 &&
              index < plan.request.images.length,
            "INPUT_INDEX_INVALID",
          );
          return send(
            res,
            200,
            verifyBlob(directory, plan.request.images[index].artifact),
            "image/png",
          );
        }
        if (
          req.method === "GET" &&
          parts.length === 6 &&
          parts[5] === "exchange"
        ) {
          const plan = api.verifyPlan(directory, run),
            state = api.inspectRun(directory, run);
          requireThat(
            [
              "reserved_no_resubmit",
              "raw_received_needs_finish",
              "pending_visual_review",
              "accepted",
              "rejected_visual",
            ].includes(state.status),
            "EXCHANGE_NOT_RESERVED",
          );
          const request = readJson(local(directory, `${run}/request.json`));
          requireThat(
            canonical(request) === canonical(plan.request),
            "REQUEST_MISMATCH",
          );
          const files = new Map([
            ["request.json", jsonBytes(request)],
            [
              "identity.json",
              jsonBytes({
                planSha256: plan.sha256,
                requestSha256: state.requestSha256,
                maximumCalls: 1,
              }),
            ],
          ]);
          for (const image of request.images)
            files.set(
              image.artifact.path,
              verifyBlob(directory, image.artifact),
            );
          return send(
            res,
            200,
            createStoredZip(files),
            "application/zip",
            "generation-inputs.zip",
          );
        }
        if (req.method === "POST" && parts.length === 6) {
          const payload = await bodyJson(req);
          projectRoot(id, true);
          if (!["receive", "finish", "stop"].includes(parts[5]))
            requireVisiblePanel(
              id,
              api.verifyPlan(directory, run, { allowLegacy: true }).panelId,
            );
          let result;
          if (parts[5] === "authorize") {
            exact(payload, ["planSha256", "approval"]);
            result = api.authorize(
              directory,
              run,
              payload.planSha256,
              payload.approval,
            );
          } else if (parts[5] === "request") {
            exact(payload, []);
            result = api.reserve(directory, run);
          } else if (["generate", "dispatch-reserved"].includes(parts[5])) {
            const continuing = parts[5] === "dispatch-reserved";
            exact(payload, continuing ? ["requestSha256", "notSubmitted"] : []);
            requireThat(adapter, "GENERATION_ADAPTER_NOT_CONFIGURED");
            requireThat(!activeGenerations.get(id), "PROJECT_BUSY");
            requireThat(!activeRuns.has(`${id}/${run}`), "PROJECT_BUSY");
            const plan = api.verifyPlan(directory, run);
            assertCurrent(directory, plan);
            const state = api.inspectRun(directory, run);
            requireThat(
              continuing
                ? state.status === "reserved_no_resubmit" &&
                    payload.requestSha256 === state.requestSha256 &&
                    payload.notSubmitted === true &&
                    !fs.existsSync(local(root, dispatchPath(id, run)))
                : state.status === "authorized",
              "ATTEMPT_ALREADY_RESERVED_NO_RESUBMIT",
            );
            activeGenerations.set(id, (activeGenerations.get(id) ?? 0) + 1);
            activeRuns.add(`${id}/${run}`);
            try {
              await adapter.preflight?.();
              assertCurrent(directory, plan);
              const selectedAdapter = claimedAdapter(id, run);
              if (continuing) {
                let bytes;
                try {
                  bytes = await selectedAdapter.generate({
                    ...plan.request,
                    requestSha256: state.requestSha256,
                    images: plan.request.images.map((image) => ({
                      role: image.role,
                      sha256: image.artifact.sha256,
                      bytes: verifyBlob(directory, image.artifact),
                    })),
                  });
                } catch {
                  api.stopAttempt(
                    directory,
                    run,
                    state.requestSha256,
                    "indeterminate",
                  );
                  throw new Error("ADAPTER_INDETERMINATE_NO_RESUBMIT");
                }
                if (
                  !(bytes instanceof Uint8Array) ||
                  bytes.length > 64 * 1024 * 1024
                ) {
                  api.stopAttempt(
                    directory,
                    run,
                    state.requestSha256,
                    "indeterminate",
                  );
                  throw new Error("ADAPTER_RESULT_INVALID_NO_RESUBMIT");
                }
                result = api.receive(
                  directory,
                  run,
                  state.requestSha256,
                  bytes,
                );
              } else {
                result = await api.generateWithAdapter(
                  directory,
                  run,
                  selectedAdapter,
                );
              }
            } finally {
              activeRuns.delete(`${id}/${run}`);
              const remaining = activeGenerations.get(id) - 1;
              if (remaining) activeGenerations.set(id, remaining);
              else activeGenerations.delete(id);
            }
          } else if (parts[5] === "receive") {
            exact(payload, ["requestSha256", "image"]);
            result = api.receive(
              directory,
              run,
              payload.requestSha256,
              uploadBytes(payload.image),
            );
          } else if (parts[5] === "finish") {
            exact(payload, ["rawSha256"]);
            result = api.finish(directory, run, payload.rawSha256);
          } else if (parts[5] === "review") {
            exact(
              payload,
              ["imageSha256", "layout", "style", "copy", "decision", "note"],
              ["useAsAnchor"],
            );
            result = api.reviewRun(directory, run, payload);
          } else if (parts[5] === "stop") {
            exact(payload, ["requestSha256", "outcome"]);
            result = api.stopAttempt(
              directory,
              run,
              payload.requestSha256,
              payload.outcome,
            );
          } else throw new Error("ACTION_UNKNOWN");
          viewCache.delete(id);
          return send(res, 200, result);
        }
      }
      return send(res, 404, { error: "ROUTE_UNKNOWN" });
    } catch (error) {
      const code = safeError(error),
        denied = /LOCAL_(HOST|ORIGIN)_REQUIRED|SHOWCASE_READ_ONLY/.test(code);
      send(
        res,
        denied
          ? 403
          : ["PROJECT_TRASHED", "PANEL_TRASHED"].includes(code)
            ? 410
            : /UNKNOWN|MISSING/.test(code)
              ? 404
              : 400,
        {
          error: code,
        },
      );
    }
  }
  return {
    handler,
    setOrigin(value) {
      const url = new URL(value);
      requireThat(
        url.hostname === "127.0.0.1" && url.protocol === "http:",
        "LOOPBACK_ONLY",
      );
      origin = url.origin;
    },
    preload() {
      return projects();
    },
  };
}

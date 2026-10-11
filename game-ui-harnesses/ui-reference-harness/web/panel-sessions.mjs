import * as fs from "node:fs";
import * as api from "../src/index.mjs";
import { loadProject } from "../src/project.mjs";
import {
  atomicJson,
  digestJson,
  exact,
  local,
  readJson,
  requireThat,
  textValue,
  withLock,
} from "../src/common.mjs";

// Private workbench history. Core APIs exclusively own compute and image records.
export function panelSessions({
  workspace,
  projectRoot,
  history,
  execute,
  preflight,
}) {
  const active = new Set();
  function context(id, panelId) {
    const project = loadProject(projectRoot(id));
    requireThat(project.activeStyle, "PROJECT_STYLE_REQUIRED");
    requireThat(Object.hasOwn(project.panels, panelId), "PANEL_UNKNOWN");
    return {
      projectId: id,
      panelId,
      styleSha256: project.activeStyle,
      prototypeSha256: project.panels[panelId].prototype.sha256,
    };
  }
  function load(id, panelId) {
    const binding = context(id, panelId),
      key = digestJson(binding);
    const relative = `panel-sessions/${id}/${key}.json`,
      file = local(workspace, relative);
    if (fs.existsSync(file)) {
      const value = readJson(file);
      requireThat(
        value.key === key &&
          digestJson(value.context) === key &&
          Array.isArray(value.turns) &&
          Number.isSafeInteger(value.version) &&
          value.version >= 0,
        "SESSION_INVALID",
      );
      return { value, relative };
    }
    // Adopt the newest verified image without altering its review or attempt.
    const source = history(id, panelId).find(
      (item) => item.current && item.imageSha256,
    );
    return {
      relative,
      value: {
        kind: "ui_reference_panel_session_v1",
        key,
        context: binding,
        version: 0,
        note: source
          ? api.verifyPlan(projectRoot(id), source.run, { allowLegacy: true })
              .intent.note
          : "",
        feedback: "",
        turns: source
          ? [
              {
                operationId: "adopted",
                run: source.run,
                round: source.round,
                note: "",
                created: new Date(source.created).toISOString(),
                error: null,
              },
            ]
          : [],
      },
    };
  }
  function present(id, value) {
    const items = history(id, value.context.panelId);
    const turns = value.turns.map((turn) => {
      const item = turn.run
        ? items.find((item) => item.run === turn.run)
        : null;
      const state = item;
      requireThat(!turn.run || (item && item.current), "SESSION_SOURCE_STALE");
      return {
        ...turn,
        status: state?.status ?? (turn.error ? "failed" : "preparing"),
        imageSha256: state?.imageSha256 ?? null,
        image: item?.image ?? null,
        active:
          active.has(value.key) &&
          turn.operationId === value.turns.at(-1)?.operationId,
      };
    });
    const source =
      [...turns].reverse().find((turn) => turn.imageSha256) ?? null;
    const rounds = Math.max(
      0,
      ...turns.filter((turn) => turn.run).map((turn) => turn.round),
    );
    const last = turns.at(-1);
    const interrupted =
      !active.has(value.key) &&
      last &&
      !last.error &&
      [
        "preparing",
        "authorized",
        "awaiting_authorization",
        "reserved_no_resubmit",
        "raw_received_needs_finish",
      ].includes(last.status);
    return {
      ...value,
      turns,
      source,
      revisionsUsed: rounds,
      revisionsRemaining: 3 - rounds,
      active: active.has(value.key),
      interrupted: !!interrupted,
    };
  }
  function read(id, panelId) {
    return present(id, load(id, panelId).value);
  }
  function check(payload, value) {
    requireThat(
      payload.sessionKey === value.key && payload.version === value.version,
      "SESSION_STALE",
    );
  }
  function save(id, panelId, payload) {
    exact(payload, ["sessionKey", "version", "note", "feedback"]);
    textValue(payload.note, 8000, true);
    textValue(payload.feedback, 8000, true);
    return withLock(workspace, () => {
      const { value, relative } = load(id, panelId);
      check(payload, value);
      requireThat(!active.has(value.key), "PROJECT_BUSY");
      value.note = payload.note;
      value.feedback = payload.feedback;
      value.version++;
      atomicJson(workspace, relative, value);
      return present(id, value);
    });
  }
  async function generate(id, panelId, payload) {
    exact(payload, [
      "sessionKey",
      "version",
      "operationId",
      "note",
      "feedback",
      "sourceImageSha256",
    ]);
    textValue(payload.note, 8000, true);
    textValue(payload.feedback, 8000, true);
    requireThat(
      /^[a-f0-9-]{36}$/.test(payload.operationId),
      "SESSION_OPERATION_INVALID",
    );
    let value, relative, round, source;
    withLock(workspace, () => {
      ({ value, relative } = load(id, panelId));
      // Replaying the same HTTP operation only reads its recorded outcome.
      if (value.turns.some((turn) => turn.operationId === payload.operationId))
        return;
      check(payload, value);
      requireThat(!active.has(value.key), "PROJECT_BUSY");
      const current = present(id, value);
      source = current.source;
      requireThat(
        (source?.imageSha256 ?? null) === payload.sourceImageSha256,
        "SESSION_SOURCE_STALE",
      );
      requireThat(
        !source || current.revisionsRemaining > 0,
        "REVISION_LIMIT_REACHED",
      );
      if (source) textValue(payload.feedback, 8000);
      // After a host interruption, the next explicit user decision closes an
      // orphaned reservation. It never dispatches or reuses that old attempt.
      const previous = current.turns.at(-1);
      if (current.interrupted && previous?.status === "reserved_no_resubmit") {
        const state = api.inspectRun(projectRoot(id), previous.run);
        if (state.executable)
          api.stopAttempt(
            projectRoot(id),
            previous.run,
            state.requestSha256,
            "indeterminate",
          );
      }
      round = source ? current.revisionsUsed + 1 : 0;
      value.note = payload.note;
      value.feedback = payload.feedback;
      value.turns.push({
        operationId: payload.operationId,
        run: null,
        round,
        note: source ? payload.feedback : payload.note,
        created: new Date().toISOString(),
        error: null,
      });
      value.version++;
      atomicJson(workspace, relative, value);
      active.add(value.key);
    });
    if (round === undefined) return read(id, panelId);
    const turn = value.turns.at(-1);
    try {
      await preflight();
      requireThat(
        digestJson(context(id, panelId)) === value.key,
        "SESSION_STALE",
      );
      const directory = projectRoot(id);
      const plan = source
        ? api.createRevisionPlan(directory, {
            sourceRun: source.run,
            note: payload.feedback,
            round,
          })
        : api.createPlan(directory, {
            panelId,
            note: payload.note,
            resolution: "native",
          });
      turn.run = plan.run;
      value.version++;
      atomicJson(workspace, relative, value);
      // The human's Generate/Modify click is the fresh single-image compute
      // decision. Bind it to the plan that the deterministic compiler just froze.
      api.authorize(
        directory,
        plan.run,
        plan.planSha256,
        `Workbench ${source ? "modify" : "generate"} click ${payload.operationId}: one image for plan ${plan.planSha256}; no automatic retry.`,
      );
      await execute(id, plan.run, value.key);
      value.feedback = "";
    } catch (error) {
      turn.error = /^[A-Z][A-Z0-9_]{1,100}$/.test(error.message)
        ? error.message
        : "OPERATION_FAILED";
      throw error;
    } finally {
      value.version++;
      atomicJson(workspace, relative, value);
      active.delete(value.key);
    }
    return read(id, panelId);
  }
  return { read, save, generate };
}

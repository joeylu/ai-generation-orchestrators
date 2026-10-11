import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button, Field, Modal } from "./ui.jsx";
import { GenerationProgress } from "./GenerationProgress.jsx";
import { generationProgress } from "./generation-progress.js";
import {
  errorText,
  labels,
  mutateAndRefresh,
  projectPath,
  request,
  runPath,
} from "./api.js";
import { PanelDialog as ManualPanelDialog } from "./ManualPanelDialog.jsx";
export { BatchDialog } from "./ManualPanelDialog.jsx";

export function PanelDialog(props) {
  return props.generationMode === "host-exchange" ? (
    <ManualPanelDialog {...props} />
  ) : (
    <SessionPanelDialog {...props} />
  );
}

function SessionPanelDialog({
  project,
  panel,
  generation,
  perform,
  onRefresh,
  onClose,
  busy,
}) {
  const endpoint = `${projectPath(project.id)}/panels/${panel.panelId}/session`;
  const storageKey = `ui-reference-draft:${project.id}:${panel.panelId}:${project.activeStyle}:${panel.prototypeSha256}`;
  const [session, setSession] = useState(null),
    [error, setError] = useState(null);
  const [note, setNote] = useState(""),
    [feedback, setFeedback] = useState("");
  const [preview, setPreview] = useState(
    panel.image ? "reference" : "prototype",
  );
  const [selectedRun, setSelectedRun] = useState(null),
    [anchor, setAnchor] = useState(false);
  const [submitting, setSubmitting] = useState(false),
    [saveState, setSaveState] = useState("");
  const [operation, setOperation] = useState(null);
  const sessionRef = useRef(null),
    draftRef = useRef({ note: "", feedback: "" });
  const saveChain = useRef(Promise.resolve()),
    alive = useRef(true),
    initialized = useRef(false);
  function apply(value) {
    sessionRef.current = value;
    if (alive.current) setSession(value);
  }
  const read = useCallback(async () => {
    const value = await request(endpoint);
    sessionRef.current = value;
    if (alive.current) {
      setSession(value);
      setError(null);
    }
    return value;
  }, [endpoint]);
  useEffect(() => {
    alive.current = true;
    read()
      .then((value) => {
        if (!alive.current) return;
        let draft = { note: value.note, feedback: value.feedback };
        try {
          const local = JSON.parse(localStorage.getItem(storageKey));
          if (
            local &&
            local.version >= value.version &&
            typeof local.note === "string" &&
            typeof local.feedback === "string"
          )
            draft = { note: local.note, feedback: local.feedback };
        } catch {}
        draftRef.current = draft;
        setNote(draft.note);
        setFeedback(draft.feedback);
        initialized.current = true;
      })
      .catch((failure) => {
        if (alive.current) setError(failure);
      });
    return () => {
      alive.current = false;
    };
  }, [read, storageKey]);
  function change(field, value) {
    const draft = { ...draftRef.current, [field]: value };
    draftRef.current = draft;
    if (field === "note") setNote(value);
    else setFeedback(value);
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ ...draft, version: sessionRef.current?.version ?? 0 }),
      );
    } catch {}
    setSaveState("正在保存…");
  }
  function saveDraft() {
    const task = async () => {
      const current = sessionRef.current,
        draft = { ...draftRef.current };
      if (!current || current.active || project.readOnly) return;
      if (current.note === draft.note && current.feedback === draft.feedback)
        return;
      const value = await request(`${endpoint}/draft`, {
        sessionKey: current.key,
        version: current.version,
        ...draft,
      });
      apply(value);
      if (alive.current) setSaveState("已保存");
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({ ...draftRef.current, version: value.version }),
        );
      } catch {}
    };
    const next = saveChain.current.then(task, task);
    saveChain.current = next.catch(() => {});
    return next;
  }
  useEffect(() => {
    if (
      !initialized.current ||
      session?.active ||
      submitting ||
      project.readOnly
    )
      return;
    const timer = setTimeout(() => {
      saveDraft().catch((failure) => {
        if (alive.current) {
          setError(failure);
          setSaveState("保存未完成");
        }
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [note, feedback, session?.active, submitting]);
  useEffect(() => {
    if (!session?.active && !submitting) return;
    let stopped = false,
      timer;
    async function poll() {
      try {
        const value = await read();
        if (!value.active) await onRefresh();
      } catch (failure) {
        if (!stopped && alive.current) setError(failure);
      }
      if (!stopped) timer = setTimeout(poll, 2000);
    }
    timer = setTimeout(poll, 1000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [session?.active, submitting, read, onRefresh]);
  const current = session?.source;
  const versions = session?.turns.filter((turn) => turn.image) ?? [];
  const selected = versions.find((turn) => turn.run === selectedRun) ?? current;
  const image = selected?.image ?? panel.image;
  const outdatedImage =
    !current &&
    panel.image &&
    panel.history?.find((item) => item.run === panel.displayRun)?.current ===
      false;
  const working = submitting || session?.active;
  const progress = generationProgress(session, submitting ? operation : null);
  const last = session?.turns.at(-1);
  const editable =
    !busy && !working && !project.readOnly && !!session && !error;
  async function generate() {
    if (!editable) return;
    const pending = {
      id: crypto.randomUUID(),
      startedAt: Date.now(),
      revision: !!current,
      phase: "saving",
    };
    setOperation(pending);
    setSubmitting(true);
    setError(null);
    await perform(() =>
      mutateAndRefresh(
        async () => {
          await saveDraft();
          const value = sessionRef.current;
          if (alive.current) setOperation({ ...pending, phase: "waiting" });
          const result = await request(`${endpoint}/generate`, {
            sessionKey: value.key,
            version: value.version,
            operationId: pending.id,
            ...draftRef.current,
            sourceImageSha256: value.source?.imageSha256 ?? null,
          });
          apply(result);
          setSaveState("已保存");
          setSelectedRun(null);
          setPreview("reference");
          draftRef.current = { ...draftRef.current, feedback: "" };
          setFeedback("");
          try {
            localStorage.setItem(
              storageKey,
              JSON.stringify({ ...draftRef.current, version: result.version }),
            );
          } catch {}
          return result;
        },
        async () => {
          if (alive.current) setOperation({ ...pending, phase: "finishing" });
          await read();
          await onRefresh();
        },
      ),
    );
    if (alive.current) setSubmitting(false);
  }
  async function accept() {
    if (!selected || !editable) return;
    await perform(() =>
      mutateAndRefresh(
        () =>
          request(`${runPath(project.id, selected.run)}/review`, {
            imageSha256: selected.imageSha256,
            layout: "pass",
            style: "pass",
            copy: "pass",
            decision: "accept",
            note: "用户点击接受，确认当前图片的布局、风格与文案均符合要求。",
            useAsAnchor: anchor,
          }),
        async () => {
          await read();
          await onRefresh();
        },
      ),
    );
    setAnchor(false);
  }
  async function close() {
    if (!working && !project.readOnly) {
      try {
        await saveDraft();
      } catch (failure) {
        setError(failure);
        return;
      }
    }
    onClose();
  }
  return (
    <Modal
      title={panel.title}
      subtitle={`${project.styleName} · 首图 + 最多三轮修改`}
      onClose={close}
      wide
    >
      <div className="panel-detail">
        <div className="detail-visual">
          <div className="mode-tabs">
            <button
              className={preview === "reference" ? "active" : ""}
              disabled={!image}
              onClick={() => setPreview("reference")}
            >
              参考图
            </button>
            <button
              className={preview === "prototype" ? "active" : ""}
              onClick={() => setPreview("prototype")}
            >
              面板原型
            </button>
          </div>
          <div className="detail-image">
            <img
              src={
                preview === "reference" && image ? image : panel.prototypeImage
              }
              alt={`${panel.title}${preview === "reference" && image ? "参考图" : "原型"}`}
            />
          </div>
          {image && (
            <a
              className="image-download"
              href={image}
              download={`${panel.panelId}.png`}
            >
              下载当前图片
            </a>
          )}
          {versions.length > 0 && (
            <div className="session-history" aria-label="版本记录">
              {versions.map((turn) => (
                <button
                  key={turn.run}
                  className={selected?.run === turn.run ? "active" : ""}
                  onClick={() => {
                    setSelectedRun(turn.run);
                    setPreview("reference");
                    setAnchor(false);
                  }}
                >
                  <img
                    src={turn.image}
                    alt={turn.round === 0 ? "首图" : `修改 ${turn.round}`}
                  />
                  <span>
                    {turn.round === 0 ? "首图" : `修改 ${turn.round}`}
                    {turn.status === "accepted" ? " · 已接受" : ""}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="detail-controls">
          <div className="section-heading">
            <h3>{current ? "查看与修改" : "生成参考图"}</h3>
          </div>
          {error && (
            <div className="error-message" role="alert">
              <p>{errorText(error)}</p>
              <Button onClick={() => read().catch(setError)}>重新读取</Button>
            </div>
          )}
          {!session && !error && <p role="status">正在读取会话…</p>}
          {!working && session?.interrupted && (
            <p className="muted" role="status">
              上次操作中断，记录已保留。不会自动重新提交。
            </p>
          )}
          {!working && last?.error && (
            <p className="muted" role="status">
              上次操作未完成：{errorText(new Error(last.error))}{" "}
              {last.run && last.round > 0 ? "本轮已计入修改次数。" : ""}
            </p>
          )}
          {!current && session && (
            <>
              {outdatedImage && (
                <p className="muted">
                  预览是旧风格或旧原型的图片。生成后将展示当前版本。
                </p>
              )}
              <Field
                label="面板补充（可选）"
                hint="补充视觉要求，布局和文案沿用原型。"
              >
                <textarea
                  rows="5"
                  maxLength={8000}
                  value={note}
                  disabled={!editable}
                  onChange={(event) => change("note", event.target.value)}
                  placeholder="例如：主要按钮更醒目，边框轻一些"
                />
              </Field>
              <Button
                variant="primary"
                icon={working ? "loading" : "spark"}
                aria-busy={working || undefined}
                disabled={!editable || generation?.ready === false}
                onClick={generate}
              >
                {working
                  ? "正在生成…"
                  : last?.run
                    ? "重新生成一次"
                    : "生成参考图"}
              </Button>
              <GenerationProgress progress={progress} />
              <p className="subtle">
                点击生成 1 张图片，自动完成检查后展示结果。
              </p>
            </>
          )}
          {current && session && (
            <>
              <p className="muted">
                {selected?.run !== current.run
                  ? "正在查看历史版本；修改会基于最新图片。"
                  : (labels[current.status] ?? "待验收")}
              </p>
              {selected?.status === "pending_visual_review" && (
                <>
                  <p className="muted">
                    点击接受，确认当前图片的布局、风格和文案均符合要求。
                  </p>
                  {!project.anchor && (
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={anchor}
                        disabled={!editable}
                        onChange={(event) => setAnchor(event.target.checked)}
                      />
                      <span>将这张图设为项目风格锚点</span>
                    </label>
                  )}
                  <Button
                    variant="primary"
                    icon="check"
                    disabled={!editable || preview !== "reference"}
                    onClick={accept}
                  >
                    接受这张图
                  </Button>
                </>
              )}
              <div className="session-revision">
                <Field
                  label={`修改意见 · 剩余 ${session.revisionsRemaining} 轮`}
                  hint={
                    session.revisionsRemaining
                      ? "每轮基于最新图片修改，项目风格和原型保持一致。"
                      : "已用完三轮修改，可选择并接受满意的版本。"
                  }
                >
                  <textarea
                    rows="4"
                    maxLength={8000}
                    value={feedback}
                    disabled={!editable || !session.revisionsRemaining}
                    onChange={(event) => change("feedback", event.target.value)}
                    placeholder="描述这次需要调整的地方"
                  />
                </Field>
                <Button
                  icon={working ? "loading" : "spark"}
                  aria-busy={working || undefined}
                  disabled={
                    !editable ||
                    !session.revisionsRemaining ||
                    !feedback.trim() ||
                    generation?.ready === false
                  }
                  onClick={generate}
                >
                  {working
                    ? progress?.revision
                      ? "正在修改…"
                      : "正在生成…"
                    : "修改并生成"}
                </Button>
                <GenerationProgress progress={progress} />
              </div>
            </>
          )}
          {saveState && (
            <p className="subtle" role="status">
              {saveState}
            </p>
          )}
          {selected?.note && (
            <details className="plan-details">
              <summary>
                {selected.round === 0 ? "面板补充" : "这轮修改意见"}
              </summary>
              <p>{selected.note}</p>
            </details>
          )}
          <details className="plan-details">
            <summary>生成记录</summary>
            <p className="muted">
              {generation?.name} · {generation?.model} / {generation?.effort}
            </p>
            {session?.turns.map((turn) => (
              <p className="muted" key={turn.operationId}>
                {turn.round === 0 ? "首图" : `修改 ${turn.round}`} ·{" "}
                {turn.active
                  ? "正在生成"
                  : (labels[turn.status] ?? turn.status)}
              </p>
            ))}
          </details>
        </div>
      </div>
      <div className="modal-footer">
        <span className="footer-note">图片与修改意见自动保存到本地项目。</span>
        <Button onClick={close}>关闭</Button>
      </div>
    </Modal>
  );
}

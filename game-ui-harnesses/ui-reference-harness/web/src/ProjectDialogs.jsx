import React, { useEffect, useState } from "react";
import { Button, Field, Hash, Modal, Swatches } from "./ui.jsx";
import { StyleLibrary } from "./StudioShell.jsx";
import { styleDraftInput } from "./style-input.js";
import {
  errorText,
  fileBase64,
  fileJson,
  panelInputKind,
  projectPath,
  request,
} from "./api.js";

function StyleRules({ draft }) {
  const values = draft.resolution
    ? { ...draft.pack.render_style, ...draft.pack.ui_rules }
    : draft.rules;
  const labels = {
    material: "材质",
    shape: "造型",
    typography: "字体",
    icons: "图标",
    decoration: "装饰",
    lighting: "光影",
    visual_identity: "整体风格",
    line: "线条",
    shape_language: "造型",
    color: "色彩语言",
    texture: "纹理",
    render_finish: "完成效果",
    frame: "边框",
    controls: "控件",
    background: "背景",
  };
  return (
    <>
      {Object.entries(values)
        .filter(([key]) => key !== "palette")
        .map(([key, value]) => (
          <div key={key}>
            <strong>{labels[key]}</strong>
            <p>{value}</p>
          </div>
        ))}
      {draft.resolution && (
        <div>
          <strong>限制规则</strong>
          <ul>
            {draft.pack.negative_rules.map((rule, index) => (
              <li key={index}>{rule}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

export function DeletePanelDialog({ panel, busy, onClose, onDelete }) {
  return (
    <Modal
      title="删除面板"
      subtitle="可在当前项目的“已删除”中恢复。"
      onClose={onClose}
      closeDisabled={busy}
    >
      <div className="modal-body delete-project-copy">
        <h3>{panel.title}</h3>
        <p>删除后不再参与后续项目导出，原型、图片和生成记录都会保留。</p>
        <p>
          已经提交的生成任务会继续收尾，结果保留在已删除面板中，不会自动重新生成。
        </p>
      </div>
      <div className="modal-footer">
        <Button disabled={busy} onClick={onClose}>
          取消
        </Button>
        <Button
          variant="danger"
          icon="trash"
          disabled={busy}
          onClick={onDelete}
        >
          确认删除
        </Button>
      </div>
    </Modal>
  );
}

export function DeleteProjectDialog({ project, busy, onClose, onDelete }) {
  return (
    <Modal
      title="删除项目"
      subtitle="项目会移入回收站，之后可以恢复。"
      onClose={onClose}
      closeDisabled={busy}
    >
      <div className="modal-body delete-project-copy">
        <h3>{project.name}</h3>
        <p>确认将这个项目移入回收站？原型、风格、图片和生成记录都会保留。</p>
      </div>
      <div className="modal-footer">
        <Button disabled={busy} onClick={onClose}>
          取消
        </Button>
        <Button
          variant="danger"
          icon="trash"
          disabled={busy}
          onClick={onDelete}
        >
          移入回收站
        </Button>
      </div>
    </Modal>
  );
}

export function NewProjectDialog({ onClose, onCreate, busy }) {
  const [name, setName] = useState("");
  return (
    <Modal
      title="新建项目"
      subtitle="每个游戏项目维护一套统一风格。"
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onCreate(name);
        }}
      >
        <div className="modal-body">
          <Field label="项目名称">
            <input
              autoFocus
              required
              maxLength={80}
              placeholder="例如：森林冒险"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
        </div>
        <div className="modal-footer">
          <Button type="button" onClick={onClose}>
            取消
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={busy || !name.trim()}
          >
            下一步：选择风格
          </Button>
        </div>
      </form>
    </Modal>
  );
}
export function StyleDialog({
  project,
  presets,
  onClose,
  onRefresh,
  perform,
  busy,
  newProjectName = null,
  onCreated,
}) {
  const [mode, setMode] = useState("default"),
    [selected, setSelected] = useState(presets[0]?.id);
  const [reference, setReference] = useState(null),
    [notes, setNotes] = useState(""),
    [draft, setDraft] = useState(null),
    [draftId, setDraftId] = useState(null),
    [resolving, setResolving] = useState(false),
    [styleError, setStyleError] = useState(null),
    [preview, setPreview] = useState(null),
    [previewing, setPreviewing] = useState(false),
    [previewSeconds, setPreviewSeconds] = useState(0),
    [previewReady, setPreviewReady] = useState(false);
  useEffect(() => {
    if (!previewing) return;
    const start = Date.now();
    const timer = setInterval(
      () => setPreviewSeconds(Math.floor((Date.now() - start) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [previewing]);
  const previewRoute =
    newProjectName === null
      ? `${projectPath(project.id)}/style-preview`
      : `/api/project-drafts/${draftId}/style-preview`;
  const requiresPreview = mode === "custom" || Boolean(notes.trim());
  async function previewDraft(nextDraft, nextDraftId) {
    const route =
      newProjectName === null
        ? `${projectPath(project.id)}/style-preview`
        : `/api/project-drafts/${nextDraftId}/style-preview`;
    const operationId = crypto.randomUUID();
    setPreview({ operationId, active: true });
    setPreviewReady(false);
    setPreviewSeconds(0);
    setPreviewing(true);
    setStyleError(null);
    try {
      const result = await request(route, {
        styleSha256: nextDraft.sha256,
        operationId,
        approval: `点击确认并生成预览：使用${mode === "custom" ? "用户参考图和风格描述" : "所选默认风格和补充要求"}形成的风格 ${nextDraft.sha256} 及统一设置原型生成 1 张不透明参考图，不自动重试；仅用于预览，最终核对新图与规则后再确认采用。`,
      });
      setPreview(result);
      if (!result.image)
        setStyleError("风格预览尚未完成，请读取生成结果；不会自动重试。");
      return result;
    } catch (error) {
      try {
        setPreview(await request(`${route}/${operationId}`));
      } catch {
        setPreview(
          error.code && error.code !== "ADAPTER_INDETERMINATE_NO_RESUBMIT"
            ? null
            : { operationId, unavailable: true },
        );
      }
      setStyleError(errorText(error));
      throw error;
    } finally {
      setPreviewing(false);
    }
  }
  async function generatePreview() {
    await perform(() => previewDraft(draft, draftId));
  }
  async function readPreview() {
    await perform(async () => {
      try {
        const result = await request(`${previewRoute}/${preview.operationId}`);
        setPreview(result);
        setStyleError(
          result.image
            ? null
            : result.active
              ? "风格预览仍在生成，请稍后读取结果。"
              : "上次预览未完成，记录已保留；重试会创建一次新尝试。",
        );
        return result;
      } catch (error) {
        setStyleError(errorText(error));
        throw error;
      }
    });
  }
  async function prepare(event) {
    event.preventDefault();
    setResolving(Boolean(notes.trim()));
    setStyleError(null);
    setPreview(null);
    setPreviewReady(false);
    await perform(async () => {
      let nextDraft = null;
      try {
        const styleInput = styleDraftInput({
          custom: mode === "custom",
          preset: selected,
          reference:
            mode === "custom" && reference ? await fileBase64(reference) : null,
          notes,
        });
        const result = await (newProjectName === null
          ? request(`${projectPath(project.id)}/style-draft`, styleInput)
          : request("/api/project-drafts", {
              name: newProjectName,
              style: styleInput,
            }));
        nextDraft = newProjectName === null ? result : result.style;
        const nextDraftId = result.id ?? null;
        setDraftId(nextDraftId);
        setResolving(false);
        if (requiresPreview) await previewDraft(nextDraft, nextDraftId);
        return result;
      } catch (error) {
        setStyleError(errorText(error));
        throw error;
      } finally {
        setResolving(false);
        // Keep the selection form visible through both stages; only show the
        // review screen once the image is ready, or with a saved failed attempt.
        if (nextDraft) setDraft(nextDraft);
      }
    });
  }
  async function activate() {
    const name = draft.pack?.metadata.name ?? "自定义参考图风格";
    const result = await perform(async () => {
      const approval = preview?.image
        ? `已查看并确认新风格预览 ${preview.imageSha256} 的布局、风格与文案，将此图及「${name}」当前展示的规则和备注设为本项目统一风格。`
        : `确认将「${name}」及当前展示的规则、备注和参考图设为本项目统一风格。`;
      const previewInput = preview?.image
        ? {
            preview: {
              operationId: preview.operationId,
              imageSha256: preview.imageSha256,
            },
          }
        : {};
      if (newProjectName !== null) {
        const created = await request("/api/projects", {
          name: newProjectName,
          draftId,
          styleSha256: draft.sha256,
          approval,
          ...previewInput,
        });
        await onCreated(created);
        return created;
      }
      const activated = await request(
        `${projectPath(project.id)}/style-activate`,
        {
          styleSha256: draft.sha256,
          approval,
          ...previewInput,
        },
      );
      await onRefresh();
      return activated;
    });
    if (result && newProjectName === null) onClose();
  }
  return (
    <Modal
      title={draft ? "确认项目风格" : "选择项目风格"}
      subtitle={
        draft
          ? newProjectName !== null
            ? `确认后创建「${newProjectName}」并使用此风格；取消不会新增项目。`
            : "此风格用于项目内所有面板；已有图片会保留。"
          : "选择默认风格，或上传参考图并补充风格描述。"
      }
      onClose={onClose}
      wide
      closeDisabled={busy || previewing}
      scrollResetKey={draft?.sha256 ?? "selection"}
    >
      {draft ? (
        <>
          <div className="modal-body draft-layout">
            <div>
              {(preview?.image || draft.references.length > 0) && (
                <img
                  key={preview?.image ?? draft.sha256}
                  className="draft-image"
                  src={
                    preview?.image ??
                    (newProjectName === null
                      ? `${projectPath(project.id)}/image?kind=style&style=${draft.sha256}`
                      : `/api/project-drafts/${draftId}/image`)
                  }
                  onLoad={() => {
                    if (preview?.image) setPreviewReady(true);
                  }}
                  onError={() => {
                    if (preview?.image) {
                      setPreviewReady(false);
                      setStyleError(
                        "新风格预览加载失败，请读取生成结果后再确认。",
                      );
                    }
                  }}
                  alt={
                    preview?.image
                      ? "按补充要求生成的新风格预览，待确认采用"
                      : draft.resolution
                        ? "原始风格参考图，最终以合并后的规则为准"
                        : "待确认的风格参考图"
                  }
                />
              )}
              {(preview?.image ||
                (draft.resolution && draft.references.length > 0)) && (
                <p className="style-reference-note">
                  {preview?.image
                    ? "新风格预览 · 请检查布局、风格与文案。需要修改请点「返回调整」；确认后作为项目共用参考，原始样本保留。"
                    : "原始风格参考，供对照；可按补充后的完整规则生成新预览。"}
                </p>
              )}
              {(requiresPreview || preview) &&
                draft.kind === "ui_reference_style_v2" &&
                (!preview?.image || styleError) && (
                  <div className="style-preview-actions">
                    {!preview?.image && (
                      <>
                        <Button
                          icon={previewing ? "loading" : "spark"}
                          disabled={
                            busy ||
                            previewing ||
                            preview?.active ||
                            preview?.unavailable
                          }
                          onClick={generatePreview}
                        >
                          {previewing ? "正在生成风格预览…" : "重试生成预览"}
                        </Button>
                        <small>
                          预览未完成，可重试一次，或返回调整要求后再生成。
                        </small>
                      </>
                    )}
                    {previewing && (
                      <p
                        className="style-resolution-progress"
                        role="status"
                        aria-live="polite"
                      >
                        正在准备并生成风格预览 · 已等待 {previewSeconds} 秒
                        <br />
                        生成完成后会自动展示，请稍候。
                      </p>
                    )}
                    {preview && !previewing && !preview.image && (
                      <Button disabled={busy} onClick={readPreview}>
                        读取生成结果
                      </Button>
                    )}
                    {styleError && (
                      <p className="style-resolution-error" role="alert">
                        {styleError}
                      </p>
                    )}
                  </div>
                )}
              <h3>{draft.pack?.metadata.name ?? "自定义参考图风格"}</h3>
              <Swatches palette={draft.rules.palette} />
              {draft.resolution && (
                <dl className="style-palette">
                  {[
                    "background",
                    "surface",
                    "primary",
                    "secondary",
                    "text",
                  ].map((key) => (
                    <div key={key}>
                      <dt>
                        {
                          {
                            background: "背景",
                            surface: "面板",
                            primary: "主色",
                            secondary: "辅色",
                            text: "文字",
                          }[key]
                        }
                      </dt>
                      <dd>
                        <span
                          style={{ background: draft.rules.palette[key] }}
                        />
                        {draft.rules.palette[key]}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              <Hash label="风格修订摘要" value={draft.sha256} />
            </div>
            <div className="rules">
              {draft.resolution && (
                <div className="style-resolution-summary">
                  <strong>已合并补充要求</strong>
                  <p>{draft.resolution.summary}</p>
                  <small>已调整：{draft.resolution.changes.join("、")}</small>
                </div>
              )}
              {draft.resolution ? (
                <>
                  <div>
                    <strong>配色效果</strong>
                    <p>{draft.pack.render_style.color}</p>
                  </div>
                  <details className="style-final-rules">
                    <summary>查看完整规则（含限制规则）</summary>
                    <StyleRules draft={draft} />
                  </details>
                </>
              ) : (
                <StyleRules draft={draft} />
              )}
              {draft.notes && (
                <div>
                  <strong>
                    {draft.resolution ? "原始补充（已合并）" : "项目补充"}
                  </strong>
                  <p>{draft.notes}</p>
                </div>
              )}
            </div>
          </div>
          <div className="modal-footer">
            <Button
              disabled={
                busy || previewing || preview?.active || preview?.unavailable
              }
              onClick={() => {
                setDraft(null);
                setPreview(null);
                setStyleError(null);
              }}
            >
              返回调整
            </Button>
            {newProjectName !== null && (
              <Button disabled={busy} onClick={onClose}>
                取消
              </Button>
            )}
            <Button
              variant="primary"
              disabled={
                busy ||
                previewing ||
                preview?.active ||
                preview?.unavailable ||
                (requiresPreview && !preview?.image) ||
                (preview?.image && !previewReady)
              }
              onClick={activate}
            >
              {preview?.image
                ? newProjectName === null
                  ? "确认新图并使用此风格"
                  : "确认新图并创建项目"
                : newProjectName === null
                  ? "确认使用此风格"
                  : "确认风格并创建项目"}
            </Button>
          </div>
        </>
      ) : (
        <form onSubmit={prepare}>
          <div className="modal-body">
            <StyleLibrary
              compact
              disabled={busy}
              presets={presets}
              selected={mode === "default" ? selected : null}
              customSelected={mode === "custom"}
              onSelect={(preset) => {
                setMode("default");
                setSelected(preset.id);
                setReference(null);
              }}
              onCustom={() => setMode("custom")}
            />
            {mode === "custom" && (
              <div className="custom-style">
                <Field
                  label="风格参考图（可选）"
                  hint={
                    reference
                      ? `已暂存：${reference.name}；可重新选择替换。`
                      : "PNG，最大 20 MiB；参考图和风格描述至少提供一项，不混入默认风格。"
                  }
                >
                  <input
                    type="file"
                    accept="image/png"
                    disabled={busy}
                    onChange={(event) =>
                      setReference(event.target.files[0] ?? null)
                    }
                  />
                </Field>
              </div>
            )}
            <Field
              label={
                mode === "custom" ? "风格描述（可选）" : "项目风格补充（可选）"
              }
              hint="填写后，点击确认会整理配色、材质和光影等要求，并直接生成 1 张风格预览；看图确认后应用到整个项目。"
            >
              <textarea
                rows={3}
                maxLength={8000}
                disabled={busy}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder={
                  mode === "custom"
                    ? "例如：浅色木质界面、圆润按钮、柔和的绿色，整体轻松清晰"
                    : "例如：按钮更克制，强调清晰的主次层级"
                }
              />
            </Field>
            {resolving && (
              <p
                className="style-resolution-progress"
                role="status"
                aria-live="polite"
              >
                正在整理项目风格：合并配色、材质、光影和限制规则，请稍候…
              </p>
            )}
            {previewing && (
              <p
                className="style-resolution-progress"
                role="status"
                aria-live="polite"
              >
                正在生成风格预览 · 已等待 {previewSeconds} 秒<br />
                生成完成后直接展示新图，供你确认采用。
              </p>
            )}
            {styleError && (
              <p className="style-resolution-error" role="alert">
                {styleError}
              </p>
            )}
          </div>
          <div className="modal-footer">
            <span className="footer-note">
              {requiresPreview
                ? "本次确认会整理风格并生成 1 张预览，不自动重试；看图确认后才应用。"
                : "直接使用默认风格；最终确认后才应用到项目。"}
            </span>
            <Button type="button" disabled={busy} onClick={onClose}>
              取消
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={
                busy || (mode === "custom" && !reference && !notes.trim())
              }
              icon={resolving || previewing ? "loading" : undefined}
            >
              {resolving
                ? "正在整理风格…"
                : previewing
                  ? "正在生成风格预览…"
                  : requiresPreview
                    ? "确认并生成预览"
                    : "确认"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
export function ImportDialog({
  project,
  templates,
  perform,
  onRefresh,
  onClose,
  onImported,
  busy,
}) {
  const [mode, setMode] = useState("upload"),
    [template, setTemplate] = useState(templates[0]?.id),
    [file, setFile] = useState(null),
    [input, setInput] = useState(null),
    [catalog, setCatalog] = useState(null),
    [preview, setPreview] = useState(null);
  const selectedTemplate = templates.find((item) => item.id === template);
  const templateGroups = [
    ...new Map(templates.map((item) => [item.group ?? item.id, item])).keys(),
  ].map((group) => {
    const variants = templates.filter(
      (item) => (item.group ?? item.id) === group,
    );
    return {
      group,
      variants,
      item: variants.find((item) => item.id === template) ?? variants[0],
    };
  });
  const selectedVariants =
    templateGroups.find(
      ({ group }) =>
        group === (selectedTemplate?.group ?? selectedTemplate?.id),
    )?.variants ?? [];
  useEffect(() => {
    if (!file) return;
    let active = true;
    fileJson(file)
      .then((document) => {
        const kind = panelInputKind(document);
        if (active) setInput({ document, kind });
      })
      .catch((error) => {
        if (active) setInput({ error: errorText(error) });
      });
    return () => {
      active = false;
    };
  }, [file]);
  async function submit(event) {
    event.preventDefault();
    if (mode === "upload" && !input?.kind) return;
    await perform(async () => {
      const result = await request(
        `${projectPath(project.id)}/import`,
        mode === "template"
          ? { template }
          : input.kind === "bundle"
            ? {
                bundle: input.document,
                ...(preview ? { preview: await fileBase64(preview) } : {}),
              }
            : {
                spec: input.document,
                ...(catalog ? { catalog: await fileJson(catalog) } : {}),
                ...(preview ? { preview: await fileBase64(preview) } : {}),
              },
      );
      await onRefresh();
      if (onImported) onImported(result.panelId);
      else onClose();
      return result;
    });
  }
  return (
    <Modal
      title="导入面板原型"
      subtitle="上传 ui-panel-harness 导出的原型文件，也可以使用示例开始体验。"
      wide
      onClose={onClose}
      closeDisabled={busy}
    >
      <form onSubmit={submit}>
        <div className="modal-body">
          <div className="mode-tabs">
            {[
              ["upload", "上传面板原型"],
              ["template", "示例原型"],
            ].map(([id, name]) => (
              <button
                key={id}
                type="button"
                className={mode === id ? "active" : ""}
                disabled={busy}
                onClick={() => {
                  if (mode !== id) {
                    setMode(id);
                    setFile(null);
                    setInput(null);
                    setCatalog(null);
                    setPreview(null);
                  }
                }}
              >
                {name}
              </button>
            ))}
          </div>
          {mode === "template" ? (
            <div className="template-picker">
              <div
                className="template-list"
                role="group"
                aria-label="示例面板类型"
              >
                {templateGroups.map(({ group, variants, item }) => (
                  <label
                    key={group}
                    className={selectedVariants.includes(item) ? "chosen" : ""}
                  >
                    <input
                      type="radio"
                      name="template-group"
                      checked={selectedVariants.includes(item)}
                      disabled={busy}
                      onChange={() => setTemplate(item.id)}
                    />
                    <img
                      className="template-thumbnail"
                      src={item.image}
                      alt={`${item.name}原型缩略图`}
                    />
                    <span>
                      <strong>{item.groupName ?? item.name}</strong>
                      <small>
                        {variants.length > 1
                          ? `${variants.length} 种状态`
                          : "默认原型"}{" "}
                        · {item.width} × {item.height}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
              {selectedTemplate && (
                <div className="template-detail">
                  {selectedVariants.length > 1 && (
                    <fieldset className="template-variants" disabled={busy}>
                      <legend>示例状态</legend>
                      {selectedVariants.map((item) => (
                        <label
                          key={item.id}
                          className={template === item.id ? "chosen" : ""}
                        >
                          <input
                            type="radio"
                            name="template-variant"
                            checked={template === item.id}
                            onChange={() => setTemplate(item.id)}
                          />
                          {item.variant}
                        </label>
                      ))}
                    </fieldset>
                  )}
                  <figure className="template-preview">
                    <img
                      src={selectedTemplate.image}
                      alt={`${selectedTemplate.name}原型预览`}
                    />
                    <figcaption>
                      {selectedTemplate.name} · 原型布局示意
                      <span className="template-description">
                        {selectedTemplate.description}
                      </span>
                    </figcaption>
                  </figure>
                </div>
              )}
            </div>
          ) : (
            <div className="prototype-upload" key={mode}>
              <Field
                label="面板原型文件"
                hint="支持原型 JSON，最大 20 MiB；系统会自动识别文件格式。"
              >
                <input
                  type="file"
                  className="prototype-file-input"
                  required
                  accept=".json,application/json"
                  disabled={busy}
                  onChange={(event) => {
                    setInput(null);
                    setCatalog(null);
                    setFile(event.target.files[0] ?? null);
                  }}
                />
              </Field>
              {file && (
                <p
                  className={`import-file-status ${input?.error ? "error" : ""}`}
                  role={input?.error ? "alert" : "status"}
                >
                  {input?.error ??
                    (input?.kind === "bundle"
                      ? "已识别完整原型交付，可直接导入。"
                      : input?.kind === "spec"
                        ? "已识别面板规格；可直接使用内置控件目录，或补充配套目录。"
                        : "正在读取原型文件…")}
                </p>
              )}
              {input?.kind === "spec" && (
                <Field
                  label="控件目录 JSON（可选）"
                  hint="省略时使用公开 modern-controls 目录。"
                >
                  <input
                    type="file"
                    accept=".json,application/json"
                    disabled={busy}
                    onChange={(event) => setCatalog(event.target.files[0])}
                  />
                </Field>
              )}
              <Field label="原型截图（可选）">
                <input
                  type="file"
                  accept="image/png"
                  disabled={busy}
                  onChange={(event) => setPreview(event.target.files[0])}
                />
              </Field>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <Button type="button" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={
              busy || (mode === "upload" ? !input?.kind : !selectedTemplate)
            }
          >
            导入原型
          </Button>
        </div>
      </form>
    </Modal>
  );
}

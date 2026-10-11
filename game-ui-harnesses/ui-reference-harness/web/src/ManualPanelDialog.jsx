import React, { useEffect, useState } from "react";
import {
  Button,
  Field,
  Hash,
  Icon,
  Modal,
  ReviewImageStatus,
  useReviewImage,
} from "./ui.jsx";
import {
  download,
  errorText,
  fileBase64,
  labels,
  mutateAndRefresh,
  projectPath,
  request,
  runPath,
} from "./api.js";

export function PanelDialog({
  project,
  panel,
  generationMode,
  generation,
  perform,
  onRefresh,
  onClose,
  busy,
}) {
  const [preview, setPreview] = useState(
      panel.image ? "reference" : "prototype",
    ),
    [run, setRun] = useState(panel.latestRun?.run ?? null);
  const [details, setDetails] = useState(null),
    [note, setNote] = useState(""),
    [resolution, setResolution] = useState("native");
  const [showApproval, setShowApproval] = useState(false),
    [consent, setConsent] = useState(false),
    [resultFile, setResultFile] = useState(null);
  const [notSubmitted, setNotSubmitted] = useState(false);
  const [review, setReview] = useState({ layout: "", style: "", copy: "" }),
    [reviewNote, setReviewNote] = useState(""),
    [anchor, setAnchor] = useState(false);
  const [runError, setRunError] = useState(null),
    [loadingRun, setLoadingRun] = useState(!!run),
    [readVersion, setReadVersion] = useState(0);
  useEffect(() => {
    if (panel.latestRun?.run) setRun(panel.latestRun.run);
  }, [panel.latestRun?.run]);
  useEffect(() => {
    let alive = true;
    setDetails(null);
    setRunError(null);
    setLoadingRun(!!run);
    if (run)
      request(runPath(project.id, run))
        .then((value) => {
          if (alive) setDetails(value);
        })
        .catch((error) => {
          if (alive) setRunError(error);
        })
        .finally(() => {
          if (alive) setLoadingRun(false);
        });
    return () => {
      alive = false;
    };
  }, [project.id, run, panel.latestRun?.status, readVersion]);
  useEffect(() => {
    setConsent(false);
    setShowApproval(false);
    setResultFile(null);
    setNotSubmitted(false);
    setReview({ layout: "", style: "", copy: "" });
    setReviewNote("");
    setAnchor(false);
  }, [run]);
  const matching = details?.state.run === run ? details : null;
  const state = matching?.state,
    plan = matching?.plan;
  const current =
    plan?.styleSha256 === project.activeStyle &&
    plan?.prototype.sha256 === panel.prototypeSha256;
  const displayedImage =
    preview === "reference" && panel.image ? panel.image : panel.prototypeImage;
  const reviewImage = useReviewImage(displayedImage);
  async function refreshRun() {
    const value = await request(runPath(project.id, run));
    setDetails(value);
    await onRefresh();
    return value;
  }
  async function prepare() {
    const value = await perform(async () => {
      const prepared = await request(`${projectPath(project.id)}/plan`, {
        panelId: panel.panelId,
        note,
        resolution,
        ...(run ? { parentRun: run } : {}),
      });
      setRun(prepared.run);
      setDetails(await request(runPath(project.id, prepared.run)));
      await onRefresh();
      return prepared;
    });
    if (value) {
      setShowApproval(true);
      setConsent(false);
    }
  }
  async function action(name, payload = {}) {
    const value = await perform(() =>
      mutateAndRefresh(
        () => request(`${runPath(project.id, run)}/${name}`, payload),
        refreshRun,
      ),
    );
    if (
      value &&
      ["receive", "generate", "dispatch-reserved", "finish"].includes(name)
    )
      setPreview("reference");
    return value;
  }
  async function authorize() {
    const value = await action("authorize", {
      planSha256: plan.sha256,
      approval: `已查看当前冻结计划与有序图片，授权此计划生成 1 张参考图，最多调用 1 次，不自动重试。计划摘要：${plan.sha256}`,
    });
    if (value) setShowApproval(false);
  }
  async function receive() {
    if (!resultFile) return;
    const value = await perform(() =>
      mutateAndRefresh(
        async () =>
          request(`${runPath(project.id, run)}/receive`, {
            requestSha256: state.requestSha256,
            image: await fileBase64(resultFile),
          }),
        refreshRun,
      ),
    );
    if (value) setPreview("reference");
  }
  async function submitReview(decision) {
    if (!reviewingResult || !reviewImage.isReady()) return;
    const value = await action("review", {
      imageSha256: state.imageSha256,
      ...review,
      decision,
      note: reviewNote,
      useAsAnchor: decision === "accept" && anchor,
    });
    if (value) {
      setReviewNote("");
      setAnchor(false);
    }
  }
  const canReview =
    Object.values(review).every(Boolean) && reviewNote.trim().length > 0;
  const allPass = Object.values(review).every((value) => value === "pass");
  const reviewingResult =
    preview === "reference" &&
    reviewImage.ready &&
    panel.displayRun === run &&
    panel.displayImageSha256 === state?.imageSha256;
  const finalState = [
    "accepted",
    "rejected_visual",
    "failed",
    "indeterminate",
    "rejected_technical",
  ].includes(state?.status);
  return (
    <Modal
      title={panel.title}
      subtitle={`${panel.canvas.width} × ${panel.canvas.height} 逻辑画布 · ${project.styleName}`}
      onClose={onClose}
      wide
      closeDisabled={busy}
    >
      <div className="panel-detail">
        <div className="detail-visual">
          <div className="mode-tabs">
            <button
              className={preview === "reference" ? "active" : ""}
              disabled={!panel.image}
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
          {generationMode === "adapter" && (
            <p className="muted" role="status">
              {generation?.name ?? "图片适配器"}
              {generation?.model
                ? ` · ${generation.model} / ${generation.effort}`
                : ""}
              {generation?.ready === false &&
                ` · ${errorText(new Error(generation.error))}`}
            </p>
          )}
          <div className="detail-image">
            <img
              key={displayedImage}
              src={displayedImage}
              {...reviewImage.props}
              alt={`${panel.title}${preview === "reference" ? "参考图" : "原型"}`}
            />
          </div>
          {preview === "reference" && panel.image && (
            <ReviewImageStatus
              image={reviewImage}
              reviewing={state?.status === "pending_visual_review"}
            />
          )}
          {panel.image && (
            <a
              className="image-download"
              href={panel.image}
              download={`${panel.panelId}.png`}
            >
              <Icon name="download" size={16} />
              下载参考图 PNG
            </a>
          )}
          {panel.isAnchor && (
            <p className="detail-anchor">
              <Icon name="anchor" size={17} />
              此图是当前项目的固定视觉锚点
            </p>
          )}
          {panel.image &&
            panel.acceptedRun &&
            panel.displayRun !== panel.acceptedRun && (
              <p className="muted">
                当前预览为最新尝试；整套导出使用该面板最近接受的版本。
              </p>
            )}
        </div>
        <div className="detail-controls">
          <div className="section-heading">
            <h3>制作与验收</h3>
            {state && (
              <span className="tag">
                {labels[state.status] ?? state.status}
              </span>
            )}
          </div>
          {project.readOnly ? (
            <div className="inline-note">
              <Icon name="info" />
              <p>
                这是已经验收的真实示例。可以查看原型、参考图和项目锚点；新建项目后即可制作自己的面板。
              </p>
            </div>
          ) : loadingRun ? (
            <p role="status">正在读取计划状态…</p>
          ) : runError ? (
            <>
              <p role="alert">{errorText(runError)}</p>
              <Button onClick={() => setReadVersion((value) => value + 1)}>
                重新读取状态
              </Button>
            </>
          ) : (
            <>
              {(!run || finalState || !current || !state?.executable) && (
                <>
                  <Field
                    label="面板补充（可选）"
                    hint="只强调已有元素；布局修改请先更新原型。"
                  >
                    <textarea
                      value={note}
                      maxLength={8000}
                      rows={3}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="例如：让主按钮更突出，保持整体克制"
                    />
                  </Field>
                  <Field label="输出分辨率">
                    <select
                      value={resolution}
                      onChange={(event) => setResolution(event.target.value)}
                    >
                      <option value="native">原生分辨率 · 保持原型比例</option>
                      <option value="exact">精确匹配原型尺寸</option>
                    </select>
                  </Field>
                  <Button
                    variant="primary"
                    icon="spark"
                    disabled={busy || !project.activeStyle}
                    onClick={prepare}
                  >
                    {state?.status === "accepted" && current
                      ? "准备优化计划"
                      : "准备生成计划"}
                  </Button>
                  {!project.activeStyle && (
                    <p className="muted">请先选择并确认项目风格。</p>
                  )}
                </>
              )}
              {current &&
                state?.executable &&
                state?.status === "awaiting_authorization" && (
                  <>
                    <p className="muted">
                      已冻结布局、风格与可选锚点，尚未提交生图。
                    </p>
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={() => setShowApproval(true)}
                    >
                      检查并授权计划
                    </Button>
                  </>
                )}
              {current &&
                state?.executable &&
                state?.status === "authorized" && (
                  <>
                    <p className="muted">此计划已获授权，最多提交一次。</p>
                    <Button
                      variant="primary"
                      icon="spark"
                      disabled={busy || generation?.ready === false}
                      onClick={() =>
                        action(
                          generationMode === "adapter" ? "generate" : "request",
                        )
                      }
                    >
                      {busy && generationMode === "adapter"
                        ? "正在生成参考图…"
                        : generationMode === "adapter"
                          ? "生成 1 张参考图"
                          : "准备生成输入包"}
                    </Button>
                  </>
                )}
              {[
                "failed",
                "indeterminate",
                "rejected_technical",
                "rejected_visual",
              ].includes(state?.status) && (
                <p className="muted">
                  本次尝试已结束，不能再次提交或替换结果。需要调整时，请准备新的计划并重新决定。
                </p>
              )}
              {state &&
                !state.executable &&
                [
                  "awaiting_authorization",
                  "authorized",
                  "reserved_no_resubmit",
                  "raw_received_needs_finish",
                ].includes(state.status) && (
                  <p className="muted" role="status">
                    此任务来自旧版服务，当前仅可查看记录。完成原任务需使用生成时的服务版本；新生成请创建新计划。
                  </p>
                )}
              {state?.executable &&
                state.status === "raw_received_needs_finish" && (
                  <>
                    <p className="muted">
                      原始图片已保存，可以对同一份字节完成本地处理，不会再次生图。
                    </p>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        action("finish", { rawSha256: state.rawSha256 })
                      }
                    >
                      完成本地处理
                    </Button>
                  </>
                )}
              {state?.executable && state.status === "reserved_no_resubmit" && (
                <div className="result-intake">
                  {matching.execution?.active ? (
                    <p role="status">
                      正在生成参考图，结果返回后会自动保存并检查。
                    </p>
                  ) : generationMode === "adapter" &&
                    !matching.execution?.dispatched ? (
                    <>
                      <p className="muted">
                        此前仅准备了输入包。确认尚未交给其他图片工具后，可由当前适配器生成一次。
                      </p>
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={notSubmitted}
                          disabled={busy}
                          onChange={(event) =>
                            setNotSubmitted(event.target.checked)
                          }
                        />
                        <span>此输入包尚未向其他图片工具提交</span>
                      </label>
                      <Button
                        variant="primary"
                        icon="spark"
                        disabled={
                          busy || !notSubmitted || generation?.ready === false
                        }
                        onClick={() =>
                          action("dispatch-reserved", {
                            requestSha256: state.requestSha256,
                            notSubmitted,
                          })
                        }
                      >
                        {busy ? "正在生成参考图…" : "生成 1 张参考图"}
                      </Button>
                    </>
                  ) : (
                    <p className="muted">
                      {matching.execution?.dispatched
                        ? "本次请求已提交，不能再次生图。如果已有返回的 PNG，可导入保存；结果未知时请终止此尝试。"
                        : "输入包已准备。将其交给图片工具生成一次，再导入返回的 PNG。"}
                    </p>
                  )}
                  {!matching.execution?.active && (
                    <>
                      <Button
                        icon="download"
                        onClick={() =>
                          download(`${runPath(project.id, run)}/exchange`)
                        }
                      >
                        下载生成输入包
                      </Button>
                      <Field label="生成结果 PNG">
                        <input
                          type="file"
                          accept="image/png"
                          onChange={(event) =>
                            setResultFile(event.target.files[0] ?? null)
                          }
                        />
                      </Field>
                      <Button
                        variant="primary"
                        disabled={busy || !resultFile}
                        onClick={receive}
                      >
                        导入并检查结果
                      </Button>
                      <button
                        className="text-button subtle"
                        disabled={busy}
                        onClick={() =>
                          action("stop", {
                            requestSha256: state.requestSha256,
                            outcome: "indeterminate",
                          })
                        }
                      >
                        外部结果未知，终止此尝试
                      </button>
                    </>
                  )}
                </div>
              )}
              {current && state?.status === "pending_visual_review" && (
                <div className="review-form">
                  <p className="muted">
                    技术检查已通过。请查看图片，分别判断以下三项。
                  </p>
                  {!reviewingResult && (
                    <p role="alert">
                      请切换到本次参考图后验收；如图片未更新，请关闭后重新打开面板。
                    </p>
                  )}
                  {[
                    ["layout", "布局与面板结构"],
                    ["style", "项目风格一致性"],
                    ["copy", "可见文案"],
                  ].map(([key, label]) => (
                    <Field key={key} label={label}>
                      <select
                        aria-label={label}
                        value={review[key]}
                        onChange={(event) =>
                          setReview({ ...review, [key]: event.target.value })
                        }
                      >
                        <option value="">请选择验收结果</option>
                        <option value="pass">通过</option>
                        <option value="fail">未通过</option>
                      </select>
                    </Field>
                  ))}
                  <Field label="验收意见">
                    <textarea
                      required
                      rows={2}
                      maxLength={2000}
                      value={reviewNote}
                      onChange={(event) => setReviewNote(event.target.value)}
                      placeholder="记录你对这张参考图的实际意见"
                    />
                  </Field>
                  {!project.anchor && (
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={anchor}
                        onChange={(event) => setAnchor(event.target.checked)}
                      />
                      <span>接受后设为项目视觉锚点</span>
                    </label>
                  )}
                  <div className="actions">
                    <Button
                      disabled={busy || !canReview || !reviewingResult}
                      onClick={() => submitReview("reject")}
                    >
                      不接受
                    </Button>
                    <Button
                      variant="primary"
                      disabled={
                        busy || !canReview || !allPass || !reviewingResult
                      }
                      onClick={() => submitReview("accept")}
                    >
                      接受参考图
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
          {state?.imageSha256 && (
            <Hash label="当前结果摘要" value={state.imageSha256} />
          )}
          {plan && (
            <details className="plan-details">
              <summary>查看完整冻结计划</summary>
              <Hash label="计划摘要" value={plan.sha256} />
              <pre>{JSON.stringify(plan.request, null, 2)}</pre>
            </details>
          )}
        </div>
      </div>
      {showApproval && current && (
        <section className="approval-section">
          <h3>确认这一次生成</h3>
          <p>
            输出 1 张不透明 PNG，最多调用 1 次；不自动重试。
            {generationMode === "host-exchange"
              ? "当前通过输入包与外部图片工具交换。"
              : "通过本地已配置的适配器提交。"}
          </p>
          <Hash label="本次计划摘要" value={plan.sha256} />
          <div className="request-images">
            {plan.request.images.map((image, index) => (
              <div key={`${image.role}-${index}`}>
                <strong>
                  {index + 1}.{" "}
                  {{
                    "layout-reference": "面板布局",
                    "primary-style": "主风格参考",
                    "accepted-project-anchor": "已接受项目锚点",
                    "original-prototype-context": "原型截图",
                    "preset-palette-guide": "配色指导板",
                  }[image.role] ?? image.role}
                </strong>
                <img
                  src={`${runPath(project.id, run)}/input?index=${index}`}
                  alt={image.role}
                />
                <code>{image.artifact.sha256}</code>
              </div>
            ))}
          </div>
          <details open>
            <summary>冻结提示词与输出要求</summary>
            <pre className="frozen-prompt">{plan.request.prompt}</pre>
            <p>
              {plan.request.width} × {plan.request.height} 逻辑画布 ·{" "}
              {plan.request.resolution.mode} 分辨率策略
            </p>
          </details>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>我已查看冻结计划，授权此计划生成 1 张参考图。</span>
          </label>
          <div className="actions">
            <Button
              disabled={busy}
              onClick={() => {
                setShowApproval(false);
                setConsent(false);
              }}
            >
              暂不授权
            </Button>
            <Button
              variant="primary"
              disabled={busy || !consent}
              onClick={authorize}
            >
              确认授权这一次生成
            </Button>
          </div>
        </section>
      )}
      <div className="modal-footer">
        <span className="footer-note">
          风格与图片验收分别记录，技术检查不会代替视觉验收。
        </span>
        <Button disabled={busy} onClick={onClose}>
          关闭
        </Button>
      </div>
    </Modal>
  );
}
export function BatchDialog({ batch, project, onClose, onPanel }) {
  return (
    <Modal
      title="待生成面板计划已准备"
      subtitle="每份计划继承同一项目风格与已接受锚点；尚未授权或提交生图。"
      onClose={onClose}
      wide
    >
      <div className="modal-body">
        <Hash label="计划集合摘要" value={batch.sha256} />
        <div className="batch-list">
          {batch.plans.map((plan) => (
            <div key={plan.run}>
              <div>
                <strong>
                  {project.panels.find(
                    (panel) => panel.panelId === plan.panelId,
                  )?.title ?? plan.panelId}
                </strong>
                <code>{plan.planSha256}</code>
              </div>
              <Button onClick={() => onPanel(plan.panelId)}>查看计划</Button>
            </div>
          ))}
        </div>
        <p className="muted">
          共 {batch.maximumCalls}{" "}
          份计划，每份最多生成一次。进入面板详情检查具体请求，再明确授权。
        </p>
      </div>
      <div className="modal-footer">
        <Button onClick={onClose}>关闭</Button>
      </div>
    </Modal>
  );
}

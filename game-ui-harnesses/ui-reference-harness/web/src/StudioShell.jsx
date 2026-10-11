import React, { useState } from "react";
import { Brand, Button, Empty, Icon, Swatches } from "./ui.jsx";
import { labels, panelActionLabel, panelStatus } from "./api.js";

export function Sidebar({
  projects,
  trashCount = 0,
  selected,
  page,
  onPage,
  onSelect,
  onCreate,
  busy = false,
  ready = true,
}) {
  return (
    <aside className="sidebar">
      <Brand />
      <Button icon="plus" disabled={busy || !ready} onClick={onCreate}>
        新建项目
      </Button>
      <nav aria-label="工作台导航">
        <button
          className={page === "panels" ? "selected" : ""}
          disabled={busy}
          onClick={() => onPage("panels")}
        >
          <Icon name="layers" />
          面板参考图
        </button>
        <button
          className={page === "trash" ? "selected" : ""}
          disabled={busy || !ready}
          onClick={() => onPage("trash")}
        >
          <Icon name="trash" />
          <span>回收站{trashCount ? `（${trashCount}）` : ""}</span>
        </button>
      </nav>
      <div className="project-label">
        我的项目
        <span />
      </div>
      <div className="project-list">
        {projects.map((project) => (
          <button
            key={project.id}
            disabled={busy}
            className={`project-item ${project.id === selected ? "selected" : ""}`}
            onClick={() => onSelect(project.id)}
          >
            <Icon name="folder" />
            <span>
              <strong>{project.name}</strong>
              <small>
                {project.error
                  ? "读取失败"
                  : `${project.panelCount} 个面板${project.readOnly ? " · 示例" : ""}`}
              </small>
            </span>
          </button>
        ))}
      </div>
      <div className="local-status">
        <i />
        本地工作台
      </div>
    </aside>
  );
}
export function TrashList({ projects, busy, onRestore }) {
  if (!projects.length)
    return (
      <Empty title="回收站是空的">
        删除的项目会保留在这里，原型、图片和生成记录都可恢复。
      </Empty>
    );
  return (
    <section className="trash-list" aria-label="已删除项目">
      {projects.map((project) => (
        <article className="trash-item" key={project.id}>
          <Icon name="folder" />
          <div>
            <h3>{project.name}</h3>
            <p>
              删除于{" "}
              {new Date(project.deletedAt).toLocaleString("zh-CN", {
                hour12: false,
              })}
            </p>
          </div>
          <Button
            icon="restore"
            disabled={busy}
            onClick={() => onRestore(project)}
            aria-label={`恢复项目 ${project.name}`}
          >
            恢复项目
          </Button>
        </article>
      ))}
    </section>
  );
}
export function Inspector({ project, onStyle, onAnchor, busy = false }) {
  return (
    <aside className="inspector">
      <div className="section-heading">
        <h3>项目风格</h3>
        <button
          className="text-button"
          disabled={busy || project.readOnly}
          onClick={onStyle}
        >
          更换风格
        </button>
      </div>
      <h2 className="style-name">{project.styleName}</h2>
      <p className="muted">
        {project.style?.pack?.metadata.id === "concept-art"
          ? "中性 2D 游戏风格 · 干净易读"
          : project.activeStyle
            ? "项目内所有面板共用此风格"
            : "先选择一个统一的视觉方向"}
      </p>
      {project.styleImage ? (
        <>
          <h4>风格参考</h4>
          <img
            className="inspector-image"
            src={project.styleImage}
            alt="已冻结的项目主风格参考图"
          />
        </>
      ) : (
        <div className="rule-only">
          <Icon name="palette" />
          <span>
            {project.activeStyle
              ? "规则风格 · 尚无主参考图"
              : "可选择默认风格，或上传参考图"}
          </span>
        </div>
      )}
      <Swatches palette={project.style?.rules.palette} />
      <div className="inspector-divider" />
      <h3>项目锚点</h3>
      {project.anchor ? (
        <>
          <img
            className="inspector-image"
            src={project.anchor.image}
            alt="本项目已接受的视觉锚点"
          />
          <h4>{project.anchor.title}</h4>
          <p className="muted">后续面板沿用此视觉锚点</p>
          <Button disabled={busy} onClick={onAnchor}>
            查看锚点
          </Button>
        </>
      ) : (
        <div className="anchor-empty">
          <Icon name="anchor" size={28} />
          <p>
            首张参考图验收后
            <br />
            可设为项目视觉锚点
          </p>
        </div>
      )}
      <div className="inspector-note">
        <Icon name="info" size={17} />
        <span>修改风格会保留旧图，并标记需要更新的面板。</span>
      </div>
    </aside>
  );
}
export function Panels({
  project,
  busy,
  panelMutation,
  onImport,
  onPanel,
  onDelete,
  onRestore,
}) {
  const [filter, setFilter] = useState("all");
  const deleted = filter === "deleted";
  const panels = (deleted ? (project.deletedPanels ?? []) : project.panels)
    .toSorted(
      (a, b) =>
        Number(b.isAnchor) - Number(a.isAnchor) ||
        (a.latestRun?.created ?? 0) - (b.latestRun?.created ?? 0),
    )
    .filter(
      (panel) =>
        deleted ||
        filter === "all" ||
        (filter === "accepted"
          ? ["accepted", "accepted_current_style"].includes(panelStatus(panel))
          : filter === "review"
            ? panelStatus(panel) === "pending_visual_review"
            : [
                "needs_generation",
                "needs_style_update",
                "awaiting_authorization",
                "authorized",
                "reserved_no_resubmit",
                "raw_received_needs_finish",
                "rejected_visual",
                "rejected_technical",
                "indeterminate",
                "failed",
              ].includes(panelStatus(panel))),
    );
  return (
    <>
      <div className="gallery-heading">
        <h2>面板参考图</h2>
      </div>
      <div className="tabs" role="tablist" aria-label="面板状态筛选">
        {[
          ["all", "全部面板"],
          ["pending", "待生成"],
          ["review", "待验收"],
          ["accepted", "已接受"],
          ...(!project.readOnly
            ? [["deleted", `已删除（${project.deletedPanels?.length ?? 0}）`]]
            : []),
        ].map(([id, title]) => (
          <button
            key={id}
            role="tab"
            aria-selected={id === filter}
            className={filter === id ? "active" : ""}
            onClick={() => setFilter(id)}
          >
            {title}
          </button>
        ))}
      </div>
      {!deleted && !project.panels.length ? (
        <Empty
          title="从第一个面板开始"
          action={
            !project.readOnly && (
              <Button
                icon="plus"
                variant="primary"
                disabled={busy}
                onClick={onImport}
              >
                导入第一个面板原型
              </Button>
            )
          }
        >
          导入 ui-panel 原型，按项目统一风格制作参考图。
          {!project.activeStyle && (
            <>
              <br />
              先在右侧选择项目风格。
            </>
          )}
        </Empty>
      ) : !panels.length ? (
        <Empty title={deleted ? "没有已删除的面板" : "这里暂时没有面板"}>
          {deleted
            ? "删除的面板会保留在这里，可以随时恢复。"
            : "切换筛选查看其他面板。"}
        </Empty>
      ) : (
        <div className="panel-grid">
          {panels.map((panel) => (
            <article className="panel-card" key={panel.panelId}>
              <button
                className="panel-preview"
                disabled={busy || deleted}
                onClick={() => onPanel(panel)}
                aria-label={`查看${panel.title}`}
              >
                <img
                  src={panel.image ?? panel.prototypeImage}
                  alt={`${panel.title}${panel.image ? "参考图" : "布局原型"}`}
                />
                {!panel.image && (
                  <span className="prototype-label">面板原型</span>
                )}
              </button>
              <div className="panel-meta">
                <div>
                  <h3>{panel.title}</h3>
                  <div className="panel-tags">
                    {panel.isAnchor && (
                      <span className="tag anchor">
                        <Icon name="anchor" size={14} />
                        项目锚点
                      </span>
                    )}
                    <span
                      className={`tag ${["accepted", "accepted_current_style"].includes(panelStatus(panel)) ? "accepted" : "pending"}`}
                    >
                      <Icon
                        name={
                          ["accepted", "accepted_current_style"].includes(
                            panelStatus(panel),
                          )
                            ? "check"
                            : "info"
                        }
                        size={14}
                      />
                      {deleted
                        ? "已删除"
                        : (labels[panelStatus(panel)] ?? "待处理")}
                    </span>
                  </div>
                </div>
                <section
                  className="panel-card-actions"
                  aria-label={`${panel.title}操作`}
                >
                  {deleted ? (
                    <Button
                      icon="restore"
                      disabled={panelMutation}
                      onClick={() => onRestore(panel)}
                      aria-label={`恢复面板：${panel.title}`}
                    >
                      恢复
                    </Button>
                  ) : (
                    <>
                      <button
                        disabled={busy}
                        className="view-button"
                        onClick={() => onPanel(panel)}
                        aria-label={`${panelActionLabel(panel, project.readOnly)}：${panel.title}`}
                      >
                        {panelActionLabel(panel, project.readOnly)}
                        <Icon name="chevron" size={16} />
                      </button>
                      {!project.readOnly && (
                        <button
                          className="panel-delete-button"
                          disabled={panelMutation}
                          onClick={() => onDelete(panel)}
                          aria-label={`删除面板：${panel.title}`}
                          title="删除面板"
                        >
                          <Icon name="trash" size={16} />
                        </button>
                      )}
                    </>
                  )}
                </section>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
export function StyleLibrary({
  presets,
  onSelect,
  disabled = false,
  selected = null,
  compact = false,
  onCustom,
  customSelected = false,
}) {
  return (
    <div className={`style-grid ${compact ? "compact" : ""}`}>
      {presets.map((preset) => (
        <button
          type="button"
          key={preset.id}
          className={`style-card ${preset.id === selected ? "chosen" : ""}`}
          onClick={() => onSelect(preset)}
          disabled={disabled}
          aria-label={`选择${preset.name}`}
          aria-pressed={preset.id === selected}
        >
          {preset.sample?.url ? (
            <img src={preset.sample.url} alt={`${preset.name}已接受样本`} />
          ) : (
            <div className="preset-placeholder">
              <Swatches palette={preset.rules?.palette} />
              <span>规则预设</span>
            </div>
          )}
          <div>
            <strong>{preset.name}</strong>
            <small>
              {preset.sample?.status === "accepted"
                ? "已接受的默认样本"
                : "可添加风格参考图"}
              {preset.id === selected ? " · 已选择" : ""}
            </small>
          </div>
        </button>
      ))}
      {onCustom && (
        <button
          type="button"
          className={`style-card custom-option ${customSelected ? "chosen" : ""}`}
          disabled={disabled}
          onClick={onCustom}
          aria-label="选择自定义风格"
          aria-pressed={customSelected}
        >
          <div className="preset-placeholder">
            <Icon name="upload" size={32} />
            <span>你的风格</span>
          </div>
          <div>
            <strong>自定义风格</strong>
            <small>
              上传参考图，补充描述{customSelected ? " · 已选择" : ""}
            </small>
          </div>
        </button>
      )}
    </div>
  );
}

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button, Empty, Hash, Icon, Modal, Toast } from "./ui.jsx";
import { Inspector, Panels, Sidebar, TrashList } from "./StudioShell.jsx";
import {
  ImportDialog,
  NewProjectDialog,
  StyleDialog,
  DeleteProjectDialog,
  DeletePanelDialog,
} from "./ProjectDialogs.jsx";
import { PanelDialog } from "./PanelDialog.jsx";
import {
  download,
  errorText,
  mutateAndRefresh,
  projectPath,
  request,
} from "./api.js";

function closeMenuOnBlur(event) {
  if (!event.currentTarget.contains(event.relatedTarget))
    event.currentTarget.open = false;
}
function closeMenuOnEscape(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.currentTarget.open = false;
    event.currentTarget.querySelector("summary").focus();
  }
}

export default function App() {
  const [bootstrap, setBootstrap] = useState(null),
    [selected, setSelected] = useState(null),
    [project, setProject] = useState(null);
  const [page, setPage] = useState("panels"),
    [modal, setModal] = useState(null),
    [busy, setBusy] = useState(false),
    [toast, setToast] = useState(null);
  const [bootstrapLoading, setBootstrapLoading] = useState(true),
    [projectLoading, setProjectLoading] = useState(false);
  const loading = bootstrapLoading || projectLoading;
  const selectedRef = useRef(null),
    operationRef = useRef(false),
    exportOptionsRef = useRef(null),
    projectOptionsRef = useRef(null);
  const [reload, setReload] = useState(0);
  const [panelMutation, setPanelMutation] = useState(false);
  const panelMutationRef = useRef(false);
  const notify = useCallback(
    (text, error = false) => setToast({ text, error, key: Date.now() }),
    [],
  );
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.error ? 10000 : 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const refresh = useCallback(async (id = selectedRef.current) => {
    const next = await request("/api/bootstrap");
    setBootstrap(next);
    if (id) {
      const value = await request(projectPath(id));
      if (selectedRef.current === id) setProject(value);
      return value;
    }
  }, []);
  useEffect(() => {
    let alive = true;
    setBootstrapLoading(true);
    request("/api/bootstrap")
      .then((value) => {
        if (!alive) return;
        setBootstrap(value);
        let saved = null;
        try {
          saved = localStorage.getItem("ui-reference-project");
        } catch {}
        const id = value.projects.some((item) => item.id === saved)
          ? saved
          : (value.projects[0]?.id ?? null);
        selectedRef.current = id;
        setSelected(id);
      })
      .catch((error) => {
        if (alive) notify(errorText(error), true);
      })
      .finally(() => {
        if (alive) setBootstrapLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [notify, reload]);
  useEffect(() => {
    let alive = true;
    if (!selected) {
      setProject(null);
      setProjectLoading(false);
      return;
    }
    setProjectLoading(true);
    setProject(null);
    try {
      localStorage.setItem("ui-reference-project", selected);
    } catch {}
    request(projectPath(selected))
      .then((value) => {
        if (alive) setProject(value);
      })
      .catch((error) => {
        if (alive) notify(errorText(error), true);
      })
      .finally(() => {
        if (alive) setProjectLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [selected, notify, reload]);
  async function perform(fn) {
    if (operationRef.current) return null;
    operationRef.current = true;
    setBusy(true);
    try {
      return await fn();
    } catch (error) {
      notify(errorText(error), true);
      return null;
    } finally {
      operationRef.current = false;
      setBusy(false);
    }
  }
  function createProject(name) {
    setModal({ type: "new-style", name: name.trim() });
  }
  async function completeProject(value) {
    await refresh(value.id);
    selectedRef.current = value.id;
    setProject(value);
    setSelected(value.id);
    setModal(null);
    setPage("panels");
    notify("项目已创建，统一风格已确认。");
  }
  async function exportProject(format = "images") {
    if (exportOptionsRef.current) exportOptionsRef.current.open = false;
    const value = await perform(() =>
      request(`${projectPath(project.id)}/export`, { format }),
    );
    if (value) {
      download(value.download);
      notify(
        format === "complete"
          ? "完整交付包已通过校验，正在下载 ZIP。"
          : "参考图已通过校验，正在下载 PNG 图片包。",
      );
    }
  }
  async function syncProjectList(preferredId) {
    const next = await request("/api/bootstrap");
    setBootstrap(next);
    const id = next.projects.some((item) => item.id === preferredId)
      ? preferredId
      : (next.projects.find((item) => !item.error)?.id ??
        next.projects[0]?.id ??
        null);
    if (id !== selectedRef.current) setProject(null);
    selectedRef.current = id;
    setSelected(id);
    if (!id) {
      try {
        localStorage.removeItem("ui-reference-project");
      } catch {}
    }
    if (!id || next.projects.find((item) => item.id === id)?.error)
      setProject(null);
    else {
      const value = await request(projectPath(id));
      if (selectedRef.current === id) setProject(value);
    }
  }
  async function deleteProject(target) {
    const value = await perform(() =>
      mutateAndRefresh(
        () => request(`${projectPath(target.id)}/trash`, {}),
        () => syncProjectList(selectedRef.current),
      ),
    );
    if (value) {
      setModal(null);
      setPage("panels");
      notify(`「${target.name}」已移入回收站，可随时恢复。`);
    }
  }
  async function restoreProject(target) {
    const value = await perform(() =>
      mutateAndRefresh(
        () => request(`${projectPath(target.id)}/restore`, {}),
        () => syncProjectList(target.id),
      ),
    );
    if (value) {
      setPage("panels");
      notify(`「${target.name}」已恢复。`);
    }
  }
  async function changePanelVisibility(target, trashed) {
    if (panelMutationRef.current) return;
    panelMutationRef.current = true;
    setPanelMutation(true);
    const id = project.id;
    try {
      await mutateAndRefresh(
        () =>
          request(
            `${projectPath(id)}/panels/${target.panelId}/${trashed ? "trash" : "restore"}`,
            {},
          ),
        () => refresh(id),
      );
      setModal(null);
      notify(
        trashed
          ? `「${target.title}」已删除，可在“已删除”中恢复。`
          : `「${target.title}」已恢复。`,
      );
    } catch (error) {
      notify(errorText(error), true);
    } finally {
      panelMutationRef.current = false;
      setPanelMutation(false);
    }
  }
  const selectedPanel = modal?.panelId
    ? project?.panels.find((panel) => panel.panelId === modal.panelId)
    : null;
  const selectedMeta = bootstrap?.projects.find((item) => item.id === selected);
  const canExport =
    !busy &&
    !loading &&
    !!project?.panels.length &&
    project.panels.every((panel) => panel.status === "accepted_current_style");
  const pageName = page === "trash" ? "回收站" : (project?.name ?? "新建项目");
  return (
    <div
      className={`studio ${project && page !== "trash" ? "" : "no-project"}`}
    >
      <Sidebar
        projects={bootstrap?.projects ?? []}
        trashCount={bootstrap?.trash?.length ?? 0}
        selected={selected}
        page={page}
        busy={busy || loading}
        ready={!!bootstrap}
        onPage={(value) => {
          if (!operationRef.current) setPage(value);
        }}
        onSelect={(id) => {
          if (operationRef.current) return;
          if (id === selectedRef.current) {
            setPage("panels");
            setModal(null);
            return;
          }
          selectedRef.current = id;
          setProject(null);
          setSelected(id);
          setPage("panels");
          setModal(null);
        }}
        onCreate={() => {
          if (!operationRef.current && bootstrap) setModal({ type: "new" });
        }}
      />
      <main className="main">
        <div className="breadcrumb">
          <span>{page === "panels" ? "项目" : "工作台"}</span>
          <span>/</span>
          <span>{pageName}</span>
          {busy && (
            <span className="busy-indicator" role="status">
              <i />
              正在处理
            </span>
          )}
        </div>
        <header className="page-header">
          <div>
            <h1>
              {page !== "panels"
                ? pageName
                : (project?.name ?? "开始你的 UI 项目")}
            </h1>
            <p>
              {page === "trash"
                ? "已删除的项目保存在这里，恢复后可继续制作。"
                : "统一项目风格，让每个面板属于同一个游戏。"}
            </p>
          </div>
          {page === "panels" && selectedMeta && (
            <div className="actions project-actions">
              {!selectedMeta.readOnly && (
                <Button
                  icon="plus"
                  variant="primary"
                  disabled={busy || loading || !project}
                  onClick={() => setModal({ type: "import" })}
                >
                  导入面板原型
                </Button>
              )}
              <div className="export-actions">
                <Button
                  icon="download"
                  disabled={!canExport}
                  onClick={() => exportProject()}
                  title="下载各面板最近接受的 PNG，按面板名称命名"
                >
                  导出项目
                </Button>
                <details
                  key={selectedMeta.id}
                  className="export-options"
                  ref={exportOptionsRef}
                  onBlur={closeMenuOnBlur}
                  onKeyDown={closeMenuOnEscape}
                  onToggle={(event) => {
                    if (event.currentTarget.open && projectOptionsRef.current)
                      projectOptionsRef.current.open = false;
                  }}
                >
                  <summary
                    aria-label="更多导出选项"
                    aria-disabled={!canExport}
                    onClick={(event) => {
                      if (!canExport) event.preventDefault();
                    }}
                  >
                    <Icon name="chevron" size={18} />
                  </summary>
                  <div className="export-options-menu">
                    <Button
                      disabled={!canExport}
                      onClick={() => exportProject("complete")}
                    >
                      导出完整交付包
                    </Button>
                    <p>包含风格、原型、来源和校验记录。</p>
                  </div>
                </details>
              </div>
              {!selectedMeta.readOnly && (
                <details
                  key={selectedMeta.id}
                  className="project-options"
                  ref={projectOptionsRef}
                  onBlur={closeMenuOnBlur}
                  onKeyDown={closeMenuOnEscape}
                  onToggle={(event) => {
                    if (event.currentTarget.open && exportOptionsRef.current)
                      exportOptionsRef.current.open = false;
                  }}
                >
                  <summary
                    aria-label="项目更多操作"
                    aria-disabled={busy || loading}
                    onClick={(event) => {
                      if (busy || loading) event.preventDefault();
                    }}
                  >
                    <Icon name="more" size={20} />
                  </summary>
                  <div className="project-options-menu">
                    <Button
                      icon="trash"
                      disabled={busy || loading}
                      onClick={() => {
                        projectOptionsRef.current.open = false;
                        setModal({ type: "delete", target: selectedMeta });
                      }}
                    >
                      删除项目
                    </Button>
                    <p>移入回收站，之后可以恢复。</p>
                  </div>
                </details>
              )}
            </div>
          )}
        </header>
        {loading ? (
          <div className="loading" role="status">
            <i />
            正在读取项目与校验图片…
          </div>
        ) : !bootstrap ? (
          <Empty
            title="工作台读取失败"
            action={
              <Button onClick={() => setReload((value) => value + 1)}>
                重新读取
              </Button>
            }
          >
            请检查本地服务后重试。
          </Empty>
        ) : selected && !project && page !== "trash" ? (
          <Empty
            title="项目读取失败"
            action={
              <Button onClick={() => setReload((value) => value + 1)}>
                重新读取
              </Button>
            }
          >
            请重新读取项目，或选择其他项目。
          </Empty>
        ) : page === "trash" ? (
          <TrashList
            projects={bootstrap.trash ?? []}
            busy={busy}
            onRestore={restoreProject}
          />
        ) : project ? (
          <Panels
            key={project.id}
            project={project}
            busy={busy}
            panelMutation={panelMutation}
            onDelete={(panel) =>
              setModal({ type: "delete-panel", target: panel })
            }
            onRestore={(panel) => changePanelVisibility(panel, false)}
            onImport={() => setModal({ type: "import" })}
            onPanel={(panel) =>
              panel && setModal({ type: "panel", panelId: panel.panelId })
            }
          />
        ) : (
          <Empty
            title="先为你的游戏创建一个项目"
            action={
              <Button
                variant="primary"
                icon="plus"
                onClick={() => setModal({ type: "new" })}
              >
                新建项目
              </Button>
            }
          >
            选定项目风格，再导入原型并制作一组风格一致的面板参考图。
          </Empty>
        )}
      </main>
      {project && page !== "trash" && (
        <Inspector
          project={project}
          busy={busy || loading}
          onStyle={() => setModal({ type: "style" })}
        />
      )}
      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
      {modal?.type === "new" && (
        <NewProjectDialog
          busy={busy}
          onClose={() => setModal(null)}
          onCreate={createProject}
        />
      )}
      {modal?.type === "delete" && (
        <DeleteProjectDialog
          project={modal.target}
          busy={busy}
          onClose={() => setModal(null)}
          onDelete={() => deleteProject(modal.target)}
        />
      )}
      {modal?.type === "delete-panel" && project && (
        <DeletePanelDialog
          panel={modal.target}
          busy={panelMutation}
          onClose={() => setModal(null)}
          onDelete={() => changePanelVisibility(modal.target, true)}
        />
      )}
      {modal?.type === "style" && project && (
        <StyleDialog
          project={project}
          presets={bootstrap.presets}
          perform={perform}
          busy={busy}
          onRefresh={refresh}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "new-style" && (
        <StyleDialog
          key={`new:${modal.name}`}
          newProjectName={modal.name}
          presets={bootstrap.presets}
          perform={perform}
          busy={busy}
          onCreated={completeProject}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "import" && project && (
        <ImportDialog
          project={project}
          templates={bootstrap.templates}
          perform={perform}
          busy={busy}
          onRefresh={refresh}
          onImported={(panelId) => setModal({ type: "panel", panelId })}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "panel" && selectedPanel && (
        <PanelDialog
          key={`${project.id}:${selectedPanel.panelId}`}
          project={project}
          panel={selectedPanel}
          generationMode={bootstrap.generationMode}
          generation={bootstrap.generation}
          perform={perform}
          busy={busy}
          onRefresh={refresh}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { atomicJson, exact, isDigest, isId, local, readJson, requireThat, seal, textValue, unseal, withLock, writeJsonNew } from './common.mjs';
import { loadStyle } from './styles.mjs';
import { importPanel, loadPrototype } from './panel.mjs';
import { verifyResult, verifyReview } from './generation.mjs';

export function initialize(root, projectId) {
  requireThat(isId(projectId), 'PROJECT_ID');
  local(root, 'project.json');
  requireThat(!fs.existsSync(root), 'PROJECT_ALREADY_EXISTS');
  fs.mkdirSync(root, { recursive: true });
  const project = seal({ kind: 'ui_reference_project_v1', id: projectId, activeStyle: null, activation: null, panels: {}, baselines: {} });
  writeJsonNew(root, 'project.json', project); return project;
}
export function loadProject(root) {
  const project = readJson(local(root, 'project.json')); unseal(project);
  exact(project, ['kind', 'id', 'activeStyle', 'activation', 'panels', 'baselines', 'sha256']);
  requireThat(project.kind === 'ui_reference_project_v1' && isId(project.id)
    && (project.activeStyle === null || isDigest(project.activeStyle)), 'PROJECT_CONTRACT');
  if (project.activeStyle) {
    loadStyle(root, project.activeStyle);
    const approval = readJson(local(root, project.activation)); unseal(approval);
    requireThat(approval.styleSha256 === project.activeStyle && approval.projectId === project.id, 'STYLE_APPROVAL_MISMATCH');
  }
  return project;
}
export function saveProject(root, project) {
  const { sha256, ...payload } = project; atomicJson(root, 'project.json', seal(payload));
}
export function activateStyle(root, styleSha256, approval) {
  textValue(approval, 2000);
  return withLock(root, () => {
    const project = loadProject(root); loadStyle(root, styleSha256);
    const relative = `activations/${randomUUID()}.json`;
    writeJsonNew(root, relative, seal({ kind: 'ui_reference_style_approval_v1', projectId: project.id, styleSha256, approval }));
    project.activeStyle = styleSha256; project.activation = relative; saveProject(root, project);
    return { activeStyle: styleSha256, panelCount: Object.keys(project.panels).length };
  });
}
export async function addPanel(root, options) {
  return withLock(root, async () => {
    const project = loadProject(root), { prototype, artifact } = await importPanel(root, options);
    const previous = project.panels[prototype.panelId];
    project.panels[prototype.panelId] = { prototype: artifact, acceptedRun: previous?.prototype.sha256 === artifact.sha256 ? previous.acceptedRun : null };
    saveProject(root, project);
    return { panelId: prototype.panelId, prototype: artifact, neutralPreview: prototype.layout, originalPreview: prototype.screenshot };
  });
}
export function projectStatus(root) {
  const project = loadProject(root);
  const panels = Object.entries(project.panels).map(([id, entry]) => {
    loadPrototype(root, entry.prototype);
    let status = 'needs_generation';
    if (entry.acceptedRun) {
      const result = verifyResult(root, entry.acceptedRun), review = verifyReview(root, entry.acceptedRun, result), plan = result.plan;
      requireThat(review.decision === 'accept' && plan.prototype.sha256 === entry.prototype.sha256, 'PROJECT_ACCEPTANCE_INTEGRITY');
      status = plan.styleSha256 === project.activeStyle ? 'accepted_current_style' : 'needs_style_update';
    }
    return { panelId: id, status, prototypeSha256: entry.prototype.sha256, acceptedRun: entry.acceptedRun };
  });
  return { projectId: project.id, activeStyle: project.activeStyle, panels };
}

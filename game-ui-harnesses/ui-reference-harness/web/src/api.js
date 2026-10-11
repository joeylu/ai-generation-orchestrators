export const projectPath = (id) => `/api/projects/${id}`;
export const runPath = (id, run) => `${projectPath(id)}/runs/${run.slice(5)}`;
export async function request(url, body) {
  let response;
  try {
    response = await fetch(
      url,
      body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
    );
  } catch {
    throw new Error("NETWORK_UNAVAILABLE");
  }
  let value;
  try {
    value = await response.json();
  } catch {
    throw new Error("RESPONSE_INVALID");
  }
  if (!response.ok) {
    const error = new Error(value.error ?? "OPERATION_FAILED");
    error.code = value.error;
    throw error;
  }
  return value;
}
export async function fileJson(file) {
  if (!file) throw new Error("FILE_REQUIRED");
  if (file.size > 20 * 1024 * 1024) throw new Error("UPLOAD_TOO_LARGE");
  try {
    return JSON.parse(await file.text());
  } catch {
    throw new Error("FILE_JSON_INVALID");
  }
}
export function panelInputKind(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const bundle = Object.hasOwn(value, "panelBundleVersion"),
      spec = Object.hasOwn(value, "panelSpecVersion");
    if (
      bundle !== spec &&
      typeof value[bundle ? "panelBundleVersion" : "panelSpecVersion"] ===
        "string"
    )
      return bundle ? "bundle" : "spec";
  }
  throw new Error("PANEL_FILE_UNSUPPORTED");
}
export async function fileBase64(file) {
  if (!file) return undefined;
  if (file.size > 20 * 1024 * 1024) throw new Error("UPLOAD_TOO_LARGE");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("FILE_READ_FAILED"));
    reader.readAsDataURL(file);
  });
}
export function download(url) {
  const link = document.createElement("a");
  link.href = url;
  link.download = "";
  link.click();
}
export async function mutateAndRefresh(mutate, refresh) {
  let value, failure;
  try {
    value = await mutate();
  } catch (error) {
    failure = error;
  }
  try {
    await refresh();
  } catch (error) {
    failure ??= error;
  }
  if (failure) throw failure;
  return value;
}
export const errorText = (error) =>
  ({
    SHOWCASE_READ_ONLY: "示例项目只读。请新建项目开始制作。",
    PROJECT_TRASHED: "项目已移入回收站，恢复后可继续使用。",
    PANEL_TRASHED: "面板已删除，请在项目的“已删除”中恢复后继续。",
    PROJECT_BUSY: "项目正在处理操作，请完成后再试。",
    STYLE_PREVIEW_ALREADY_STARTED:
      "此预览请求已开始，不会重复提交。请读取生成结果。",
    STYLE_PREVIEW_STYLE_MISMATCH:
      "此预览对应另一份风格草案，请重新核对当前风格。",
    STYLE_PREVIEW_IMAGE_MISMATCH: "预览图片已不匹配，请重新读取结果后确认。",
    STYLE_PREVIEW_SOURCE_UNSUPPORTED:
      "此旧版风格暂不支持生成预览，请选择现有默认风格或规则文件。",
    SESSION_STALE: "这个面板已在其他窗口更新，请重新读取会话后继续。",
    SESSION_SOURCE_STALE: "当前图片已更新，请重新读取会话后继续。",
    REVISION_LIMIT_REACHED: "已用完三轮修改，可查看并接受已有版本。",
    PROJECT_STYLE_REQUIRED: "请先选择并确认项目风格。",
    STYLE_RESOLVER_NOT_CONFIGURED:
      "本地服务尚未接入风格解析，请配置支持文本解析的适配器；补充要求尚未应用。",
    STYLE_RESOLUTION_FAILED:
      "风格整理未完成，当前项目风格没有改变。可保留补充内容，重新点击确认。",
    STYLE_RESOLUTION_TIMEOUT:
      "风格整理超时，当前项目风格没有改变。可重新点击确认。",
    STYLE_RESOLUTION_INVALID: "风格解析返回了无效配置，未应用到项目。",
    STYLE_RESOLUTION_UNCHANGED:
      "补充内容未形成明确的风格调整，请写明希望改变的配色、材质或视觉效果。",
    STYLE_RESOLUTION_TOOL_FORBIDDEN:
      "风格解析尝试了额外操作，已停止，未应用到项目。",
    STYLE_RESOLUTION_SOURCE_UNSUPPORTED:
      "此旧版风格暂不支持自动合并，请选择现有默认风格或规则文件。",
    PROJECT_PLAN_ACCEPTED_ANCHOR_REQUIRED:
      "请先生成代表面板，验收时将它设为项目锚点。",
    PROJECT_PLAN_PANEL_ALREADY_ACCEPTED:
      "该面板已接受；如需改进，请明确创建新的优化计划。",
    PLAN_STYLE_STALE: "项目风格已更新，请重新打开面板后生成。",
    PLAN_PROTOTYPE_STALE: "面板原型已更新，请重新打开面板后生成。",
    PLAN_CONTRACT_OR_RUNTIME_CHANGED:
      "任务版本与当前服务不兼容。图片和记录已保留，请检查服务版本后重新读取。",
    REVIEW_IMAGE_MISMATCH: "待验收图片已更新，请重新打开面板后核对。",
    ATTEMPT_ALREADY_RESERVED_NO_RESUBMIT: "该请求已经保留，不能再次提交。",
    GENERATION_ADAPTER_NOT_CONFIGURED:
      "当前使用生成输入包交换，请下载输入并导入返回的 PNG。",
    ADAPTER_INDETERMINATE_NO_RESUBMIT:
      "生成结果未知，记录已保留。不能自动重试，请检查外部工具结果。",
    CODEX_CLI_LOGIN_OR_SETUP_REQUIRED:
      "Codex CLI 不可用或未登录，请在本机检查 codex login status。",
    CODEX_CHATGPT_LOGIN_REQUIRED: "请先在本机通过 ChatGPT 登录 Codex CLI。",
    CODEX_WORKSPACE_REQUIRED: "本地服务尚未配置 CLI 图片工作目录。",
    CODEX_IMAGE_TOOLS_REQUIRED: "当前 Codex CLI 需要启用生图工具和调用限制。",
    CODEX_MODEL_EFFORT_UNSUPPORTED: "当前 CLI 不支持所选模型或推理强度。",
    CODEX_IMAGE_GATE_UNAVAILABLE:
      "CLI 接入已配置，需先确认本次新增的两条防重复提交脚本。当前尚未生图。",
    UPLOAD_TOO_LARGE: "上传文件最大支持 20 MiB。",
    FILE_REQUIRED: "请选择要导入的文件。",
    FILE_JSON_INVALID: "所选文件不是有效的 JSON，请检查文件内容。",
    FILE_READ_FAILED: "文件读取失败，请重新选择文件。",
    PANEL_FILE_UNSUPPORTED:
      "无法识别此原型文件，请上传 ui-panel-harness 导出的面板原型 JSON。",
    NETWORK_UNAVAILABLE: "本地服务暂时不可连接，请检查服务后重试读取状态。",
    RESPONSE_INVALID: "本地服务返回了无效响应，请重新读取状态。",
    JSON_BODY_INVALID: "文件内容不是有效的 JSON。",
    JSON_READ_FAILED:
      "项目文件读取失败，请检查本地项目文件；其他项目仍可使用。",
    GENERATED_NOT_OPAQUE: "结果包含透明像素；此工作台需要完整不透明参考图。",
    GENERATED_BLANK: "结果为空白图，请检查生成工具返回的文件。",
    DELIVERY_MIXED_STYLE: "还有面板需要更新为当前风格，暂时不能整套导出。",
  })[error.code ?? error.message] ??
  `操作未完成：${error.code ?? error.message}`;
export const labels = {
  accepted_current_style: "已接受",
  needs_generation: "待生成",
  needs_style_update: "风格待更新",
  awaiting_authorization: "待生成",
  authorized: "待生成",
  reserved_no_resubmit: "已锁定请求",
  pending_visual_review: "待验收",
  rejected_visual: "未接受",
  rejected_technical: "技术未通过",
  indeterminate: "结果未知",
  failed: "生成失败",
  accepted: "已接受",
  raw_received_needs_finish: "待完成处理",
};
export function panelStatus(panel) {
  if (panel.latestRun?.current && panel.latestRun.status !== "accepted")
    return panel.latestRun.status;
  return panel.status;
}
export function panelActionLabel(panel, readOnly = false) {
  if (readOnly) return panel.image ? "查看图片" : "查看原型";
  const status = panelStatus(panel);
  if (status === "pending_visual_review") return "验收图片";
  if (
    ["accepted", "accepted_current_style", "rejected_visual"].includes(status)
  )
    return "查看与修改";
  if (
    [
      "needs_generation",
      "needs_style_update",
      "awaiting_authorization",
      "authorized",
    ].includes(status)
  )
    return "生成参考图";
  if (["reserved_no_resubmit", "raw_received_needs_finish"].includes(status))
    return "查看进度";
  return "查看详情";
}

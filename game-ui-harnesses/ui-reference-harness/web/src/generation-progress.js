// Display only observed stages; provider completion has no reliable percentage.
export function generationProgress(session, operation) {
  if (!session?.active && !operation) return null;
  const last = session?.turns.at(-1);
  const turn = !operation || last?.operationId === operation.id ? last : null;
  const revision = operation?.revision ?? turn?.round > 0;
  const action = revision ? "修改" : "生成";
  let stage = 0,
    label = "正在准备生成…";
  if (operation?.phase === "saving") label = "正在保存补充信息…";
  else if (operation?.phase === "finishing" || turn?.image || turn?.error) {
    stage = 2;
    label = "正在更新结果…";
  } else if (turn?.status === "raw_received_needs_finish") {
    stage = 2;
    label = "正在检查图片…";
  } else if (turn?.status === "reserved_no_resubmit") {
    stage = 1;
    label = `正在${action}图片，等待返回…`;
  }
  return {
    revision,
    stage,
    label,
    startedAt: operation?.startedAt ?? Date.parse(turn?.created),
  };
}

export function elapsedTime(startedAt, now) {
  const seconds = Number.isFinite(startedAt)
    ? Math.max(0, Math.floor((now - startedAt) / 1000))
    : 0;
  return {
    seconds,
    text:
      seconds < 60
        ? `${seconds} 秒`
        : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`,
  };
}

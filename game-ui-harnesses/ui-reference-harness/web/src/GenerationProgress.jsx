import React, { useEffect, useRef, useState } from "react";
import { elapsedTime } from "./generation-progress.js";

export function GenerationProgress({ progress }) {
  const [now, setNow] = useState(Date.now);
  const container = useRef(null);
  useEffect(() => {
    if (!progress) return;
    container.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [progress?.startedAt]);
  if (!progress) return null;
  const elapsed = elapsedTime(progress.startedAt, now);
  return (
    <div className="generation-progress" ref={container}>
      <div className="generation-progress-heading">
        <strong role="status">{progress.label}</strong>
        <span className="generation-elapsed" aria-live="off">
          已等待 {elapsed.text}
        </span>
      </div>
      <ol aria-label="生成阶段">
        {["准备", "生成", "检查"].map((label, index) => (
          <li
            key={label}
            className={index <= progress.stage ? "reached" : ""}
            aria-current={index === progress.stage ? "step" : undefined}
          >
            {label}
          </li>
        ))}
      </ol>
      <p>
        {elapsed.seconds >= 60 && "图片仍在处理中，返回后会自动展示。"}
        可以关闭窗口或刷新，回来后继续查看。
      </p>
    </div>
  );
}

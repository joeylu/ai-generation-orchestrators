import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function Toast({ toast, onClose }) {
  const [target, setTarget] = useState(document.body);
  useEffect(() => {
    const syncTarget = () => {
      // A native modal is in the browser top layer. Its active subtree also
      // keeps the notification accessible and clickable while the page is inert.
      const dialogs = [...document.querySelectorAll("dialog.modal[open]")];
      setTarget(dialogs.at(-1) ?? document.body);
    };
    const observer = new MutationObserver(syncTarget);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    syncTarget();
    return () => observer.disconnect();
  }, []);
  return createPortal(
    <div
      className={`toast ${toast.error ? "error" : ""}`}
      role={toast.error ? "alert" : "status"}
    >
      <Icon name={toast.error ? "info" : "check"} />
      <span>{toast.text}</span>
      <button type="button" aria-label="关闭提示" onClick={onClose}>
        <Icon name="close" size={16} />
      </button>
    </div>,
    target,
  );
}

// Bind readiness to the displayed full-size image, never a loaded thumbnail or
// the image that was visible before switching versions.
export function useReviewImage(src) {
  const ref = useRef(null);
  const [loaded, setLoaded] = useState(null),
    [failed, setFailed] = useState(null);
  const ready = Boolean(src) && loaded === src && failed !== src;
  return {
    ready,
    failed: Boolean(src) && failed === src,
    isReady: () =>
      ready &&
      ref.current?.getAttribute("src") === src &&
      ref.current.complete &&
      ref.current.naturalWidth > 0,
    props: {
      ref,
      onLoad: () => {
        setLoaded(src);
        setFailed(null);
      },
      onError: () => {
        setLoaded(null);
        setFailed(src);
      },
    },
  };
}

export function ReviewImageStatus({ image, reviewing }) {
  if (image.ready) return null;
  return (
    <p className="muted" role={image.failed ? "alert" : "status"}>
      {image.failed
        ? "参考图加载失败，请关闭面板后重新打开；图片与记录已保留。"
        : reviewing
          ? "正在加载参考图，加载完成后可验收。"
          : "正在加载参考图…"}
    </p>
  );
}

const paths = {
  trash: (
    <>
      <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
    </>
  ),
  restore: (
    <>
      <path d="M3 10a9 9 0 1 1 2 8M3 4v6h6M12 7v5l3 2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  layers: (
    <>
      <rect x="4" y="3" width="13" height="15" rx="2" />
      <path d="M20 7v13H8" />
    </>
  ),
  folder: (
    <path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1l-2 11H3L1 8h2Z" />
  ),
  palette: (
    <>
      <path d="M21 12A9 9 0 1 0 12 21h1a2 2 0 0 0 1-4 2 2 0 0 1 1-4h4a2 2 0 0 0 2-1Z" />
      <path d="M7 10h.01M10 6h.01M15 6h.01M18 9h.01" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5" />
    </>
  ),
  download: <path d="M12 3v13m-5-5 5 5 5-5M4 15v5h16v-5" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  anchor: (
    <>
      <path d="M12 7v14M5 13H2a10 10 0 0 0 20 0h-3M8 11h8" />
      <circle cx="12" cy="4" r="3" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10h.01" />
    </>
  ),
  spark: <path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z" />,
  loading: <path d="M21 12a9 9 0 1 1-9-9" />,
  eye: (
    <>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
};
export function Icon({ name, size = 20, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={name === "loading" ? "loading-icon" : undefined}
      {...props}
    >
      {paths[name] ?? paths.layers}
    </svg>
  );
}
export function Button({
  icon,
  children,
  variant = "default",
  className = "",
  type = "button",
  ...props
}) {
  return (
    <button type={type} className={`button ${variant} ${className}`} {...props}>
      {icon && <Icon name={icon} size={18} />}
      <span>{children}</span>
    </button>
  );
}
export function Brand() {
  return (
    <div className="brand">
      <svg
        width="42"
        height="44"
        viewBox="0 0 48 48"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.7"
      >
        <rect x="4" y="3" width="28" height="30" rx="5" />
        <rect x="18" y="18" width="25" height="26" rx="5" />
      </svg>
      <div>
        <strong>参考图工作台</strong>
        <small>UI Reference Studio</small>
      </div>
    </div>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
  closeDisabled = false,
  scrollResetKey,
}) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  useEffect(() => {
    ref.current.scrollTop = 0;
  }, [scrollResetKey]);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={(event) => {
        event.preventDefault();
        if (!closeDisabled) onClose();
      }}
      onClick={(event) => {
        if (!closeDisabled && event.target === ref.current) onClose();
      }}
    >
      <div className="modal-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="关闭"
          disabled={closeDisabled}
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Empty({ title, children, action }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name="layers" size={32} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Hash({ label, value }) {
  return (
    <div className="hash">
      <small>{label}</small>
      <code>{value}</code>
    </div>
  );
}
export function Swatches({ palette }) {
  return (
    palette && (
      <div className="swatches">
        {Object.entries(palette).map(([name, color]) => (
          <span
            key={name}
            title={`${name} ${color}`}
            style={{ background: color }}
          />
        ))}
      </div>
    )
  );
}

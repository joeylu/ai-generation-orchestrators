/** Fit the owned view only when its effective scale changes. */
export function createPanelViewportFit(canvas, container, surface, runtime) {
  let previousFit, previousZoom = 1;
  return () => {
    const fit = Math.min(1, Math.max(0.1, container.clientWidth / canvas.width));
    if (fit === previousFit) return false;
    const zoom = Math.max(0.5, fit);
    // setZoom also cancels gestures and reallocates the drawing buffer. A
    // height-only ResizeObserver notification must not reset a static view.
    if (zoom !== previousZoom) runtime.setZoom(zoom);
    surface.style.transform = `scale(${fit / zoom})`;
    surface.style.width = `${canvas.width * zoom}px`;
    surface.style.height = `${canvas.height * zoom}px`;
    container.style.height = `${canvas.height * fit}px`;
    previousFit = fit; previousZoom = zoom;
    return true;
  };
}

/** Observe layout without writing back during ResizeObserver delivery. */
export function observePanelViewport(canvas, container, surface, runtime, {
  Observer = globalThis.ResizeObserver,
  clock = { request: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id) },
} = {}) {
  const fit = createPanelViewportFit(canvas, container, surface, runtime);
  let disposed = false, frame;
  const observer = new Observer(() => {
    if (disposed || frame !== undefined) return;
    frame = clock.request(() => { frame = undefined; if (!disposed) fit(); });
  });
  fit(); observer.observe(container);
  return () => {
    if (disposed) return;
    disposed = true; observer.disconnect();
    if (frame !== undefined) { clock.cancel(frame); frame = undefined; }
  };
}

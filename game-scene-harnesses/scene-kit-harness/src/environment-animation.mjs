export function supportsEnvironmentAnimation(module) {
  return module?.kind === 'environment' && !module.terrainSkin;
}

export function animationFrameRect(index, width, height, columns, rows) {
  const column = index % columns, row = Math.floor(index / columns);
  const x = Math.floor(column * width / columns), y = Math.floor(row * height / rows);
  return { x, y, width: Math.floor((column + 1) * width / columns) - x,
    height: Math.floor((row + 1) * height / rows) - y };
}

export function defaultEnvironmentAnimationAnchor({ pixelSize, anchorPx }, frameSize) {
  return {
    x: Math.floor(anchorPx.x * frameSize.width / pixelSize.width),
    y: Math.floor(anchorPx.y * frameSize.height / pixelSize.height),
  };
}

export function environmentAnimationTransform({ pixelSize, anchorPx }, clip, index = 0) {
  const scale = clip.registration?.scale ?? Math.min(pixelSize.width / clip.frameSize.width, pixelSize.height / clip.frameSize.height);
  const x = clip.registration?.x ?? anchorPx.x - clip.anchorPx.x * scale;
  const y = clip.registration?.y ?? anchorPx.y - clip.anchorPx.y * scale;
  const offset = clip.baseLock?.[index];
  return offset ? { scale, x: x + offset.x * scale, y: y + offset.y * scale } : { scale, x, y };
}

function baseContact(image, rect) {
  const alpha = (x, y) => image.rgba[((rect.y + y) * image.width + rect.x + x) * 4 + 3];
  for (let bottom = rect.height - 1; bottom >= 0; bottom--) {
    let touches = false;
    for (let x = 0; x < rect.width && !touches; x++) touches = alpha(x, bottom) >= 128;
    if (!touches) continue;
    let sumX = 0, count = 0;
    for (let y = Math.max(0, bottom - 4); y <= bottom; y++) for (let x = 0; x < rect.width; x++) {
      if (alpha(x, y) < 128) continue;
      sumX += x;
      count++;
    }
    return { x: sumX / count, bottom };
  }
}

// Contact is measured in frame-local pixels. The first pose retains its placement.
export function measureEnvironmentAnimationBaseLock(width, height, { columns, rows }, readFrame) {
  const contacts = Array.from({ length: columns * rows }, (_, index) => {
    const rect = animationFrameRect(index, width, height, columns, rows);
    const frame = readFrame(rect);
    return baseContact(frame.image, frame.rect);
  });
  if (!contacts.every(Boolean)) return undefined;
  const first = contacts[0];
  return contacts.map(contact => ({
    x: Math.round(first.x - contact.x) || 0,
    y: first.bottom - contact.bottom,
  }));
}

function silhouette(image, rect, minimumAlpha) {
  let left = rect.width, top = rect.height, right = 0, bottom = 0;
  for (let y = 0; y < rect.height; y++) for (let x = 0; x < rect.width; x++) {
    const alpha = image.rgba[((rect.y + y) * image.width + rect.x + x) * 4 + 3];
    if (alpha < minimumAlpha) continue;
    left = Math.min(left, x); top = Math.min(top, y);
    right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
  }
  if (right <= left) return null;
  return { width: right - left, height: bottom - top, centerX: (left + right) / 2, bottom };
}

// Align the first pose once so subsequent poses retain their authored motion.
export function registerEnvironmentAnimationPose(still, poseImage, poseRect) {
  const canvas = { x: 0, y: 0, width: still.width, height: still.height };
  const base = silhouette(still, canvas, 128) ?? silhouette(still, canvas, 8);
  const pose = silhouette(poseImage, poseRect, 128);
  if (!base || !pose) return undefined;
  const scale = Math.min(base.width / pose.width, base.height / pose.height);
  if (scale < 1 / 64 || scale > 64) return undefined;
  return { scale, x: base.centerX - pose.centerX * scale, y: base.bottom - pose.bottom * scale };
}

export function createEnvironmentAnimationPlayer(animation) {
  const states = new Map(animation.states.map(state => [state.id, state]));
  let state, elapsed, frame;
  function enter(id) {
    state = states.get(id);
    elapsed = 0;
    frame = 0;
  }
  enter(animation.initial);
  return {
    get state() { return state; },
    get frame() { return frame; },
    reset() { enter(animation.initial); },
    interact() {
      if (!state.onInteract) return false;
      enter(state.onInteract);
      return true;
    },
    advance(deltaMs) {
      if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
      let remaining = Math.min(deltaMs, 1000);
      while (remaining > 0 && state.clip && state.playback !== 'hold') {
        const { columns, rows, frameMs } = state.clip, count = columns * rows, duration = count * frameMs;
        if (state.playback === 'loop') {
          elapsed = (elapsed + remaining) % duration;
          frame = Math.floor(elapsed / frameMs);
          return;
        }
        if (elapsed + remaining < duration || !state.onFinish) {
          elapsed = Math.min(duration, elapsed + remaining);
          frame = Math.min(count - 1, Math.floor(elapsed / frameMs));
          return;
        }
        remaining -= duration - elapsed;
        enter(state.onFinish);
      }
    },
  };
}

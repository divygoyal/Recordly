import { Container, BlurFilter } from 'pixi.js';
import { MotionBlurFilter } from 'pixi-filters/motion-blur';

const PEAK_VELOCITY_PPS = 1500;
const MAX_BLUR_PX = 16;
const VELOCITY_THRESHOLD_PPS = 8;

/** Maximum rule-of-thirds focus offset (5% of normalized coordinates). */
const ROT_MAX_OFFSET = 0.05;

/**
 * Apply rule-of-thirds offset to focus position. When the cursor is near
 * the edges, shift the focus toward the nearest 1/3 line for cinematic
 * composition. In the center zone (0.3–0.7), no offset is applied.
 */
export function applyRuleOfThirdsOffset(
  focusX: number,
  focusY: number,
): { focusX: number; focusY: number } {
  const offsetX = computeThirdsOffset(focusX);
  const offsetY = computeThirdsOffset(focusY);
  return {
    focusX: Math.max(0, Math.min(1, focusX + offsetX)),
    focusY: Math.max(0, Math.min(1, focusY + offsetY)),
  };
}

function computeThirdsOffset(v: number): number {
  // Center dead zone: no offset when cursor is between 0.3 and 0.7
  if (v >= 0.3 && v <= 0.7) return 0;

  // Near left/top edge (0–0.3): shift toward 1/3 line (0.333)
  if (v < 0.3) {
    const edgeDist = (0.3 - v) / 0.3; // 0 at 0.3, 1 at 0
    return ROT_MAX_OFFSET * edgeDist; // positive = push toward 1/3
  }

  // Near right/bottom edge (0.7–1): shift toward 2/3 line (0.667)
  const edgeDist = (v - 0.7) / 0.3; // 0 at 0.7, 1 at 1.0
  return -ROT_MAX_OFFSET * edgeDist; // negative = push toward 2/3
}

export interface MotionBlurState {
  lastFrameTimeMs: number;
  prevCamX: number;
  prevCamY: number;
  prevCamScale: number;
  initialized: boolean;
}

export function createMotionBlurState(): MotionBlurState {
  return {
    lastFrameTimeMs: 0,
    prevCamX: 0,
    prevCamY: 0,
    prevCamScale: 1,
    initialized: false,
  };
}

interface TransformParams {
  cameraContainer: Container;
  videoContainer?: Container;
  blurFilter: BlurFilter | null;
  motionBlurFilter?: MotionBlurFilter | null;
  stageSize: { width: number; height: number };
  baseMask: { x: number; y: number; width: number; height: number };
  zoomScale: number;
  zoomProgress?: number;
  focusX: number;
  focusY: number;
  motionIntensity: number;
  motionVector?: { x: number; y: number };
  isPlaying: boolean;
  motionBlurAmount?: number;
  transformOverride?: AppliedTransform;
  motionBlurState?: MotionBlurState;
  frameTimeMs?: number;
}

interface AppliedTransform {
  scale: number;
  x: number;
  y: number;
}

interface FocusFromTransformGeometry {
  stageSize: { width: number; height: number };
  baseMask: { x: number; y: number; width: number; height: number };
  zoomScale: number;
  x: number;
  y: number;
}

interface ZoomTransformGeometry {
  stageSize: { width: number; height: number };
  baseMask: { x: number; y: number; width: number; height: number };
  zoomScale: number;
  zoomProgress?: number;
  focusX: number;
  focusY: number;
}

export function computeZoomTransform({
  stageSize,
  baseMask,
  zoomScale,
  zoomProgress = 1,
  focusX,
  focusY,
}: ZoomTransformGeometry): AppliedTransform {
  if (
    stageSize.width <= 0 ||
    stageSize.height <= 0 ||
    baseMask.width <= 0 ||
    baseMask.height <= 0
  ) {
    return { scale: 1, x: 0, y: 0 };
  }

  const progress = Math.min(1, Math.max(0, zoomProgress));
  const focusStagePxX = baseMask.x + focusX * baseMask.width;
  const focusStagePxY = baseMask.y + focusY * baseMask.height;
  const stageCenterX = stageSize.width / 2;
  const stageCenterY = stageSize.height / 2;
  const scale = 1 + (zoomScale - 1) * progress;
  const finalX = stageCenterX - focusStagePxX * zoomScale;
  const finalY = stageCenterY - focusStagePxY * zoomScale;

  return {
    scale,
    x: finalX * progress,
    y: finalY * progress,
  };
}

export function computeFocusFromTransform({
  stageSize,
  baseMask,
  zoomScale,
  x,
  y,
}: FocusFromTransformGeometry) {
  if (
    stageSize.width <= 0 ||
    stageSize.height <= 0 ||
    baseMask.width <= 0 ||
    baseMask.height <= 0 ||
    zoomScale <= 0
  ) {
    return { cx: 0.5, cy: 0.5 };
  }

  const stageCenterX = stageSize.width / 2;
  const stageCenterY = stageSize.height / 2;
  const focusStagePxX = (stageCenterX - x) / zoomScale;
  const focusStagePxY = (stageCenterY - y) / zoomScale;

  return {
    cx: (focusStagePxX - baseMask.x) / baseMask.width,
    cy: (focusStagePxY - baseMask.y) / baseMask.height,
  };
}

export function applyZoomTransform({
  cameraContainer,
  videoContainer,
  blurFilter,
  motionBlurFilter,
  stageSize,
  baseMask,
  zoomScale,
  zoomProgress = 1,
  focusX,
  focusY,
  motionIntensity: _motionIntensity,
  motionVector: _motionVector,
  isPlaying,
  motionBlurAmount = 0,
  transformOverride,
  motionBlurState,
  frameTimeMs,
}: TransformParams): AppliedTransform {
  if (
    stageSize.width <= 0 ||
    stageSize.height <= 0 ||
    baseMask.width <= 0 ||
    baseMask.height <= 0
  ) {
    return { scale: 1, x: 0, y: 0 };
  }

  const transform = transformOverride ?? computeZoomTransform({
    stageSize,
    baseMask,
    zoomScale,
    zoomProgress,
    focusX,
    focusY,
  });

  // Apply position & scale to camera container
  cameraContainer.scale.set(transform.scale);
  cameraContainer.position.set(transform.x, transform.y);

  if (motionBlurState && motionBlurFilter && motionBlurAmount > 0 && isPlaying) {
    const now = frameTimeMs ?? performance.now();

    if (!motionBlurState.initialized) {
      motionBlurState.prevCamX = transform.x;
      motionBlurState.prevCamY = transform.y;
      motionBlurState.prevCamScale = transform.scale;
      motionBlurState.lastFrameTimeMs = now;
      motionBlurState.initialized = true;
      motionBlurFilter.velocity = { x: 0, y: 0 };
      motionBlurFilter.kernelSize = 5;
      motionBlurFilter.offset = 0;
      // No velocity yet — keep filter detached for sharp rendering
      if (videoContainer) videoContainer.filters = null;
      if (blurFilter) blurFilter.blur = 0;
    } else {
      const dtMs = Math.min(80, Math.max(1, now - motionBlurState.lastFrameTimeMs));
      const dtSeconds = dtMs / 1000;
      motionBlurState.lastFrameTimeMs = now;

      // Camera displacement this frame (stage-px)
      const dx = transform.x - motionBlurState.prevCamX;
      const dy = transform.y - motionBlurState.prevCamY;
      const dScale = transform.scale - motionBlurState.prevCamScale;

      motionBlurState.prevCamX = transform.x;
      motionBlurState.prevCamY = transform.y;
      motionBlurState.prevCamScale = transform.scale;

      // Velocity in px/s (translation + scale-change contribution)
      const velocityX = dx / dtSeconds;
      const velocityY = dy / dtSeconds;
      const scaleVelocity = Math.abs(dScale / dtSeconds) * Math.max(stageSize.width, stageSize.height) * 0.5;
      const speed = Math.sqrt(velocityX * velocityX + velocityY * velocityY) + scaleVelocity;

      const normalised = Math.min(1, speed / PEAK_VELOCITY_PPS);
      const targetBlur = speed < VELOCITY_THRESHOLD_PPS
        ? 0
        : Math.pow(normalised, 1.5) * MAX_BLUR_PX * motionBlurAmount;

      if (targetBlur > 0) {
        // Active motion — attach filter and set velocity
        const dirMag = Math.sqrt(velocityX * velocityX + velocityY * velocityY) || 1;
        const velocityScale = targetBlur * 1.2;
        motionBlurFilter.velocity = { x: (velocityX / dirMag) * velocityScale, y: (velocityY / dirMag) * velocityScale };
        motionBlurFilter.kernelSize = targetBlur > 4 ? 11 : targetBlur > 1.5 ? 9 : 5;
        motionBlurFilter.offset = targetBlur > 0.5 ? -0.2 : 0;
        if (videoContainer) videoContainer.filters = [motionBlurFilter];
      } else {
        // No motion — detach filter so PixiJS skips the framebuffer pass
        motionBlurFilter.velocity = { x: 0, y: 0 };
        if (videoContainer) videoContainer.filters = null;
      }

      if (blurFilter) {
        blurFilter.blur = 0;
      }
    }
  } else {
    // Motion blur not active — ensure filter is detached for maximum sharpness
    if (videoContainer) videoContainer.filters = null;
    if (motionBlurFilter) {
      motionBlurFilter.velocity = { x: 0, y: 0 };
      motionBlurFilter.kernelSize = 5;
      motionBlurFilter.offset = 0;
    }
    if (blurFilter) {
      blurFilter.blur = 0;
    }
    if (motionBlurState) {
      motionBlurState.initialized = false;
    }
  }

  return {
    scale: transform.scale,
    x: transform.x,
    y: transform.y,
  };
}


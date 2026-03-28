import { spring } from 'motion';

import type { ZoomTransitionEasing } from '../types';

export interface SpringState {
  value: number;
  velocity: number;
  initialized: boolean;
}

export interface SpringConfig {
  stiffness: number;
  damping: number;
  mass: number;
  restDelta?: number;
  restSpeed?: number;
}

// ── Unified Zoom Spring ──────────────────────────────────────
// FocuSee drives ALL zoom axes (scale, position, rotation) through
// a single spring system so they arrive and settle together. This
// replaces the old dual system (easeOutCubic for 2D + separate
// springs for 3D rotation) that caused visible desynchronization.

export interface UnifiedZoomSpringState {
  progress: SpringState;
  scale: SpringState;
  focusX: SpringState;
  focusY: SpringState;
  rotX: SpringState;
  rotY: SpringState;
  rotZ: SpringState;
}

export interface UnifiedZoomTargets {
  progress: number;
  scale: number;
  focusX: number;
  focusY: number;
  rotX: number;
  rotY: number;
  rotZ: number;
}

export interface UnifiedZoomOutput {
  progress: number;
  scale: number;
  focusX: number;
  focusY: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  /** True when all axes are at rest (within rest thresholds). */
  atRest: boolean;
}

export function createUnifiedZoomState(): UnifiedZoomSpringState {
  return {
    progress: createSpringState(0),
    scale: createSpringState(1),
    focusX: createSpringState(0.5),
    focusY: createSpringState(0.5),
    rotX: createSpringState(0),
    rotY: createSpringState(0),
    rotZ: createSpringState(0),
  };
}

export function resetUnifiedZoomState(state: UnifiedZoomSpringState) {
  resetSpringState(state.progress, 0);
  resetSpringState(state.scale, 1);
  resetSpringState(state.focusX, 0.5);
  resetSpringState(state.focusY, 0.5);
  resetSpringState(state.rotX, 0);
  resetSpringState(state.rotY, 0);
  resetSpringState(state.rotZ, 0);
}

/**
 * Advance all 7 spring axes in one call with the SAME deltaMs and config,
 * ensuring perfectly synchronized settling — matching FocuSee's unified
 * SpringTransform architecture.
 */
export function stepUnifiedZoom(
  state: UnifiedZoomSpringState,
  targets: UnifiedZoomTargets,
  deltaMs: number,
  config: SpringConfig,
): UnifiedZoomOutput {
  const progress = stepSpringValue(state.progress, targets.progress, deltaMs, config);
  const scale = stepSpringValue(state.scale, targets.scale, deltaMs, config);
  const focusX = stepSpringValue(state.focusX, targets.focusX, deltaMs, config);
  const focusY = stepSpringValue(state.focusY, targets.focusY, deltaMs, config);
  const rotX = stepSpringValue(state.rotX, targets.rotX, deltaMs, config);
  const rotY = stepSpringValue(state.rotY, targets.rotY, deltaMs, config);
  const rotZ = stepSpringValue(state.rotZ, targets.rotZ, deltaMs, config);

  const restDelta = config.restDelta ?? 0.0005;
  const restSpeed = config.restSpeed ?? 0.01;

  const atRest =
    isAxisAtRest(state.progress, targets.progress, restDelta, restSpeed) &&
    isAxisAtRest(state.scale, targets.scale, restDelta, restSpeed) &&
    isAxisAtRest(state.focusX, targets.focusX, restDelta, restSpeed) &&
    isAxisAtRest(state.focusY, targets.focusY, restDelta, restSpeed) &&
    isAxisAtRest(state.rotX, targets.rotX, restDelta, restSpeed) &&
    isAxisAtRest(state.rotY, targets.rotY, restDelta, restSpeed) &&
    isAxisAtRest(state.rotZ, targets.rotZ, restDelta, restSpeed);

  return { progress, scale, focusX, focusY, rotX, rotY, rotZ, atRest };
}

function isAxisAtRest(
  state: SpringState,
  target: number,
  restDelta: number,
  restSpeed: number,
): boolean {
  return Math.abs(state.value - target) <= restDelta &&
         Math.abs(state.velocity) <= restSpeed;
}

/**
 * Snap all axes to zero when the zoom has fully disengaged and springs
 * are near-settled. Prevents residual micro-tilt after zoom-out.
 */
export function snapUnifiedZoomToRest(state: UnifiedZoomSpringState) {
  const axes: (keyof UnifiedZoomSpringState)[] = [
    'progress', 'rotX', 'rotY', 'rotZ',
  ];
  for (const key of axes) {
    state[key].value = 0;
    state[key].velocity = 0;
  }
  state.scale.value = 1;
  state.scale.velocity = 0;
  state.focusX.value = 0.5;
  state.focusX.velocity = 0;
  state.focusY.value = 0.5;
  state.focusY.velocity = 0;
}

// ── Spring Presets for ZoomTransitionEasing ───────────────────
// Each easing mode maps to a spring config instead of a bezier curve.
// This preserves backward compat with project files while giving
// physically-based motion.

const EASING_SPRING_PRESETS: Record<ZoomTransitionEasing, SpringConfig> = {
  yourbrand: {
    stiffness: 240, damping: 30, mass: 1.4,
    restDelta: 0.0005, restSpeed: 0.01,
  },
  glide: {
    stiffness: 160, damping: 28, mass: 2.0,
    restDelta: 0.0005, restSpeed: 0.008,
  },
  smooth: {
    stiffness: 300, damping: 35, mass: 1.0,
    restDelta: 0.0005, restSpeed: 0.01,
  },
  snappy: {
    stiffness: 400, damping: 32, mass: 0.8,
    restDelta: 0.0005, restSpeed: 0.015,
  },
  linear: {
    stiffness: 800, damping: 80, mass: 0.5,
    restDelta: 0.0005, restSpeed: 0.02,
  },
};

export function getEasingSpringConfig(easing: ZoomTransitionEasing): SpringConfig {
  return EASING_SPRING_PRESETS[easing] ?? EASING_SPRING_PRESETS.yourbrand;
}

/** Default unified spring config — matches FocuSee's "normal" feel. */
export function getUnifiedZoomSpringConfig(): SpringConfig {
  return EASING_SPRING_PRESETS.yourbrand;
}

const CURSOR_SMOOTHING_MIN = 0;
const CURSOR_SMOOTHING_MAX = 2;
const CURSOR_SMOOTHING_LEGACY_MAX = 0.5;

export function createSpringState(initialValue = 0): SpringState {
  return {
    value: initialValue,
    velocity: 0,
    initialized: false,
  };
}

export function resetSpringState(state: SpringState, initialValue?: number) {
  if (typeof initialValue === 'number') {
    state.value = initialValue;
  }

  state.velocity = 0;
  state.initialized = false;
}

export function clampDeltaMs(deltaMs: number, fallbackMs = 1000 / 60) {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
    return fallbackMs;
  }

  return Math.min(80, Math.max(1, deltaMs));
}

export function stepSpringValue(
  state: SpringState,
  target: number,
  deltaMs: number,
  config: SpringConfig,
) {
  const safeDeltaMs = clampDeltaMs(deltaMs);

  if (!state.initialized || !Number.isFinite(state.value)) {
    state.value = target;
    state.velocity = 0;
    state.initialized = true;
    return state.value;
  }

  const restDelta = config.restDelta ?? 0.0005;
  const restSpeed = config.restSpeed ?? 0.02;

  if (Math.abs(target - state.value) <= restDelta && Math.abs(state.velocity) <= restSpeed) {
    state.value = target;
    state.velocity = 0;
    return state.value;
  }

  const previousValue = state.value;
  const generator = spring({
    keyframes: [state.value, target],
    velocity: state.velocity,
    stiffness: config.stiffness,
    damping: config.damping,
    mass: config.mass,
    restDelta,
    restSpeed,
  });

  const result = generator.next(safeDeltaMs);
  state.value = result.done ? target : result.value;
  state.velocity = ((state.value - previousValue) / safeDeltaMs) * 1000;

  if (result.done) {
    state.velocity = 0;
  }

  return state.value;
}

export function getCursorSpringConfig(smoothingFactor: number): SpringConfig {
  const clamped = Math.min(CURSOR_SMOOTHING_MAX, Math.max(CURSOR_SMOOTHING_MIN, smoothingFactor));

  if (clamped <= 0) {
    return {
      stiffness: 1000,
      damping: 100,
      mass: 1,
      restDelta: 0.0001,
      restSpeed: 0.001,
    };
  }

  if (clamped <= CURSOR_SMOOTHING_LEGACY_MAX) {
    const legacyNormalized = Math.min(
      1,
      Math.max(0, (clamped - CURSOR_SMOOTHING_MIN) / (CURSOR_SMOOTHING_LEGACY_MAX - CURSOR_SMOOTHING_MIN)),
    );

    return {
      stiffness: 760 - legacyNormalized * 420,
      damping: 34 + legacyNormalized * 24,
      mass: 0.55 + legacyNormalized * 0.45,
      restDelta: 0.0002,
      restSpeed: 0.01,
    };
  }

  const extendedNormalized = Math.min(
    1,
    Math.max(0, (clamped - CURSOR_SMOOTHING_LEGACY_MAX) / (CURSOR_SMOOTHING_MAX - CURSOR_SMOOTHING_LEGACY_MAX)),
  );

  return {
    stiffness: 340 - extendedNormalized * 180,
    damping: 58 + extendedNormalized * 22,
    mass: 1 + extendedNormalized * 0.35,
    restDelta: 0.0002,
    restSpeed: 0.01,
  };
}

export function getZoomSpringConfig(): SpringConfig {
  return {
    stiffness: 320,
    damping: 40,
    mass: 0.92,
    restDelta: 0.0005,
    restSpeed: 0.015,
  };
}

/**
 * Underdamped perspective spring — gives "camera landing" feel with slight
 * overshoot + settle. ζ = 26/(2√(200×1.8)) ≈ 0.686 → ~5% overshoot.
 * Much more cinematic than the previous overdamped config (ζ=1.107).
 */
export function getPerspectiveSpringConfig(): SpringConfig {
  return {
    stiffness: 200,
    damping: 26,
    mass: 1.8,
    restDelta: 0.0005,
    restSpeed: 0.005,
  };
}

/**
 * Underdamped zoom scale spring — zoom "punches" in with slight overshoot
 * then settles. ζ = 22/(2√(280×0.8)) ≈ 0.735 → subtle scale bounce.
 */
export function getZoomScaleSpringConfig(): SpringConfig {
  return {
    stiffness: 280,
    damping: 22,
    mass: 0.8,
    restDelta: 0.0005,
    restSpeed: 0.015,
  };
}

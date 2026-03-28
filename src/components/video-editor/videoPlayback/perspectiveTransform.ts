/**
 * 3D perspective transform — FocuSee-style camera rotation from focus position.
 *
 * Matches FocuSee's Trans3DCommand architecture exactly, using rotation
 * formulas reverse-engineered from TransformMatrix.CreateAtPoint() IL bytecode.
 *
 * FocuSee's key insight: the screen ALWAYS tilts backward (negative RotateX)
 * like a tablet lying on a desk. Yaw (RotateY) shifts based on horizontal
 * focus offset. A subtle roll (RotateZ) tilts the card slightly based on
 * both horizontal and vertical position.
 *
 * FocuSee "normal" effect formulas (from CreateAtPoint IL, AutoEffectEnum=2):
 *   RotateX = -30 + cy * 5            degrees (always negative = backward tilt)
 *   RotateY = 20 + cx * (-40)         degrees (proportional to horizontal position)
 *   RotateZ = (cx - 0.5) * 2 * cy * (-4)  degrees (subtle roll)
 *   FOV     = 30°
 *
 * COORDINATE SYSTEM NOTE:
 * FocuSee uses WPF Viewport3D where +RotateY = counter-clockwise from above
 * (left side toward camera). Our GLSL ray-plane shader uses standard math
 * convention where +RotateY = clockwise from above (right side toward camera).
 * We negate RotateY after computing from FocuSee's formulas to compensate.
 */

import type { Zoom3DConfig, Zoom3DPreset, ZoomFocus } from "../types";
import type { PerspectiveWarpFilter } from "./perspectiveWarpFilter";

const DEG2RAD = Math.PI / 180;

// ── FocuSee preset parameters (decoded from CreateAtPoint IL bytecode) ──

interface Preset3DParams {
  /** Pitch at cy=0 (top of screen) */
  minPitch: number;
  /** Pitch at cy=1 (bottom of screen) */
  maxPitch: number;
  /** Yaw at cx=0 (left edge) */
  maxYaw: number;
  /** Yaw at cx=1 (right edge) */
  minYaw: number;
  /** Roll modulation factor (0 = no roll) */
  rollFactor: number;
  /** Field of view in degrees */
  fov: number;
}

export const PRESET_PARAMS: Record<Zoom3DPreset, Preset3DParams> = {
  weak: {
    minPitch: -12, maxPitch: -18,
    maxYaw: 20, minYaw: -20,
    rollFactor: 0,
    fov: 30,
  },
  normal: {
    minPitch: -30, maxPitch: -25,
    maxYaw: 20, minYaw: -20,
    rollFactor: -4,
    fov: 30,
  },
  strong: {
    minPitch: -35, maxPitch: -20,
    maxYaw: 25, minYaw: -25,
    rollFactor: -6,
    fov: 35,
  },
};

// ── Types ──────────────────────────────────────────────────

export interface Transform3DResult {
  /** Pitch in radians: negative = top tilts away (FocuSee convention) */
  rotateX: number;
  /** Yaw in radians: negative = right side tilts away (FocuSee convention) */
  rotateY: number;
  /** Roll in radians: subtle card tilt based on focus position */
  rotateZ: number;
  /** Field of view in radians */
  fov: number;
  /** Effect strength: progress × intensity (0–1) */
  strength: number;
}

// ── Public API ─────────────────────────────────────────────

/**
 * Compute 3D camera rotation from zoom focus position, config, and progress.
 *
 * Uses FocuSee's exact CreateAtPoint IL formulas with preset support:
 *   RotateX = minPitch + cy * (maxPitch - minPitch)
 *   RotateY = maxYaw + cx * (minYaw - maxYaw)  (negated for GLSL convention)
 *   RotateZ = (cx-0.5)*2 * cy * rollFactor
 *
 * Returns TARGET rotation angles. Spring animation handles smoothing.
 */
export function compute3DTransform(
  config: Zoom3DConfig,
  focus: ZoomFocus,
  progress: number,
): Transform3DResult {
  const preset = config.preset ?? "normal";
  const params = PRESET_PARAMS[preset];
  const fov = ((config.fov ?? params.fov) * Math.PI) / 180;

  if (!config.enabled || progress <= 0 || config.intensity <= 0) {
    return { rotateX: 0, rotateY: 0, rotateZ: 0, fov, strength: 0 };
  }

  const strength = progress * config.intensity;

  // RotateX = minPitch + cy * (maxPitch - minPitch)
  const rotateXDeg =
    params.minPitch + focus.cy * (params.maxPitch - params.minPitch);

  // RotateY = maxYaw + cx * (minYaw - maxYaw) — FocuSee formula
  // NEGATED to map from WPF convention (+Y = left toward camera) to our
  // GLSL shader convention (+Y = right toward camera)
  const rotateYDeg =
    -(params.maxYaw + focus.cx * (params.minYaw - params.maxYaw));

  // RotateZ = (cx - 0.5) * 2 * cy * rollFactor
  const rotateZDeg =
    (focus.cx - 0.5) * 2 * focus.cy * params.rollFactor;

  return {
    rotateX: rotateXDeg * DEG2RAD,
    rotateY: rotateYDeg * DEG2RAD,
    rotateZ: rotateZDeg * DEG2RAD,
    fov,
    strength,
  };
}

/**
 * Apply the 3D perspective effect to a PerspectiveWarpFilter.
 * Returns the computed transform so callers can use it for shadow/spotlight.
 */
export function apply3DPerspective(
  filter: PerspectiveWarpFilter,
  config: Zoom3DConfig,
  focus: ZoomFocus,
  progress: number,
): Transform3DResult {
  const result = compute3DTransform(config, focus, progress);

  // Apply rotation scaled by strength (progress × intensity)
  filter.rotateX = result.rotateX * result.strength;
  filter.rotateY = result.rotateY * result.strength;
  filter.rotateZ = result.rotateZ * result.strength;
  filter.fov = result.fov;

  return result;
}

/**
 * Check if 3D zoom should be active for the current state.
 */
export function is3DZoomActive(
  config: Zoom3DConfig | undefined,
  progress: number,
): boolean {
  return !!config?.enabled && progress > 0 && config.intensity > 0;
}

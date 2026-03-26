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
 */

import type { Zoom3DConfig, ZoomFocus } from "../types";
import type { PerspectiveWarpFilter } from "./perspectiveWarpFilter";

// ── Constants (from FocuSee "normal" effect, AutoEffectEnum=2) ─────

const DEG2RAD = Math.PI / 180;

/**
 * Pitch interpolation endpoints — minPitch at cy=0, maxPitch at cy=1.
 * FocuSee computes: RotateX = minPitch + cy * (maxPitch - minPitch)
 */
const MIN_PITCH_DEG = -30; // pitch at cy=0 (top of screen → steeper tilt)
const MAX_PITCH_DEG = -25; // pitch at cy=1 (bottom of screen → shallower tilt)

/**
 * Yaw interpolation: RotateY = maxYaw + cx * (minYaw - maxYaw)
 * At cx=0: maxYaw=20°, at cx=1: minYaw=-20°
 */
const MAX_YAW_DEG = 20;
const MIN_YAW_DEG = -20;

/** Roll factor: RotateZ = (cx-0.5)*2 * cy * ROLL_FACTOR */
const ROLL_FACTOR_DEG = -4;

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
 * Uses FocuSee's exact CreateAtPoint IL formulas (normal effect):
 *   RotateX = -30 + cy * 5             (always backward, shallower at bottom)
 *   RotateY = 20 - cx * 40             (yaw from horizontal position)
 *   RotateZ = (cx-0.5)*2 * cy * (-4)   (subtle roll)
 *
 * Returns TARGET rotation angles. Spring animation handles smoothing.
 */
export function compute3DTransform(
  config: Zoom3DConfig,
  focus: ZoomFocus,
  progress: number,
): Transform3DResult {
  const fov = ((config.fov ?? 30) * Math.PI) / 180;

  if (!config.enabled || progress <= 0 || config.intensity <= 0) {
    return { rotateX: 0, rotateY: 0, rotateZ: 0, fov, strength: 0 };
  }

  const strength = progress * config.intensity;

  // FocuSee "normal" effect (reverse-engineered from CreateAtPoint IL bytecode)
  // RotateX = minPitch + cy * (maxPitch - minPitch)
  const rotateXDeg =
    MIN_PITCH_DEG + focus.cy * (MAX_PITCH_DEG - MIN_PITCH_DEG);

  // RotateY = maxYaw + cx * (minYaw - maxYaw)
  const rotateYDeg =
    MAX_YAW_DEG + focus.cx * (MIN_YAW_DEG - MAX_YAW_DEG);

  // RotateZ = (cx - 0.5) * 2 * cy * rollFactor
  const rotateZDeg =
    (focus.cx - 0.5) * 2 * focus.cy * ROLL_FACTOR_DEG;

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

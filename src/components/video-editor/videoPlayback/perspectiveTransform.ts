/**
 * 3D perspective transform — FocuSee-style camera rotation from focus position.
 *
 * Matches FocuSee's Trans3DCommand architecture exactly, using rotation
 * formulas reverse-engineered from TransformMatrix.CreateAtPoint().
 *
 * FocuSee's key insight: the screen ALWAYS tilts backward (negative RotateX)
 * like a tablet lying on a desk. Yaw (RotateY) shifts based on horizontal
 * focus offset. This creates the distinctive "floating tablet" look.
 *
 * FocuSee "weak" effect formulas (from CreateAtPoint):
 *   RotateX = -15 + (0.5 - cy) * 6  degrees (always negative = backward tilt)
 *   RotateY = -(cx - 0.5) * 40       degrees (proportional to horizontal offset)
 *   FOV     = 30°
 */

import type { Zoom3DConfig, ZoomFocus } from "../types";
import type { PerspectiveWarpFilter } from "./perspectiveWarpFilter";

// ── Constants (from FocuSee "weak" effect) ─────────────────

const DEG2RAD = Math.PI / 180;

/** Base backward pitch — always applied, creates "tablet on desk" look */
const BASE_PITCH_DEG = -15;

/** How much vertical focus offset modulates the pitch (degrees per unit dy) */
const PITCH_Y_SCALE_DEG = 6;

/** Yaw scale: degrees per unit horizontal offset from center */
const YAW_X_SCALE_DEG = 40;

// ── Types ──────────────────────────────────────────────────

export interface Transform3DResult {
  /** Pitch in radians: negative = top tilts away (FocuSee convention) */
  rotateX: number;
  /** Yaw in radians: negative = right side tilts away (FocuSee convention) */
  rotateY: number;
  /** Field of view in radians */
  fov: number;
  /** Effect strength: progress × intensity (0–1) */
  strength: number;
}

// ── Public API ─────────────────────────────────────────────

/**
 * Compute 3D camera rotation from zoom focus position, config, and progress.
 *
 * Uses FocuSee's exact CreateAtPoint formulas:
 *   RotateX = BASE_PITCH + (0.5 - cy) * PITCH_Y_SCALE  (always backward)
 *   RotateY = -(cx - 0.5) * YAW_X_SCALE                (horizontal offset)
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
    return { rotateX: 0, rotateY: 0, fov, strength: 0 };
  }

  const dx = focus.cx - 0.5; // positive = right of center
  const dy = focus.cy - 0.5; // positive = below center

  const strength = progress * config.intensity;

  // FocuSee "weak" effect formulas (reverse-engineered from CreateAtPoint)
  const rotateXDeg = BASE_PITCH_DEG + (0.5 - focus.cy) * PITCH_Y_SCALE_DEG;
  const rotateYDeg = -dx * YAW_X_SCALE_DEG;

  return {
    rotateX: rotateXDeg * DEG2RAD,
    rotateY: rotateYDeg * DEG2RAD,
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

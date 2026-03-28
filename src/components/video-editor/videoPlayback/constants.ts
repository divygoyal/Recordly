import type { ZoomFocus } from "../types";

export const DEFAULT_FOCUS: ZoomFocus = { cx: 0.5, cy: 0.5 };
// Legacy: kept for backward compat. No longer used for animation timing —
// the unified spring system controls settle time.
export const TRANSITION_WINDOW_MS = 1000;
export const ZOOM_IN_TRANSITION_WINDOW_MS = 400;
// Time after region.endMs during which the region stays "active" so the
// unified spring has time to settle back to zero. Longer than the old
// TRANSITION_WINDOW_MS because the spring's natural decay is smoother.
export const ZOOM_OUT_ACTIVE_WINDOW_MS = 1200;
export const MIN_DELTA = 0.0001;
export const VIEWPORT_SCALE = 0.8;
export const ZOOM_TRANSLATION_DEADZONE_PX = 1.25;
export const ZOOM_SCALE_DEADZONE = 0.002;


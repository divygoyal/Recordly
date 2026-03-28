import type { ZoomFocus, ZoomRegion } from "../types";
import {
  ZOOM_DEPTH_SCALES,
} from "../types";
import { ZOOM_OUT_ACTIVE_WINDOW_MS, ZOOM_IN_TRANSITION_WINDOW_MS } from "./constants";
import { clampFocusToScale } from "./focusUtils";
import { clamp01, cubicBezier } from "./mathUtils";

const CHAINED_ZOOM_PAN_GAP_MS = 1500;
const CONNECTED_ZOOM_PAN_DURATION_MS = 1000;
const ZOOM_IN_OVERLAP_MS = 150;

type DominantRegionOptions = {
  connectZooms?: boolean;
};

type ConnectedRegionPair = {
  currentRegion: ZoomRegion;
  nextRegion: ZoomRegion;
  transitionStart: number;
  transitionEnd: number;
};

type ConnectedPanTransition = {
  progress: number;
  startFocus: ZoomFocus;
  endFocus: ZoomFocus;
  startScale: number;
  endScale: number;
};

function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
}

function easeConnectedPan(value: number) {
  return cubicBezier(0.1, 0.0, 0.2, 1.0, value);
}

/**
 * Compute binary zoom target for a region at the given time.
 *
 * Returns 1.0 when the zoom should be fully engaged, 0.0 when it should
 * be fully disengaged. The unified spring system (stepUnifiedZoom) handles
 * ALL animation smoothing — no easing curves here.
 *
 * The lead-in overlap allows the spring to begin ramping before the region's
 * nominal startMs so the zoom "arrives" on time. The active window after
 * endMs keeps the region discoverable while the spring settles back to zero.
 */
export function computeRegionStrength(
  region: ZoomRegion,
  timeMs: number,
) {
  // Activation edge: start responding slightly before region.startMs
  // so the spring has time to ramp up and "arrive" when the region begins.
  const activationStart = region.startMs + ZOOM_IN_OVERLAP_MS - ZOOM_IN_TRANSITION_WINDOW_MS;

  // The region stays "active" (returning strength > 0) for a window after
  // endMs so the spring has time to settle back toward zero.
  const activeEnd = region.endMs + ZOOM_OUT_ACTIVE_WINDOW_MS;

  if (timeMs < activationStart || timeMs > activeEnd) {
    return 0;
  }

  // Inside the region's active time range: full engagement.
  // The spring drives the actual animated value from 0 → 1 → 0.
  if (timeMs >= activationStart && timeMs <= region.endMs) {
    return 1;
  }

  // After region.endMs: target is 0 (zoom-out), but we still return
  // a small non-zero value so this region stays discoverable by
  // getActiveRegion() while the spring settles. The actual zoom
  // progress comes from the spring state, not from this value.
  return 0.001;
}

function getLinearFocus(start: ZoomFocus, end: ZoomFocus, amount: number): ZoomFocus {
  return {
    cx: lerp(start.cx, end.cx, amount),
    cy: lerp(start.cy, end.cy, amount),
  };
}

function getResolvedFocus(region: ZoomRegion, zoomScale: number): ZoomFocus {
  return clampFocusToScale(region.focus, zoomScale);
}

function getConnectedRegionPairs(regions: ZoomRegion[]) {
  const sortedRegions = [...regions].sort((a, b) => a.startMs - b.startMs);
  const pairs: ConnectedRegionPair[] = [];

  for (let index = 0; index < sortedRegions.length - 1; index += 1) {
    const currentRegion = sortedRegions[index];
    const nextRegion = sortedRegions[index + 1];
    const gapMs = nextRegion.startMs - currentRegion.endMs;

    if (gapMs > CHAINED_ZOOM_PAN_GAP_MS) {
      continue;
    }

    pairs.push({
      currentRegion,
      nextRegion,
      transitionStart: currentRegion.endMs,
      transitionEnd: currentRegion.endMs + CONNECTED_ZOOM_PAN_DURATION_MS,
    });
  }

  return pairs;
}

function getActiveRegion(
  regions: ZoomRegion[],
  timeMs: number,
  connectedPairs: ConnectedRegionPair[],
) {
  const activeRegions = regions
    .map((region) => {
      const outgoingPair = connectedPairs.find((pair) => pair.currentRegion.id === region.id);
      if (outgoingPair && timeMs > outgoingPair.currentRegion.endMs) {
        return { region, strength: 0 };
      }

      const incomingPair = connectedPairs.find((pair) => pair.nextRegion.id === region.id);
      if (incomingPair && timeMs < incomingPair.transitionEnd) {
        return { region, strength: 0 };
      }

      return { region, strength: computeRegionStrength(region, timeMs) };
    })
    .filter((entry) => entry.strength > 0)
    .sort((left, right) => {
      if (right.strength !== left.strength) {
        return right.strength - left.strength;
      }

      return right.region.startMs - left.region.startMs;
    });

  if (activeRegions.length === 0) {
    return null;
  }

  const activeRegion = activeRegions[0].region;
  const activeScale = ZOOM_DEPTH_SCALES[activeRegion.depth];

  return {
    region: {
      ...activeRegion,
      focus: getResolvedFocus(activeRegion, activeScale),
    },
    strength: activeRegions[0].strength,
    blendedScale: null,
  };
}

function getConnectedRegionHold(timeMs: number, connectedPairs: ConnectedRegionPair[]) {
  for (const pair of connectedPairs) {
    if (timeMs > pair.transitionEnd && timeMs < pair.nextRegion.startMs) {
      const nextScale = ZOOM_DEPTH_SCALES[pair.nextRegion.depth];
      return {
        region: {
          ...pair.nextRegion,
          focus: getResolvedFocus(pair.nextRegion, nextScale),
        },
        strength: 1,
        blendedScale: null,
      };
    }
  }

  return null;
}

function getConnectedRegionTransition(
  connectedPairs: ConnectedRegionPair[],
  timeMs: number,
) {
  for (const pair of connectedPairs) {
    const { currentRegion, nextRegion, transitionStart, transitionEnd } = pair;

    if (timeMs < transitionStart || timeMs > transitionEnd) {
      continue;
    }

    const transitionProgress = easeConnectedPan(
      clamp01((timeMs - transitionStart) / Math.max(1, transitionEnd - transitionStart)),
    );
    const currentScale = ZOOM_DEPTH_SCALES[currentRegion.depth];
    const nextScale = ZOOM_DEPTH_SCALES[nextRegion.depth];
    const transitionScale = lerp(currentScale, nextScale, transitionProgress);
    const currentFocus = getResolvedFocus(currentRegion, currentScale);
    const nextFocus = getResolvedFocus(nextRegion, nextScale);
    const transitionFocus = getLinearFocus(currentFocus, nextFocus, transitionProgress);

    return {
      region: {
        ...nextRegion,
        focus: transitionFocus,
      },
      strength: 1,
      blendedScale: transitionScale,
      transition: {
        progress: transitionProgress,
        startFocus: currentFocus,
        endFocus: nextFocus,
        startScale: currentScale,
        endScale: nextScale,
      },
    };
  }

  return null;
}

export function findDominantRegion(regions: ZoomRegion[], timeMs: number, options: DominantRegionOptions = {}): {
  region: ZoomRegion | null;
  strength: number;
  blendedScale: number | null;
  transition: ConnectedPanTransition | null;
} {
  const connectedPairs = options.connectZooms
    ? getConnectedRegionPairs(regions)
    : [];

  if (options.connectZooms) {
    const connectedTransition = getConnectedRegionTransition(connectedPairs, timeMs);
    if (connectedTransition) {
      return connectedTransition;
    }

    const connectedHold = getConnectedRegionHold(timeMs, connectedPairs);
    if (connectedHold) {
      return { ...connectedHold, transition: null };
    }
  }

  const activeRegion = getActiveRegion(regions, timeMs, connectedPairs);
  return activeRegion
    ? { ...activeRegion, transition: null }
    : { region: null, strength: 0, blendedScale: null, transition: null };
}


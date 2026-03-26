import { describe, it, expect } from "vitest";
import {
  compute3DTransform,
  is3DZoomActive,
} from "./perspectiveTransform";
import type { Zoom3DConfig } from "../types";

function makeConfig(
  intensity = 0.5,
  enabled = true,
): Zoom3DConfig {
  return { enabled, intensity };
}

const DEG2RAD = Math.PI / 180;

describe("compute3DTransform", () => {
  it("always tilts backward (negative rotateX) even at center", () => {
    const { rotateX, rotateY } = compute3DTransform(
      makeConfig(1.0),
      { cx: 0.5, cy: 0.5 },
      1,
    );
    // FocuSee: RotateX = -15° at center, RotateY = 0°
    expect(rotateX).toBeCloseTo(-15 * DEG2RAD, 2);
    expect(rotateY).toBeCloseTo(0, 3);
  });

  it("yaws when focus is on the left edge (left tilts away)", () => {
    const { rotateY } = compute3DTransform(
      makeConfig(1),
      { cx: 0.1, cy: 0.5 },
      1,
    );
    // Focus left → positive rotateY
    expect(rotateY).toBeGreaterThan(0);
    expect(rotateY).toBeCloseTo(0.4 * 40 * DEG2RAD, 2); // dx=-0.4, yaw=+16°
  });

  it("yaws when focus is on the right edge (right tilts away)", () => {
    const { rotateY } = compute3DTransform(
      makeConfig(1),
      { cx: 0.9, cy: 0.5 },
      1,
    );
    // Focus right → negative rotateY
    expect(rotateY).toBeLessThan(0);
    expect(rotateY).toBeCloseTo(-0.4 * 40 * DEG2RAD, 2); // dx=0.4, yaw=-16°
  });

  it("pitches more backward when focus is near top", () => {
    const { rotateX } = compute3DTransform(
      makeConfig(1),
      { cx: 0.5, cy: 0.1 },
      1,
    );
    // FocuSee: RotateX = -15 + (0.5-0.1)*6 = -15 + 2.4 = -12.6°
    expect(rotateX).toBeCloseTo(-12.6 * DEG2RAD, 2);
  });

  it("pitches more backward when focus is near bottom", () => {
    const { rotateX } = compute3DTransform(
      makeConfig(1),
      { cx: 0.5, cy: 0.9 },
      1,
    );
    // FocuSee: RotateX = -15 + (0.5-0.9)*6 = -15 - 2.4 = -17.4°
    expect(rotateX).toBeCloseTo(-17.4 * DEG2RAD, 2);
  });

  it("matches FocuSee at (0.75, 0.25)", () => {
    const { rotateX, rotateY } = compute3DTransform(
      makeConfig(1),
      { cx: 0.75, cy: 0.25 },
      1,
    );
    // FocuSee weak: RX=-13.5°, RY=-10°
    expect(rotateX).toBeCloseTo(-13.5 * DEG2RAD, 2);
    expect(rotateY).toBeCloseTo(-10 * DEG2RAD, 2);
  });

  it("higher intensity produces stronger strength value", () => {
    const low = compute3DTransform(makeConfig(0.2), { cx: 0.1, cy: 0.5 }, 1);
    const high = compute3DTransform(makeConfig(0.8), { cx: 0.1, cy: 0.5 }, 1);
    expect(Math.abs(high.strength)).toBeGreaterThan(Math.abs(low.strength));
  });

  it("progress = 0 produces zero strength", () => {
    const { strength } = compute3DTransform(
      makeConfig(1),
      { cx: 0.1, cy: 0.1 },
      0,
    );
    expect(strength).toBe(0);
  });

  it("returns zero rotation when disabled", () => {
    const { rotateX, rotateY, strength } = compute3DTransform(
      makeConfig(0.5, false),
      { cx: 0.1, cy: 0.1 },
      1,
    );
    expect(rotateX).toBe(0);
    expect(rotateY).toBe(0);
    expect(strength).toBe(0);
  });

  it("returns fov from config", () => {
    const { fov } = compute3DTransform(
      { enabled: true, intensity: 0.5, fov: 60 },
      { cx: 0.5, cy: 0.5 },
      1,
    );
    expect(fov).toBeCloseTo(Math.PI / 3, 3);
  });

  it("defaults to 30° fov when not specified", () => {
    const { fov } = compute3DTransform(
      makeConfig(0.5),
      { cx: 0.5, cy: 0.5 },
      1,
    );
    expect(fov).toBeCloseTo((30 * Math.PI) / 180, 3);
  });

  it("rotateX always negative (backward tilt) across all positions", () => {
    const positions = [
      { cx: 0.0, cy: 0.0 },
      { cx: 0.5, cy: 0.5 },
      { cx: 1.0, cy: 1.0 },
      { cx: 0.75, cy: 0.25 },
      { cx: 0.25, cy: 0.75 },
    ];
    for (const focus of positions) {
      const { rotateX } = compute3DTransform(makeConfig(1), focus, 1);
      expect(rotateX).toBeLessThan(0);
    }
  });
});

describe("is3DZoomActive", () => {
  it("returns false for undefined config", () => {
    expect(is3DZoomActive(undefined, 1)).toBe(false);
  });

  it("returns false when disabled", () => {
    expect(is3DZoomActive(makeConfig(0.5, false), 1)).toBe(false);
  });

  it("returns false when progress is 0", () => {
    expect(is3DZoomActive(makeConfig(0.5, true), 0)).toBe(false);
  });

  it("returns false when intensity is 0", () => {
    expect(is3DZoomActive({ enabled: true, intensity: 0 }, 1)).toBe(false);
  });

  it("returns true when active", () => {
    expect(is3DZoomActive(makeConfig(0.5, true), 0.5)).toBe(true);
  });
});

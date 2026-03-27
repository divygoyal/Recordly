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
    const { rotateX, rotateY, rotateZ } = compute3DTransform(
      makeConfig(1.0),
      { cx: 0.5, cy: 0.5 },
      1,
    );
    // Widened pitch: RotateX = -38 + 0.5*20 = -28°, RotateY = 0°, RotateZ = 0°
    expect(rotateX).toBeCloseTo(-28 * DEG2RAD, 2);
    expect(rotateY).toBeCloseTo(0, 3);
    expect(rotateZ).toBeCloseTo(0, 3);
  });

  it("yaws when focus is on the left edge (left side toward camera)", () => {
    const { rotateY } = compute3DTransform(
      makeConfig(1),
      { cx: 0.1, cy: 0.5 },
      1,
    );
    // Focus left → negative rotateY (left side closer in our shader convention)
    // RotateY = -(28 + 0.1*(-56)) = -22.4°
    expect(rotateY).toBeLessThan(0);
    expect(rotateY).toBeCloseTo(-22.4 * DEG2RAD, 2);
  });

  it("yaws when focus is on the right edge (right side toward camera)", () => {
    const { rotateY } = compute3DTransform(
      makeConfig(1),
      { cx: 0.9, cy: 0.5 },
      1,
    );
    // Focus right → positive rotateY (right side closer in our shader convention)
    // RotateY = -(28 + 0.9*(-56)) = 22.4°
    expect(rotateY).toBeGreaterThan(0);
    expect(rotateY).toBeCloseTo(22.4 * DEG2RAD, 2);
  });

  it("pitches more backward when focus is near top", () => {
    const { rotateX } = compute3DTransform(
      makeConfig(1),
      { cx: 0.5, cy: 0.1 },
      1,
    );
    // RotateX = -38 + 0.1*20 = -36°
    expect(rotateX).toBeCloseTo(-36 * DEG2RAD, 2);
  });

  it("pitches less backward when focus is near bottom", () => {
    const { rotateX } = compute3DTransform(
      makeConfig(1),
      { cx: 0.5, cy: 0.9 },
      1,
    );
    // RotateX = -38 + 0.9*20 = -20°
    expect(rotateX).toBeCloseTo(-20 * DEG2RAD, 2);
  });

  it("matches expected values at (0.75, 0.25)", () => {
    const { rotateX, rotateY, rotateZ } = compute3DTransform(
      makeConfig(1),
      { cx: 0.75, cy: 0.25 },
      1,
    );
    // RX=-33°, RY=14° (negated for shader), RZ=-0.75°
    expect(rotateX).toBeCloseTo(-33 * DEG2RAD, 2);
    expect(rotateY).toBeCloseTo(14 * DEG2RAD, 2);
    expect(rotateZ).toBeCloseTo(-0.75 * DEG2RAD, 2);
  });

  it("computes roll (rotateZ) based on position", () => {
    const { rotateZ } = compute3DTransform(
      makeConfig(1),
      { cx: 0.0, cy: 1.0 },
      1,
    );
    // RZ = (0-0.5)*2*1.0*(-6) = 6°
    expect(rotateZ).toBeCloseTo(6 * DEG2RAD, 2);
  });

  it("roll is zero at center x", () => {
    const { rotateZ } = compute3DTransform(
      makeConfig(1),
      { cx: 0.5, cy: 1.0 },
      1,
    );
    // RZ = (0.5-0.5)*2*1.0*(-4) = 0
    expect(rotateZ).toBeCloseTo(0, 5);
  });

  it("roll is zero at top edge", () => {
    const { rotateZ } = compute3DTransform(
      makeConfig(1),
      { cx: 0.0, cy: 0.0 },
      1,
    );
    // RZ = (-0.5)*2*0*(-4) = 0
    expect(rotateZ).toBeCloseTo(0, 5);
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
    const { rotateX, rotateY, rotateZ, strength } = compute3DTransform(
      makeConfig(0.5, false),
      { cx: 0.1, cy: 0.1 },
      1,
    );
    expect(rotateX).toBe(0);
    expect(rotateY).toBe(0);
    expect(rotateZ).toBe(0);
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

  it("defaults to 25° fov when not specified", () => {
    const { fov } = compute3DTransform(
      makeConfig(0.5),
      { cx: 0.5, cy: 0.5 },
      1,
    );
    expect(fov).toBeCloseTo((25 * Math.PI) / 180, 3);
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

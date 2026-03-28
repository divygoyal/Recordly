import { Filter, GlProgram } from "pixi.js";

/**
 * Perspective warp filter — proper 3D camera projection matching FocuSee's
 * Trans3DCommand architecture (RotateX/Y + Fov + perspectiveDistance).
 *
 * Uses ray-plane intersection to render a flat surface rotated in 3D space.
 * The camera sits at the origin looking along +Z; the surface is a unit quad
 * at z=1, rotated by pitch (X) and yaw (Y).
 *
 * Features:
 *   - True perspective projection with field-of-view control
 *   - Independent pitch (RotateX) and yaw (RotateY) rotation
 *   - Content inset for "floating card" look (dark background visible around edges)
 *   - Rounded corners on the tilted surface
 *   - Feathered edges for "floating screen" look
 */

const VERTEX = /* glsl */ `
  in vec2 aPosition;
  out vec2 vTextureCoord;
  out vec2 vMaxUV;

  uniform vec4 uInputSize;
  uniform vec4 uOutputFrame;
  uniform vec4 uOutputTexture;

  vec4 filterVertexPosition(void) {
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
  }

  vec2 filterTextureCoord(void) {
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
  }

  void main(void) {
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();

    // PixiJS allocates power-of-2 textures (source.width >= frame.width).
    // vTextureCoord ranges from 0 to maxUV, NOT 0 to 1.
    vMaxUV = uOutputFrame.zw * uInputSize.zw;
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;
  in vec2 vTextureCoord;
  in vec2 vMaxUV;
  out vec4 finalColor;

  uniform sampler2D uTexture;
  uniform vec4 uOutputFrame;     // PixiJS global: xy=offset, zw=frame size (px)
  uniform float uRotateX;       // pitch (radians): negative = top tilts away
  uniform float uRotateY;       // yaw (radians): negative = right side tilts away
  uniform float uRotateZ;       // roll (radians): subtle card tilt
  uniform float uFov;           // field of view (radians)
  uniform float uCornerRadius;  // corner rounding in content-UV space (FocuSee: 0.04)
  uniform float uContentInset;  // inset for floating card padding (FocuSee: 0.05)
  uniform float uFilterPadding; // FILTER_PADDING in pixels (150) — needed to map SDF to video content
  uniform float uDebugMode;     // 0=normal, 1=passthrough (diagnostic)
  uniform float uVignetteStrength; // 0–0.5: darkens card edges during zoom
  uniform float uFocusBrightness; // 0–0.2: brightens area near focus point
  uniform vec2  uFocusCenter;     // focus position in content-UV space (cx, cy)

  // Signed distance to a rounded rectangle centered at origin.
  // b = half-size, r = corner radius. Returns negative inside, positive outside.
  float roundedBoxSDF(vec2 p, vec2 b, float r) {
    vec2 d = abs(p) - b + r;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
  }

  void main(void) {
    // ── Diagnostic passthrough ────────────────────────────────
    // When uDebugMode > 0.5, output the raw filter texture with
    // a red border and magenta for empty (transparent) regions.
    // This helps determine if the filter texture has video content.
    if (uDebugMode > 0.5) {
      vec2 fc = vTextureCoord / vMaxUV;
      // Red border at frame edges
      if (fc.x < 0.004 || fc.x > 0.996 || fc.y < 0.004 || fc.y > 0.996) {
        finalColor = vec4(1.0, 0.0, 0.0, 1.0);
        return;
      }
      vec4 raw = texture(uTexture, vTextureCoord);
      if (raw.a > 0.01) {
        finalColor = raw;
      } else {
        // Semi-transparent magenta where filter texture is empty
        finalColor = vec4(1.0, 0.0, 1.0, 0.3);
      }
      return;
    }

    // ── Normal 3D perspective projection ──────────────────────
    // Normalize to "frame space" (0-1 within the actual content frame).
    // PixiJS PO2 textures mean vTextureCoord maxes at vMaxUV, not 1.0.
    vec2 frameCoord = vTextureCoord / vMaxUV;

    // Screen coordinates: -1 to +1, centered on the frame.
    vec2 screen = (frameCoord - 0.5) * 2.0;
    float ps = tan(uFov * 0.5);

    vec3 rayDir = vec3(screen.x * ps, screen.y * ps, 1.0);

    float cX = cos(uRotateX), sX = sin(uRotateX);
    float cY = cos(uRotateY), sY = sin(uRotateY);
    float cZ = cos(uRotateZ), sZ = sin(uRotateZ);

    vec3 normal = vec3(
      sY * cX * cZ + sX * sZ,
      sY * cX * sZ - sX * cZ,
      cY * cX
    );

    vec3 center = vec3(0.0, 0.0, 1.0);

    float denom = dot(normal, rayDir);
    if (abs(denom) < 0.0001) {
      finalColor = vec4(0.0);
      return;
    }

    float t = dot(normal, center) / denom;
    if (t <= 0.0) {
      finalColor = vec4(0.0);
      return;
    }

    vec3 hit = rayDir * t;
    vec3 offset = hit - center;

    float localX = cY * cZ * offset.x + cY * sZ * offset.y + (-sY) * offset.z;
    float localY = (sY * sX * cZ - cX * sZ) * offset.x
                 + (sY * sX * sZ + cX * cZ) * offset.y
                 + cY * sX * offset.z;

    // texUV is in "frame space" (0-1 within the frame), matching frameCoord.
    vec2 texUV = vec2(localX, localY) / (2.0 * ps) + 0.5;

    // ── Discard rays that land outside the frame texture ─────────
    // At large rotation angles, rays can escape the padded texture
    // entirely. Discard these early to prevent edge artifacts.
    if (texUV.x < -0.01 || texUV.x > 1.01 || texUV.y < -0.01 || texUV.y > 1.01) {
      finalColor = vec4(0.0);
      return;
    }

    // ── Content-aware SDF ──────────────────────────────────────
    // FILTER_PADDING adds extra pixels around the video content in the
    // filter texture. texUV (= frameCoord at identity) spans the FULL
    // padded texture 0-1. The actual video content only occupies the
    // centre portion. Remap to "content UV" so SDF corners align with
    // the real video edges (not the padding boundary).
    float padFracX = uFilterPadding / uOutputFrame.z;
    float padFracY = uFilterPadding / uOutputFrame.w;
    vec2 contentOrigin = vec2(padFracX, padFracY);
    vec2 contentScale  = vec2(1.0 - 2.0 * padFracX, 1.0 - 2.0 * padFracY);
    vec2 contentUV = (texUV - contentOrigin) / contentScale;

    float inset = uContentInset;
    float halfW = 0.5 - inset;
    float halfH = 0.5 - inset;
    float cr = uCornerRadius;
    vec2 cardCenter = contentUV - 0.5;
    float dist = roundedBoxSDF(cardCenter, vec2(halfW, halfH), cr);

    // Anti-aliased edge in content-UV space
    float contentPxW = uOutputFrame.z - 2.0 * uFilterPadding;
    float contentPxH = uOutputFrame.w - 2.0 * uFilterPadding;
    float feather = 1.5 / max(contentPxW, contentPxH);
    float alpha = 1.0 - smoothstep(-feather, feather, dist);

    if (alpha < 0.001) {
      finalColor = vec4(0.0);
      return;
    }

    // Sample the texture. Clamp to valid range to avoid edge bleeding.
    vec2 sampleUV = clamp(texUV, vec2(0.0), vec2(1.0)) * vMaxUV;
    vec4 texColor = texture(uTexture, sampleUV);

    // Depth layers: vignette darkening + focus brightness (in content UV)
    if (uVignetteStrength > 0.001 || uFocusBrightness > 0.001) {
      vec2 vigUV = (contentUV - 0.5) * 2.0; // -1 to 1 across content
      float vigDist = dot(vigUV, vigUV);
      float darken = 1.0 - uVignetteStrength * vigDist;

      vec2 focusDelta = contentUV - uFocusCenter;
      float focusDist2 = dot(focusDelta, focusDelta);
      float brighten = uFocusBrightness * exp(-8.0 * focusDist2);

      texColor.rgb *= clamp(darken + brighten, 0.0, 1.5);
    }

    finalColor = texColor * alpha;
  }
`;

/** Corner radius matching FocuSee's backgroundRound (0.04) */
const DEFAULT_CORNER_RADIUS = 0.04;

/** Default FOV in radians — matches FocuSee's normal/weak preset (30°) */
const DEFAULT_FOV = (30 * Math.PI) / 180; // 30° in radians

/** Extra padding so warped pixels aren't clipped at edges.
 *  Keep low — combined with resolution and clipToViewport settings
 *  the PO2 filter texture must stay ≤ GPU MAX_TEXTURE_SIZE (4096). */
export const FILTER_PADDING = 150;

export class PerspectiveWarpFilter extends Filter {
  constructor() {
    const glProgram = GlProgram.from({
      vertex: VERTEX,
      fragment: FRAGMENT,
      name: "perspective-warp-filter",
    });

    super({
      glProgram,
      resources: {
        perspectiveUniforms: {
          uRotateX: { value: 0, type: "f32" },
          uRotateY: { value: 0, type: "f32" },
          uRotateZ: { value: 0, type: "f32" },
          uFov: { value: DEFAULT_FOV, type: "f32" },
          uCornerRadius: { value: DEFAULT_CORNER_RADIUS, type: "f32" },
          uContentInset: { value: 0, type: "f32" },
          uFilterPadding: { value: FILTER_PADDING, type: "f32" },
          uDebugMode: { value: 0, type: "f32" },
          uVignetteStrength: { value: 0, type: "f32" },
          uFocusBrightness: { value: 0, type: "f32" },
          uFocusCenter: { value: new Float32Array([0.5, 0.5]), type: "vec2<f32>" },
        },
      },
      padding: FILTER_PADDING,
      // Resolution is set adaptively per-frame in VideoPlayback.tsx:
      // - At rest / shallow zoom: uses full renderer DPI (2-3×) for sharp output
      // - During deep zoom: falls back to 1 to keep the PO2 filter texture
      //   within GPU MAX_TEXTURE_SIZE (4096)
      // Default to 1 here; the ticker updates it each frame.
      resolution: 1,
      antialias: "inherit",
    });

    // Prevent PixiJS from clipping filter bounds to the viewport.
    // During zoom the camera scales the container well beyond the
    // viewport; clipping would misrepresent where the video content
    // sits inside the filter texture and could cause rendering gaps.
    this.clipToViewport = false;
  }

  /** Pitch rotation in radians: negative = top tilts away (FocuSee convention). */
  set rotateX(v: number) {
    this.resources.perspectiveUniforms.uniforms.uRotateX = v;
  }
  get rotateX(): number {
    return this.resources.perspectiveUniforms.uniforms.uRotateX as number;
  }

  /** Yaw rotation in radians: negative = right side tilts away (FocuSee convention). */
  set rotateY(v: number) {
    this.resources.perspectiveUniforms.uniforms.uRotateY = v;
  }
  get rotateY(): number {
    return this.resources.perspectiveUniforms.uniforms.uRotateY as number;
  }

  /** Roll rotation in radians: subtle card tilt. */
  set rotateZ(v: number) {
    this.resources.perspectiveUniforms.uniforms.uRotateZ = v;
  }
  get rotateZ(): number {
    return this.resources.perspectiveUniforms.uniforms.uRotateZ as number;
  }

  /** Field of view in radians (controls perspective strength). */
  set fov(v: number) {
    this.resources.perspectiveUniforms.uniforms.uFov = v;
  }
  get fov(): number {
    return this.resources.perspectiveUniforms.uniforms.uFov as number;
  }

  /** Rounded corner radius in UV space. */
  set cornerRadius(v: number) {
    this.resources.perspectiveUniforms.uniforms.uCornerRadius = v;
  }
  get cornerRadius(): number {
    return this.resources.perspectiveUniforms.uniforms.uCornerRadius as number;
  }

  /** Content inset (0–0.15): kept for uniform compat. */
  set contentInset(v: number) {
    this.resources.perspectiveUniforms.uniforms.uContentInset = v;
  }
  get contentInset(): number {
    return this.resources.perspectiveUniforms.uniforms.uContentInset as number;
  }

  /** Filter padding in pixels — matches FILTER_PADDING. */
  set filterPadding(v: number) {
    this.resources.perspectiveUniforms.uniforms.uFilterPadding = v;
  }
  get filterPadding(): number {
    return this.resources.perspectiveUniforms.uniforms.uFilterPadding as number;
  }

  /** Debug mode: 0=normal rendering, 1=passthrough (shows raw filter texture). */
  set debugMode(v: number) {
    this.resources.perspectiveUniforms.uniforms.uDebugMode = v;
  }
  get debugMode(): number {
    return this.resources.perspectiveUniforms.uniforms.uDebugMode as number;
  }

  /** Vignette strength (0–0.5): darkens edges for depth separation. */
  set vignetteStrength(v: number) {
    this.resources.perspectiveUniforms.uniforms.uVignetteStrength = v;
  }
  get vignetteStrength(): number {
    return this.resources.perspectiveUniforms.uniforms.uVignetteStrength as number;
  }

  /** Focus brightness boost (0–0.2): brightens area near focus point. */
  set focusBrightness(v: number) {
    this.resources.perspectiveUniforms.uniforms.uFocusBrightness = v;
  }
  get focusBrightness(): number {
    return this.resources.perspectiveUniforms.uniforms.uFocusBrightness as number;
  }

  /** Focus center in UV space [cx, cy] — where the spotlight is aimed. */
  set focusCenter(v: [number, number]) {
    const arr = this.resources.perspectiveUniforms.uniforms.uFocusCenter as Float32Array;
    arr[0] = v[0];
    arr[1] = v[1];
  }
  get focusCenter(): [number, number] {
    const arr = this.resources.perspectiveUniforms.uniforms.uFocusCenter as Float32Array;
    return [arr[0], arr[1]];
  }
}

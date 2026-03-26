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
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;
  in vec2 vTextureCoord;
  out vec4 finalColor;

  uniform sampler2D uTexture;
  uniform float uRotateX;       // pitch (radians): negative = top tilts away (FocuSee convention)
  uniform float uRotateY;       // yaw (radians): negative = right side tilts away (FocuSee convention)
  uniform float uRotateZ;       // roll (radians): subtle card tilt
  uniform float uFov;           // field of view (radians): controls perspective strength
  uniform float uCornerRadius;  // kept for uniform compat (corners handled by PixiJS mask)
  uniform float uContentInset;  // kept for uniform compat (padding handled by layout system)

  void main(void) {
    // Map output pixel to centered coords [-1, 1]
    vec2 screen = (vTextureCoord - 0.5) * 2.0;

    // Perspective strength from FOV
    float ps = tan(uFov * 0.5);

    // Ray from camera through this pixel
    vec3 rayDir = vec3(screen.x * ps, screen.y * ps, 1.0);

    // Rotation matrix R = Rz * Ry * Rx (roll * yaw * pitch)
    float cX = cos(uRotateX), sX = sin(uRotateX);
    float cY = cos(uRotateY), sY = sin(uRotateY);
    float cZ = cos(uRotateZ), sZ = sin(uRotateZ);

    // Surface normal after rotation: third column of R = Rz * Ry * Rx
    vec3 normal = vec3(
      sY * cX * cZ + sX * sZ,
      sY * cX * sZ - sX * cZ,
      cY * cX
    );

    // Surface center at z=1
    vec3 center = vec3(0.0, 0.0, 1.0);

    // Ray-plane intersection
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

    // Transform back to surface-local coords via R^T (transpose of R = Rz*Ry*Rx)
    float localX = cY * cZ * offset.x + cY * sZ * offset.y + (-sY) * offset.z;
    float localY = (sY * sX * cZ - cX * sZ) * offset.x
                 + (sY * sX * sZ + cX * cZ) * offset.y
                 + cY * sX * offset.z;

    // Map to UV [0, 1] — divide by 2*ps to normalize (identity when rotation=0)
    vec2 texUV = vec2(localX, localY) / (2.0 * ps) + 0.5;

    // Out-of-range → transparent
    if (texUV.x < -0.05 || texUV.x > 1.05 || texUV.y < -0.05 || texUV.y > 1.05) {
      finalColor = vec4(0.0);
      return;
    }

    vec2 sampleUV = clamp(texUV, 0.0, 1.0);
    finalColor = texture(uTexture, sampleUV);
  }
`;

/** Corner radius matching FocuSee's backgroundRound (0.04) */
const DEFAULT_CORNER_RADIUS = 0.04;

/** Default FOV in radians (30° — matching FocuSee's CreateAtPoint) */
const DEFAULT_FOV = 0.5236; // 30° in radians

/** Extra padding so warped pixels aren't clipped at edges */
const FILTER_PADDING = 300;

export class PerspectiveWarpFilter extends Filter {
  constructor(rendererResolution?: number) {
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
        },
      },
      padding: FILTER_PADDING,
      resolution: rendererResolution ?? 1,
      antialias: "inherit",
    });
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

  /** Content inset (0–0.15): shrinks content to create floating card padding. */
  set contentInset(v: number) {
    this.resources.perspectiveUniforms.uniforms.uContentInset = v;
  }
  get contentInset(): number {
    return this.resources.perspectiveUniforms.uniforms.uContentInset as number;
  }
}

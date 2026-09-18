// The ground the sculpture is carved from: the plate under the print.
//
// Three things share one plane and one draw call, all of them ink on
// paper rather than light:
//
//  - Ring ghosts. The ring grid runs to 52 weeks, but weeks below the
//    anonymity threshold and weeks still ahead emit no blocks, so most
//    of the grid is invisible. Drawing the nominal rings as concentric
//    squares puts the stock the sculpture was cut out of back on the
//    page. They are world-space, so they turn with the solid.
//  - The paper screen. The same ordered dither as the solid, at a low
//    coverage that drifts slowly across the plate, so the ground reads
//    as printed stock with uneven ink rather than as flat colour.
//  - Misregistration. The ring plate steps a fraction of a cell off
//    register now and then and comes back, the way a second pass lands
//    slightly off on press.
//
// Everything outside the marks is transparent: the page's own
// background and grid show through, and the WebGL layer only ever adds.

import * as THREE from "three";
import { INK_MUTED, SURFACE_BORDER } from "@/lib/palette";

/** Half-width of the nominal ring grid, in cells. 52 weeks plus the gutter. */
export const RING_LIMIT = 52.5;

/** Plane size. Ortho and far larger than any frustum, so it fills the frame. */
const PLANE_SIZE = 1200;

/** Sits just under the solid, whose blocks bottom out at y = 0. */
export const GROUND_Y = -0.02;

const DOT_CSS_PX = 2;
const RING_LINE_CSS_PX = 0.6;

/** Rings per quarter of the year, drawn heavier than the weekly ones. */
const QUARTER_RINGS = 13;

const BAYER_SIZE = 4;

function bayerMatrix(size: number): number[] {
  let matrix = [[0]];
  for (let n = 1; n < size; n *= 2) {
    const next: number[][] = [];
    for (let y = 0; y < n * 2; y++) next.push(new Array<number>(n * 2).fill(0));
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const base = 4 * matrix[y][x];
        next[y][x] = base;
        next[y][x + n] = base + 2;
        next[y + n][x] = base + 3;
        next[y + n][x + n] = base + 1;
      }
    }
    matrix = next;
  }
  return matrix.flat();
}

const BAYER = bayerMatrix(BAYER_SIZE).map((v) => (v + 0.5) / (BAYER_SIZE * BAYER_SIZE));

const VERTEX_SHADER = /* glsl */ `
varying vec2 vGround;

void main() {
  // The plane is rotated flat, so its local xy is the world xz.
  vGround = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uRing;
uniform vec3 uDot;
uniform float uDotPx;
uniform float uLinePx;
uniform float uTime;
uniform vec2 uRegistration;

varying vec2 vGround;

const float BAYER[${BAYER.length}] = float[${BAYER.length}](
  ${BAYER.map((v) => v.toFixed(6)).join(", ")}
);

void main() {
  // --- ring ghosts -------------------------------------------------
  // Ring r occupies cells with max(|x|,|z|) == r, so its outer boundary
  // sits at r + 0.5 and the boundaries are the integers of d + 0.5.
  vec2 p = vGround + uRegistration;
  float chebyshev = max(abs(p.x), abs(p.y));
  float d = chebyshev + 0.5;
  float texel = fwidth(d);

  // Only quarter rings. Weekly ones have a pitch of one cell, which is a
  // handful of pixels at any framing the page actually uses: they sit on
  // the resolution limit, so every frame of the turn re-samples them
  // somewhere different and the whole plate scintillates. A ring you
  // cannot resolve is moire, not information.
  float q = d / ${QUARTER_RINGS}.0;
  float quarterEdge = abs(q - floor(q + 0.5)) * ${QUARTER_RINGS}.0;
  float ring = 1.0 - smoothstep(0.0, texel * uLinePx * 2.2, quarterEdge);

  // Past the nominal grid there is no stock to draw.
  ring *= 1.0 - step(${RING_LIMIT.toFixed(1)}, chebyshev);

  // --- paper screen -------------------------------------------------
  // Coverage drifts in the plate's own space. The screen stays fixed to
  // the viewport here, unlike the solid's: the plate does not turn under
  // it the way the faces do, it only slides, so there is far less for
  // the dots to crawl against.
  float field = sin(vGround.x * 0.035 + uTime * 0.08) * sin(vGround.y * 0.029 - uTime * 0.061);
  float coverage = 0.09 + 0.05 * field;

  ivec2 cell = ivec2(floor(gl_FragCoord.xy / uDotPx)) & ${BAYER_SIZE - 1};
  float dots = step(BAYER[cell.y * ${BAYER_SIZE} + cell.x], coverage);
  dots *= 1.0 - step(${(RING_LIMIT * 1.6).toFixed(1)}, max(abs(vGround.x), abs(vGround.y)));

  // Ink over dots; alpha leaves the bare plate transparent so the page
  // shows through rather than being painted over.
  vec3 color = mix(uDot, uRing, ring);
  float alpha = max(ring, dots);
  if (alpha <= 0.0) discard;

  gl_FragColor = vec4(color, alpha);

  #include <colorspace_fragment>
}
`;

export interface Ground {
  mesh: THREE.Mesh;
  setPixelRatio: (pixelRatio: number) => void;
  setTime: (seconds: number) => void;
  setRegistration: (x: number, z: number) => void;
  dispose: () => void;
}

export function createGround(pixelRatio: number): Ground {
  const geometry = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE);
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    // The solid is opaque and drawn first, so it still occludes the
    // plate; writing depth from a transparent layer would not help and
    // would order badly against itself.
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uRing: { value: new THREE.Color(INK_MUTED) },
      uDot: { value: new THREE.Color(SURFACE_BORDER) },
      uDotPx: { value: Math.max(1, Math.round(DOT_CSS_PX * pixelRatio)) },
      uLinePx: { value: RING_LINE_CSS_PX * pixelRatio },
      uTime: { value: 0 },
      uRegistration: { value: new THREE.Vector2(0, 0) },
    },
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = GROUND_Y;
  // Drawn before the solid would be wasted fill; three sorts transparent
  // last anyway, and this keeps it behind any later transparent layer.
  mesh.renderOrder = -1;

  return {
    mesh,
    setPixelRatio(next) {
      material.uniforms.uDotPx.value = Math.max(1, Math.round(DOT_CSS_PX * next));
      material.uniforms.uLinePx.value = RING_LINE_CSS_PX * next;
    },
    setTime(seconds) {
      material.uniforms.uTime.value = seconds;
    },
    setRegistration(x, z) {
      material.uniforms.uRegistration.value.set(x, z);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

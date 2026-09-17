// The sculpture's surface: a two-ink screen print with a drawn cell grid.
//
// Everything happens in one material on one InstancedMesh, so the scene
// is still a single draw call and there is no post-processing pass.
//
//  - Tone. There is no lighting in this scene (by product rule), so the
//    six per-face constants are not brightness — they are INK COVERAGE.
//    An ordered Bayer threshold picks, per pixel, between the block's
//    palette token and the paper. Hard threshold, never a blend: every
//    pixel lands exactly on a palette token, and no in-between colour is
//    ever produced.
//  - Line. Each cell is outlined from its own face UVs, at a constant
//    screen width via fwidth(), and edges that run across a flat stretch
//    of surface are dropped using the neighbour mask.

import * as THREE from "three";
import { EDGE_BIT_TABLE } from "@/lib/neighbour-mask";
import { INK, YUZU_WHITE } from "@/lib/palette";

// BoxGeometry (default 1x1x1 segment) emits exactly 24 vertices, 4 per
// face, in the fixed order +x, -x, +y, -y, +z, -z — verified by reading
// the buildPlane() call sequence in three's BoxGeometry source
// (node_modules/three/src/geometries/BoxGeometry.js), which calls
// buildPlane for px, nx, py, ny, pz, nz in that order with no other faces
// or vertex reordering in between.
const FACE_COVERAGE = [0.86, 0.86, 1.0, 0.52, 0.7, 0.7]; // +x, -x, +y, -y, +z, -z
const VERTS_PER_FACE = 4;

/** Halftone cell size, in CSS pixels. Scaled by the device pixel ratio. */
export const DOT_CSS_PX = 1;

/**
 * Half the target weight of a drawn cell line, in CSS pixels. Each face
 * insets its own line, so an edge between two visible faces reads at
 * twice this and a silhouette edge, with only one face facing us, reads
 * at exactly this. The doubled interior line is the one being sized.
 */
export const LINE_CSS_PX = 0.35;

function glslIntArray(name: string, values: readonly number[]): string {
  return `const int ${name}[${values.length}] = int[${values.length}](${values.join(", ")});`;
}

/**
 * The classic recursive ordered-dither matrix:
 * M(2n) = [[4M, 4M+2], [4M+3, 4M+1]], starting from [[0]].
 */
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

// Thresholds centred in their step, so coverage 1 is fully inked and
// coverage 0 is bare paper.
const BAYER_SIZE = 4;
const BAYER_THRESHOLDS = bayerMatrix(BAYER_SIZE).map(
  (v) => (v + 0.5) / (BAYER_SIZE * BAYER_SIZE),
);

const VERTEX_SHADER = /* glsl */ `
attribute float aCoverage;
attribute float aFaceId;
attribute uint aMask;

varying vec2 vUv;
varying float vCoverage;
varying vec3 vInk;
varying vec4 vEdgeOn;

// Generated from EDGE_BIT_TABLE in lib/neighbour-mask.ts — the bit layout
// exists in exactly one place, so the tests cover the table the shader
// actually runs on.
${glslIntArray(
  "EDGE_AXIAL",
  EDGE_BIT_TABLE.map((e) => e.axial),
)}
${glslIntArray(
  "EDGE_DIAGONAL",
  EDGE_BIT_TABLE.map((e) => e.diagonal),
)}

// 1.0 draws this side of the face, 0.0 drops it. Dropped only where the
// surface continues flat across the line; a concave turn keeps it.
float edgeOn(int face, int side) {
  int i = face * 4 + side;
  // 'flat' is a reserved interpolation qualifier in GLSL ES 3.00.
  bool runsOn = (aMask & (1u << uint(EDGE_AXIAL[i]))) != 0u;
  bool turns = (aMask & (1u << uint(EDGE_DIAGONAL[i]))) != 0u;
  return (runsOn && !turns) ? 0.0 : 1.0;
}

void main() {
  vUv = uv;
  vCoverage = aCoverage;
  vInk = instanceColor;

  int face = int(aFaceId + 0.5);
  // Constant across the face's four vertices, so interpolation is exact.
  vEdgeOn = vec4(edgeOn(face, 0), edgeOn(face, 1), edgeOn(face, 2), edgeOn(face, 3));

  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uPaper;
uniform vec3 uOutline;
uniform float uDotPx;
uniform float uLinePx;

varying vec2 vUv;
varying float vCoverage;
varying vec3 vInk;
varying vec4 vEdgeOn;

const float BAYER[${BAYER_THRESHOLDS.length}] = float[${BAYER_THRESHOLDS.length}](
  ${BAYER_THRESHOLDS.map((v) => v.toFixed(6)).join(", ")}
);

void main() {
  // The screen is anchored to the viewport, the way a printed screen is
  // anchored to the page rather than to what is depicted. Coverage is
  // constant across each face, so a still frame has a still interior.
  ivec2 cell = ivec2(floor(gl_FragCoord.xy / uDotPx)) & ${BAYER_SIZE - 1};
  float threshold = BAYER[cell.y * ${BAYER_SIZE} + cell.x];
  vec3 color = threshold < vCoverage ? vInk : uPaper;

  // Cell lines, inset from each face's own edges at a constant width in
  // pixels regardless of how far away or how foreshortened the face is.
  vec2 w = max(fwidth(vUv) * uLinePx, vec2(1e-6));
  vec4 d = vec4(vUv.x, 1.0 - vUv.x, vUv.y, 1.0 - vUv.y);
  vec4 s = vec4(1.0) - smoothstep(vec4(0.0), w.xxyy, d);
  float line = max(
    max(s.x * vEdgeOn.x, s.y * vEdgeOn.y),
    max(s.z * vEdgeOn.z, s.w * vEdgeOn.w)
  );

  // Paper is drawn, never discarded: the canvas is transparent, so a
  // discard would show the page grid straight through the solid.
  gl_FragColor = vec4(mix(color, uOutline, line), 1.0);

  #include <colorspace_fragment>
}
`;

/**
 * A block geometry carrying the per-face ink coverage and face index, plus
 * the per-instance neighbour mask. No `color` attribute: the token colour
 * arrives as `instanceColor`, which three declares for any material on an
 * InstancedMesh whose instance colours have been set before the first
 * render (WebGLPrograms keys `instancingColor` off the object, not the
 * material) — so `InstancedMesh.setColorAt` must run during scene build.
 */
export function createPrintGeometry(blockScale: number, masks: Uint32Array): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(blockScale, blockScale, blockScale);

  const coverage = new Float32Array(FACE_COVERAGE.length * VERTS_PER_FACE);
  const faceIds = new Float32Array(FACE_COVERAGE.length * VERTS_PER_FACE);
  for (let face = 0; face < FACE_COVERAGE.length; face++) {
    for (let v = 0; v < VERTS_PER_FACE; v++) {
      const vertexIndex = face * VERTS_PER_FACE + v;
      coverage[vertexIndex] = FACE_COVERAGE[face];
      faceIds[vertexIndex] = face;
    }
  }

  geometry.setAttribute("aCoverage", new THREE.Float32BufferAttribute(coverage, 1));
  geometry.setAttribute("aFaceId", new THREE.Float32BufferAttribute(faceIds, 1));

  const maskAttribute = new THREE.InstancedBufferAttribute(masks, 1);
  maskAttribute.gpuType = THREE.IntType;
  geometry.setAttribute("aMask", maskAttribute);

  return geometry;
}

export function createPrintMaterial(pixelRatio: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    side: THREE.FrontSide,
    uniforms: {
      uPaper: { value: new THREE.Color(YUZU_WHITE) },
      uOutline: { value: new THREE.Color(INK) },
      uDotPx: { value: dotSizeFor(pixelRatio) },
      uLinePx: { value: LINE_CSS_PX * pixelRatio },
    },
  });
}

/** Whole device pixels, so every halftone cell is the same size. */
export function dotSizeFor(pixelRatio: number): number {
  return Math.max(1, Math.round(DOT_CSS_PX * pixelRatio));
}

export function updatePrintMaterialScale(
  material: THREE.ShaderMaterial,
  pixelRatio: number,
): void {
  material.uniforms.uDotPx.value = dotSizeFor(pixelRatio);
  material.uniforms.uLinePx.value = LINE_CSS_PX * pixelRatio;
}

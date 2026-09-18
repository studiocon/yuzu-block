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
import { YUZU_WHITE } from "@/lib/palette";

// BoxGeometry (default 1x1x1 segment) emits exactly 24 vertices, 4 per
// face, in the fixed order +x, -x, +y, -y, +z, -z — verified by reading
// the buildPlane() call sequence in three's BoxGeometry source
// (node_modules/three/src/geometries/BoxGeometry.js), which calls
// buildPlane for px, nx, py, ny, pz, nz in that order with no other faces
// or vertex reordering in between.
// Ink coverage per face — not brightness; there is no light in this
// scene. Tried snapping these to the screen's sixteenths so the surviving
// dots fall in a regular pattern: it made the faces lighter, turned them
// into a hard cross-hatch, and measured worse for flicker (3.6% of pixels
// changing per frame against 2.4%). Denser and slightly irregular is the
// calmer read.
const FACE_COVERAGE = [0.86, 0.86, 1.0, 0.52, 0.7, 0.7]; // +x, -x, +y, -y, +z, -z
const VERTS_PER_FACE = 4;

/**
 * Halftone cells per world unit, i.e. per block edge. Deliberately not a
 * whole number: at a whole number the screen would land identically on
 * every cube and read as a decal rather than as one continuous screen
 * over the solid.
 */
const SCREEN_CELLS_PER_UNIT = 3.0;

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

varying float vCoverage;
varying float vFaceId;
varying vec3 vInk;
varying vec3 vSolid;

void main() {
  vCoverage = aCoverage;
  vFaceId = aFaceId;
  vInk = instanceColor;

  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vSolid = world.xyz;

  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uPaper;

varying float vCoverage;
varying float vFaceId;
varying vec3 vInk;
varying vec3 vSolid;

const float BAYER[${BAYER_THRESHOLDS.length}] = float[${BAYER_THRESHOLDS.length}](
  ${BAYER_THRESHOLDS.map((v) => v.toFixed(6)).join(", ")}
);

void main() {
  // The screen is anchored to the SOLID, not to the viewport. Anchored
  // to the viewport it is truer to how ink meets paper, but the solid
  // turns continuously under it, so every face slides across a fixed
  // grid of dots and the whole surface scintillates. Locked to the
  // solid, the dots sit still on the faces as they turn.
  //
  // The two axes are the face's own plane, so the screen runs unbroken
  // across neighbouring cells instead of stamping each cube alike.
  int face = int(vFaceId + 0.5);
  vec2 onFace =
      face < 2 ? vSolid.zy
    : face < 4 ? vSolid.xz
    :            vSolid.xy;

  // Deliberately not a whole number of cells per block: at one tile per
  // block face every cube would carry the same stamp again.
  ivec2 cell = ivec2(floor(onFace * ${SCREEN_CELLS_PER_UNIT.toFixed(1)})) & ${BAYER_SIZE - 1};
  cell = (cell + ${BAYER_SIZE}) & ${BAYER_SIZE - 1};
  float threshold = BAYER[cell.y * ${BAYER_SIZE} + cell.x];

  // Hard threshold, never a blend: every pixel lands on a palette token
  // and no in-between colour is ever produced.
  vec3 color = threshold < vCoverage ? vInk : uPaper;

  // Paper is drawn, never discarded: the canvas is transparent, so a
  // discard would show the page grid straight through the solid.
  gl_FragColor = vec4(color, 1.0);

  #include <colorspace_fragment>
}
`;

/**
 * A block geometry carrying the per-face ink coverage and face index. No
 * `color` attribute: the token colour arrives as `instanceColor`, which
 * three declares for any material on an InstancedMesh whose instance
 * colours have been set before the first render (WebGLPrograms keys
 * `instancingColor` off the object, not the material) — so
 * `InstancedMesh.setColorAt` must run during scene build.
 */
export function createPrintGeometry(blockScale: number): THREE.BoxGeometry {
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

  return geometry;
}

export function createPrintMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    side: THREE.FrontSide,
    uniforms: {
      uPaper: { value: new THREE.Color(YUZU_WHITE) },
    },
  });
}

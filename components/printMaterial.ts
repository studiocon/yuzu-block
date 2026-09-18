// The sculpture's surface: an eight-ink screen print.
//
// Everything happens in one material on one InstancedMesh, so the scene
// is still a single draw call and there is no post-processing pass.
// Two independent reads of the same ordered screen decide each pixel,
// and both are hard thresholds — never a blend, so every pixel lands
// exactly on a palette token and no in-between colour is produced.
//
//  - How much ink. There is no lighting in this scene (by product
//    rule), so the six per-face constants are not brightness, they are
//    INK COVERAGE. The first read picks ink or the stock beneath it.
//  - Which ink. A block's tone is a position on the ramp in
//    lib/palette.ts; the second read picks between the two stops it
//    falls between, so the ramp passes through continuously.
//
// Cells were once outlined here too. At the framing the page uses a
// cell is four or five pixels, so a one-pixel line around one sat on
// the resolution limit and re-aliased every frame of the turn — see
// .claude/lessons/rendering.md.

import * as THREE from "three";
import { INK_RAMP, SURFACE_BORDER } from "@/lib/palette";
import { RAMP_POSITIONS, RAMP_STOPS } from "@/lib/tone";

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
const FACE_COVERAGE = [0.9, 0.9, 1.0, 0.62, 0.8, 0.8]; // +x, -x, +y, -y, +z, -z
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
attribute float aTone;

varying float vCoverage;
varying float vFaceId;
varying float vTone;
varying vec3 vSolid;

void main() {
  vCoverage = aCoverage;
  vFaceId = aFaceId;
  vTone = aTone;

  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vSolid = world.xyz;

  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uUnder;
uniform vec3 uStops[${RAMP_STOPS}];
const float STOP_AT[${RAMP_STOPS}] = float[${RAMP_STOPS}](${RAMP_POSITIONS.map((v) => v.toFixed(4)).join(", ")});

varying float vCoverage;
varying float vFaceId;
varying float vTone;
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

  // A second, decorrelated read of the same screen decides WHICH ink.
  // Offsetting the cell keeps the two decisions from agreeing, which
  // would make the ramp step rather than pass through.
  ivec2 mixCell = (cell + ivec2(${BAYER_SIZE / 2}, 1)) & ${BAYER_SIZE - 1};
  float mixThreshold = BAYER[mixCell.y * ${BAYER_SIZE} + mixCell.x];

  // Eight stops, two inks live at a time. Between them the screen is
  // what makes the transition: neighbouring dots take different stops,
  // and at any distance the eye reads the ratio as one colour. Still no
  // blending — every dot is exactly one palette token.
  float t = clamp(vTone, 0.0, 1.0);
  int i = 0;
  for (int k = 0; k < ${RAMP_STOPS - 1}; k++) {
    if (t >= STOP_AT[k + 1]) i = k + 1;
  }
  i = min(i, ${RAMP_STOPS - 2});
  int j = i + 1;
  float along = (t - STOP_AT[i]) / max(STOP_AT[j] - STOP_AT[i], 1e-5);
  vec3 vInk = mixThreshold < along ? uStops[j] : uStops[i];

  // Hard threshold, never a blend: every pixel lands on a palette token
  // and no in-between colour is ever produced.
  //
  // What shows between the dots is the stock the ink sits on, NOT the
  // page. Using the page's own white here made every gap in the screen
  // read as a hole punched through the solid, because it was the exact
  // colour showing through the real voids beside it. A warmer stock
  // keeps the screen as surface, and leaves the actual voids — cells
  // with no block, which are silent days — the only true white.
  vec3 color = threshold < vCoverage ? vInk : uUnder;

  // The stock is drawn, never discarded: the canvas is transparent, so
  // a discard would show the page grid straight through the solid.
  gl_FragColor = vec4(color, 1.0);

  #include <colorspace_fragment>
}
`;

/**
 * A block geometry carrying the per-face ink coverage and face index,
 * plus the per-instance ramp position. `instanceColor` is not used: a
 * column's colour is a scalar the shader resolves against the ramp, not
 * a fixed token, so one float per instance replaces three.
 */
export function createPrintGeometry(
  blockScale: number,
  tones: Float32Array,
): THREE.BoxGeometry {
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
  geometry.setAttribute("aTone", new THREE.InstancedBufferAttribute(tones, 1));

  return geometry;
}

/**
 * The ramp flattened for a `vec3[]` uniform. THREE.Color converts the
 * sRGB hex to linear on construction, which is the space the shader
 * works in before `colorspace_fragment` converts back.
 */
function rampUniform(): Float32Array {
  const flat = new Float32Array(RAMP_STOPS * 3);
  INK_RAMP.forEach((hex, i) => {
    const color = new THREE.Color(hex);
    flat[i * 3] = color.r;
    flat[i * 3 + 1] = color.g;
    flat[i * 3 + 2] = color.b;
  });
  return flat;
}

export function createPrintMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    side: THREE.FrontSide,
    uniforms: {
      uUnder: { value: new THREE.Color(SURFACE_BORDER) },
      uStops: { value: rampUniform() },
    },
  });
}

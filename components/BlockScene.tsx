"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { YUZU_YELLOW, YUZU_ZEST } from "@/lib/palette";
import { hashString, mulberry32 } from "@/lib/seed";
import {
  groupColumns,
  nextColorDriftDelay,
  nextRevealDelay,
  pickColorFlip,
  selectInitiallyHidden,
} from "@/lib/carve-schedule";
import type { Block, BlockColor, SceneSpec } from "@/lib/types";

const BLOCK_SCALE = 0.96;

const COLOR_HEX: Record<BlockColor, string> = {
  yellow: YUZU_YELLOW,
  zest: YUZU_ZEST,
};

// Safe-area insets (px) reserved for page chrome: the header sits above
// TOP_INSET, and the lead+footer sit below (viewport height - BOTTOM_INSET).
// The sculpture is fit and framed to stay clear of both bands.
const TOP_INSET = 96;
const BOTTOM_INSET_DESKTOP = 208;
const BOTTOM_INSET_MOBILE = 232;
const MOBILE_BREAKPOINT = 768;

// Safety margin over the exact bounding-sphere fit to the safe area, so
// the sculpture sits comfortably inside it rather than exactly touching
// the boundary (verified numerically across several viewport sizes).
const FIT_MARGIN = 1.05;

function bottomInsetFor(width: number): number {
  return width < MOBILE_BREAKPOINT ? BOTTOM_INSET_MOBILE : BOTTOM_INSET_DESKTOP;
}

function blockListSeed(blocks: Block[]): string {
  return blocks.map((b) => `${b.x}.${b.y}.${b.z}.${b.color}`).join("|");
}

export interface BlockSceneProps {
  scene: SceneSpec;
}

export default function BlockScene({ scene }: BlockSceneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    container.appendChild(canvas);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      return () => {
        container.removeChild(canvas);
      };
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Transparent clear so the page's CSS grid background shows through.
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.NoToneMapping;

    const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const prefersReducedMotion = reduceMotionQuery.matches;

    const three = buildScene(scene, prefersReducedMotion);
    const { threeScene, camera, updateCameraForViewport } = three;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.autoRotate = !prefersReducedMotion;
    controls.autoRotateSpeed = 0.4;
    controls.minPolarAngle = Math.PI * 0.15;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.target.set(0, three.lookAtHeight, 0);
    controls.update();

    function resize() {
      const width = container!.clientWidth;
      const height = container!.clientHeight;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      updateCameraForViewport(width, height);

      // Shift the rendered frame so its vertical center lands on the safe
      // area's center rather than the full viewport's center. A positive
      // offsetY moves the rendered content up the screen (verified against
      // three's PerspectiveCamera.updateProjectionMatrix, which subtracts
      // offsetY from the frustum's near-plane top — increasing offsetY
      // pushes objects toward NDC +1, i.e. the top of the viewport).
      const bottomInset = bottomInsetFor(width);
      const offsetY = (bottomInset - TOP_INSET) / 2;
      camera.setViewOffset(width, height, 0, offsetY, width, height);
      camera.updateProjectionMatrix();
    }

    resize();
    window.addEventListener("resize", resize);

    let rafId = 0;
    function animate() {
      controls.update();
      renderer.render(threeScene, camera);
      rafId = requestAnimationFrame(animate);
    }
    rafId = requestAnimationFrame(animate);

    // Bounded carving animation: reveals converge to the server snapshot
    // and never exceed it. Both loops are independent, self-rescheduling
    // timers (not tied to the render loop) and are skipped entirely under
    // prefers-reduced-motion, where the full snapshot renders immediately.
    let revealTimer: ReturnType<typeof setTimeout> | undefined;
    let driftTimer: ReturnType<typeof setTimeout> | undefined;

    if (!prefersReducedMotion) {
      const scheduleReveal = () => {
        revealTimer = setTimeout(() => {
          three.revealOne();
          if (three.hasHidden()) scheduleReveal();
        }, nextRevealDelay(three.revealRng));
      };
      if (three.hasHidden()) scheduleReveal();

      const scheduleDrift = () => {
        driftTimer = setTimeout(() => {
          three.driftColor();
          scheduleDrift();
        }, nextColorDriftDelay(three.driftRng));
      };
      scheduleDrift();
    }

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      if (revealTimer !== undefined) clearTimeout(revealTimer);
      if (driftTimer !== undefined) clearTimeout(driftTimer);
      controls.dispose();
      three.dispose();
      renderer.dispose();
      container.removeChild(canvas);
    };
    // Scene is generated server-side per request and never changes on the
    // client: build once on mount, intentionally ignoring `scene` deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} style={{ position: "fixed", inset: 0 }} />;
}

interface BuiltScene {
  threeScene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  lookAtHeight: number;
  updateCameraForViewport: (width: number, height: number) => void;
  dispose: () => void;
  hasHidden: () => boolean;
  revealOne: () => void;
  driftColor: () => void;
  revealRng: () => number;
  driftRng: () => number;
}

function buildScene(scene: SceneSpec, prefersReducedMotion: boolean): BuiltScene {
  const threeScene = new THREE.Scene();
  const blocks = scene.blocks;

  const geometry = shadeOnlyBoxGeometry();
  const material = new THREE.MeshBasicMaterial({ vertexColors: true });
  const mesh = blocks.length > 0 ? new THREE.InstancedMesh(geometry, material, blocks.length) : null;

  const seed = blockListSeed(blocks);
  const hiddenIndices = prefersReducedMotion ? new Set<number>() : selectInitiallyHidden(blocks, seed);

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const visibleScale = new THREE.Vector3(1, 1, 1);
  const hiddenScale = new THREE.Vector3(0, 0, 0);
  const tmpColor = new THREE.Color();

  if (mesh) {
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      position.set(b.x, b.y + 0.5, b.z);
      matrix.compose(position, quaternion, hiddenIndices.has(i) ? hiddenScale : visibleScale);
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, tmpColor.set(COLOR_HEX[b.color]));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    threeScene.add(mesh);
  }

  const lookAtHeight = scene.maxHeight / 2;

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);
  const elevation = THREE.MathUtils.degToRad(42);
  const halfWidth = Math.max(1, scene.extent);

  // Bounding-sphere radius around the sculpture footprint (diagonal, safe
  // for any auto-rotation angle) and its full height.
  const footprintRadius = halfWidth * Math.SQRT2;
  const radius = Math.sqrt(footprintRadius ** 2 + (scene.maxHeight / 2) ** 2);

  const vFovRad = THREE.MathUtils.degToRad(camera.fov);
  const tanVHalf = Math.tan(vFovRad / 2);

  function updateCameraForViewport(width: number, height: number) {
    const aspect = width / height;
    const bandHeight = Math.max(200, height - TOP_INSET - bottomInsetFor(width));

    // Two independent pixel-space constraints on the sphere's apparent
    // half-extent: the full width (nothing eats into it), and the safe
    // vertical band between header and lead/footer (bandHeight, not the
    // full viewport height). Each is expressed as a tangent of a half-angle
    // through the camera's fixed vertical FOV — since the physical FOV
    // always maps across the *full* render height, a smaller pixel budget
    // (bandHeight) corresponds to a proportionally smaller tangent budget,
    // not a proportionally smaller angle (tan, not the angle itself, is
    // what's linear in near-plane/screen position).
    const tanHHalf = tanVHalf * aspect;
    const tanVBandHalf = tanVHalf * (bandHeight / height);
    const thetaAllowed = Math.atan(Math.min(tanHHalf, tanVBandHalf));

    const distance = (radius / Math.sin(thetaAllowed)) * FIT_MARGIN;

    const horizontalDistance = distance * Math.cos(elevation);
    const verticalDistance = distance * Math.sin(elevation);

    camera.position.set(0, lookAtHeight + verticalDistance, horizontalDistance);
    camera.lookAt(0, lookAtHeight, 0);
  }

  // --- Carving animation state -------------------------------------------
  // Reveal: a shrinking pool of hidden block indices, drained one at a time.
  // Color drift: an independent, indefinite re-coloring of whole columns
  // that holds the overall zest proportion close to the snapshot's.
  const hiddenPool = [...hiddenIndices];
  const revealRng = mulberry32(hashString(`${seed}:reveal`));
  const driftRng = mulberry32(hashString(`${seed}:drift`));

  const currentColors: BlockColor[] = blocks.map((b) => b.color);
  const columns = groupColumns(blocks);
  const zestCount = currentColors.reduce((n, c) => (c === "zest" ? n + 1 : n), 0);
  const targetZestRatio = blocks.length > 0 ? zestCount / blocks.length : 0;

  function hasHidden(): boolean {
    return hiddenPool.length > 0;
  }

  function revealOne(): void {
    if (!mesh || hiddenPool.length === 0) return;
    const pick = Math.floor(revealRng() * hiddenPool.length);
    const index = hiddenPool.splice(pick, 1)[0];
    const b = blocks[index];
    position.set(b.x, b.y + 0.5, b.z);
    matrix.compose(position, quaternion, visibleScale);
    mesh.setMatrixAt(index, matrix);
    mesh.instanceMatrix.needsUpdate = true;
  }

  function driftColor(): void {
    if (!mesh) return;
    const flip = pickColorFlip(columns, currentColors, targetZestRatio, driftRng);
    if (!flip) return;
    for (const index of flip.indices) {
      currentColors[index] = flip.toColor;
      mesh.setColorAt(index, tmpColor.set(COLOR_HEX[flip.toColor]));
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  function dispose() {
    geometry.dispose();
    material.dispose();
  }

  return {
    threeScene,
    camera,
    lookAtHeight,
    updateCameraForViewport,
    dispose,
    hasHidden,
    revealOne,
    driftColor,
    revealRng,
    driftRng,
  };
}

// BoxGeometry (default 1x1x1 segment) emits exactly 24 vertices, 4 per
// face, in the fixed order +x, -x, +y, -y, +z, -z — verified by reading
// the buildPlane() call sequence in three's BoxGeometry source
// (node_modules/three/src/geometries/BoxGeometry.js), which calls
// buildPlane for px, nx, py, ny, pz, nz in that order with no other faces
// or vertex reordering in between.
const FACE_SHADE = [0.86, 0.86, 1.0, 0.6, 0.74, 0.74]; // +x, -x, +y, -y, +z, -z
const VERTS_PER_FACE = 4;

/**
 * A block geometry carrying only the per-face SHADE FACTORS as grayscale
 * vertex colors (no block-color baked in). Combined with a per-instance
 * color (`InstancedMesh.setColorAt`) on a `vertexColors: true` material,
 * three multiplies vertex color × instance color in the shader
 * (see ShaderChunk/color_vertex.glsl.js: `vColor.rgb *= instanceColor.rgb`),
 * so the top face (shade 1.0) still renders as exactly the instance's
 * token color, and side/bottom faces are proportionally darker — this
 * lets a single mesh serve both block colors instead of one mesh each.
 */
function shadeOnlyBoxGeometry(): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(BLOCK_SCALE, BLOCK_SCALE, BLOCK_SCALE);
  const vertexCount = geometry.attributes.position.count;
  const colors = new Float32Array(vertexCount * 3);

  for (let face = 0; face < FACE_SHADE.length; face++) {
    const shade = FACE_SHADE[face];
    for (let v = 0; v < VERTS_PER_FACE; v++) {
      const vertexIndex = face * VERTS_PER_FACE + v;
      colors[vertexIndex * 3] = shade;
      colors[vertexIndex * 3 + 1] = shade;
      colors[vertexIndex * 3 + 2] = shade;
    }
  }

  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

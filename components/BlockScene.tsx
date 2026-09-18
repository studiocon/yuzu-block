"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { YUZU_YELLOW, YUZU_ZEST } from "@/lib/palette";
import { hashString, mulberry32 } from "@/lib/seed";
import {
  groupColumns,
  nextColorDriftDelay,
  nextRegistrationDelay,
  nextRegistrationOffset,
  nextRevealDelay,
  pickColorFlip,
  registrationHoldMs,
  selectInitiallyHidden,
} from "@/lib/carve-schedule";
import { buildNeighbourMasks } from "@/lib/neighbour-mask";
import {
  columnsOf,
  coverFrustum,
  dampedExtents,
  extentsAtOrientation,
  projectedExtents,
  tiltElevation,
} from "@/lib/ortho-fit";
import type { Block, BlockColor, SceneSpec } from "@/lib/types";
import { createGround } from "./groundMaterial";
import {
  createPrintGeometry,
  createPrintMaterial,
  updatePrintMaterialScale,
} from "./printMaterial";

// Cells are unit cubes, so adjacent blocks meet exactly and the solid
// reads as one mass. The per-cell articulation is carried by the shader's
// outlines instead of by air gaps between the boxes.
const BLOCK_SCALE = 1;

// Elements per instance in InstancedMesh's backing buffers.
const MATRIX_STRIDE = 16;
const COLOR_STRIDE = 3;

const COLOR_HEX: Record<BlockColor, string> = {
  yellow: YUZU_YELLOW,
  zest: YUZU_ZEST,
};

// The sculpture is framed to COVER the viewport: it runs off every edge
// and under the page chrome. The lead copy sitting on top of it is the
// intended read, so no safe area is reserved and the earlier chrome
// measurement is gone with it.
//
// Overscan is how far past a bare cover fit the solid is pushed — 1.0
// would have it touch two edges exactly, and above that it bleeds off
// all four.
const OVERSCAN = 1.08;

// How far the live framing is pulled toward the widest yaw. 0 follows the
// silhouette exactly and swings the frame by sqrt(2) per revolution,
// which crops past the point where the solid reads as a solid; 1 is a
// fixed frame. See dampedExtents in lib/ortho-fit.ts.
const FRAME_DAMPING = 0.65;

// Orbit range, as elevation above the horizon. The orthographic fit is
// tight rather than bounding-sphere loose, so it has to be computed over
// every angle the visitor can reach; a near-ground read was only ever
// survivable because the old fit was loose, and it is a poor axonometric
// besides. Elevation and OrbitControls' polar angle are complements.
const MIN_ELEVATION = Math.PI / 6; // 30 degrees
const MAX_ELEVATION = Math.PI / 3; // 60 degrees
const DEFAULT_ELEVATION = THREE.MathUtils.degToRad(42);

const MIN_POLAR_ANGLE = Math.PI / 2 - MAX_ELEVATION;
const MAX_POLAR_ANGLE = Math.PI / 2 - MIN_ELEVATION;

// Yaw steps sampled over a full revolution, and elevation steps across
// the orbit range, when measuring the worst-case projected silhouette.
const YAW_SAMPLES = 72;
const ELEVATION_SAMPLES = 5;

// The camera also drifts up and down, not just around. Centred on the
// resting elevation so the drift starts from it without a jump, and kept
// inside the orbit clamps so it never fights them. One pass takes just
// over a minute, slower than nothing and slower than the turn.
const TILT_SWING = THREE.MathUtils.degToRad(11);
const TILT_PERIOD_SECONDS = 64;

// Blocks are boxes of BLOCK_SCALE centred on their cell, so the solid
// reaches half a block past the outermost cell centre.
const BLOCK_OVERHANG = BLOCK_SCALE / 2;

const tiltOffset = new THREE.Vector3();
const tiltSpherical = new THREE.Spherical();

/** Rotates the camera about its target by an elevation delta. */
function nudgeElevation(
  camera: THREE.Camera,
  target: THREE.Vector3,
  deltaElevation: number,
): void {
  if (deltaElevation === 0) return;
  tiltOffset.copy(camera.position).sub(target);
  tiltSpherical.setFromVector3(tiltOffset);
  // Polar angle is measured from +y, so it moves against elevation.
  tiltSpherical.phi -= deltaElevation;
  tiltOffset.setFromSpherical(tiltSpherical);
  camera.position.copy(target).add(tiltOffset);
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

    const pixelRatio = () => Math.min(window.devicePixelRatio, 2);
    renderer.setPixelRatio(pixelRatio());
    // Transparent clear so the page's CSS grid background shows through.
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.NoToneMapping;

    const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const prefersReducedMotion = reduceMotionQuery.matches;

    const three = buildScene(scene, prefersReducedMotion, renderer.getPixelRatio());
    const { threeScene, camera, updateFrustum } = three;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableZoom = false;
    controls.enablePan = false;
    // Damping needs a per-frame update, which only the animation loop
    // provides — under reduced motion the scene renders on demand instead.
    controls.enableDamping = !prefersReducedMotion;
    controls.autoRotate = !prefersReducedMotion;
    controls.autoRotateSpeed = 0.4;
    controls.minPolarAngle = MIN_POLAR_ANGLE;
    controls.maxPolarAngle = MAX_POLAR_ANGLE;
    controls.target.set(0, three.lookAtHeight, 0);
    controls.update();

    // The frustum is re-fitted to the live orbit angles, so the viewport
    // size is held here rather than passed down from each call site.
    // autoRotate pauses itself while the visitor drags; the tilt drift
    // matches that so a deliberate vertical drag is not pulled against.
    let dragging = false;
    controls.addEventListener("start", () => {
      dragging = true;
    });
    controls.addEventListener("end", () => {
      dragging = false;
    });

    let viewWidth = 1;
    let viewHeight = 1;
    function refitFrustum() {
      updateFrustum(
        viewWidth,
        viewHeight,
        controls.getAzimuthalAngle(),
        Math.PI / 2 - controls.getPolarAngle(),
      );
    }

    function resize() {
      const width = container!.clientWidth;
      const height = container!.clientHeight;
      // The ratio changes when the window moves between displays, and
      // the halftone cell is defined in whole device pixels.
      renderer.setPixelRatio(pixelRatio());
      renderer.setSize(width, height);
      three.setPixelRatio(renderer.getPixelRatio());

      viewWidth = width;
      viewHeight = height;
      refitFrustum();

      if (prefersReducedMotion) renderer.render(threeScene, camera);
    }

    resize();
    window.addEventListener("resize", resize);

    // The lead's height moves when the webfont swaps in, and the chrome is
    // measured, so the first reading can be stale. Re-measure once fonts
    // settle; the flag keeps a late resolution from touching a torn-down
    // renderer.
    let mounted = true;
    document.fonts?.ready.then(() => {
      if (mounted) resize();
    });

    // With motion, every frame differs (orbit, reveals, color drift), so a
    // continuous loop is what the scene needs. Without it nothing changes
    // unless the visitor drags, so the loop would burn a frame's worth of
    // work forever on an identical image — render on demand instead.
    let rafId = 0;
    function renderOnDemand() {
      refitFrustum();
      renderer.render(threeScene, camera);
    }

    if (prefersReducedMotion) {
      controls.addEventListener("change", renderOnDemand);
      renderer.render(threeScene, camera);
    } else {
      const startedAt = performance.now();
      let lastTilt = DEFAULT_ELEVATION;
      const animate = () => {
        const elapsed = (performance.now() - startedAt) / 1000;
        const tilt = tiltElevation(elapsed, DEFAULT_ELEVATION, TILT_SWING, TILT_PERIOD_SECONDS);
        // Applied as a delta to wherever the camera currently is, so a
        // visitor's own dragging is added to rather than overwritten.
        // OrbitControls re-derives its spherical from the camera position
        // on every update and clamps phi, so this is picked up and
        // bounded without reaching into its internals.
        if (!dragging) nudgeElevation(camera, controls.target, tilt - lastTilt);
        lastTilt = tilt;

        controls.update();
        refitFrustum();
        three.setGroundTime((performance.now() - startedAt) / 1000);
        renderer.render(threeScene, camera);
        rafId = requestAnimationFrame(animate);
      };
      rafId = requestAnimationFrame(animate);
    }

    // Bounded carving animation: reveals converge to the server snapshot
    // and never exceed it. Both loops are independent, self-rescheduling
    // timers (not tied to the render loop) and are skipped entirely under
    // prefers-reduced-motion, where the full snapshot renders immediately.
    let revealTimer: ReturnType<typeof setTimeout> | undefined;
    let driftTimer: ReturnType<typeof setTimeout> | undefined;
    let registrationTimer: ReturnType<typeof setTimeout> | undefined;
    let registrationHold: ReturnType<typeof setTimeout> | undefined;

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

      const scheduleRegistration = () => {
        registrationTimer = setTimeout(() => {
          const { x, z } = nextRegistrationOffset(three.driftRng);
          three.setRegistration(x, z);
          registrationHold = setTimeout(() => three.setRegistration(0, 0), registrationHoldMs);
          scheduleRegistration();
        }, nextRegistrationDelay(three.driftRng));
      };
      scheduleRegistration();
    }

    return () => {
      mounted = false;
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      controls.removeEventListener("change", renderOnDemand);
      if (revealTimer !== undefined) clearTimeout(revealTimer);
      if (driftTimer !== undefined) clearTimeout(driftTimer);
      if (registrationTimer !== undefined) clearTimeout(registrationTimer);
      if (registrationHold !== undefined) clearTimeout(registrationHold);
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
  camera: THREE.OrthographicCamera;
  lookAtHeight: number;
  updateFrustum: (width: number, height: number, yaw: number, elevation: number) => void;
  dispose: () => void;
  setPixelRatio: (pixelRatio: number) => void;
  setGroundTime: (seconds: number) => void;
  setRegistration: (x: number, z: number) => void;
  hasHidden: () => boolean;
  revealOne: () => void;
  driftColor: () => void;
  revealRng: () => number;
  driftRng: () => number;
}

function buildScene(
  scene: SceneSpec,
  prefersReducedMotion: boolean,
  pixelRatio: number,
): BuiltScene {
  const threeScene = new THREE.Scene();
  const blocks = scene.blocks;

  const geometry = createPrintGeometry(BLOCK_SCALE, buildNeighbourMasks(blocks));
  const material = createPrintMaterial(pixelRatio);

  // The plate the sculpture sits on: nominal ring grid, paper screen and
  // the off-register slip. Added first so it is behind everything.
  const ground = createGround(pixelRatio);
  threeScene.add(ground.mesh);
  const mesh = blocks.length > 0 ? new THREE.InstancedMesh(geometry, material, blocks.length) : null;

  const seed = blockListSeed(blocks);
  const hiddenIndices = prefersReducedMotion ? new Set<number>() : selectInitiallyHidden(blocks, seed);

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const visibleScale = new THREE.Vector3(1, 1, 1);
  const hiddenScale = new THREE.Vector3(0, 0, 0);
  const tmpColor = new THREE.Color();

  // setColorAt has to run here, before the first render: three decides
  // whether to declare `instanceColor` in the shader at program-compile
  // time, from whether the mesh has instance colours at all.
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

  // Worst-case projected silhouette of the solid, not of the nominal ring
  // grid. Weeks below the anonymity threshold and weeks still in the
  // future emit no blocks, so for most of the year the grid is mostly
  // empty air — framing that instead of the blocks is what used to leave
  // the sculpture small.
  const fitColumns = columnsOf(blocks);
  const extents = projectedExtents(fitColumns, BLOCK_OVERHANG, {
    yawSamples: YAW_SAMPLES,
    elevationRange: [MIN_ELEVATION, MAX_ELEVATION],
    elevationSamples: ELEVATION_SAMPLES,
    defaultElevation: DEFAULT_ELEVATION,
  });
  const lookAtHeight = extents.targetHeight;

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);

  // Orthographic depth is linear and independent of distance, so the
  // camera only has to stand far enough back that the whole solid sits
  // between the near and far planes. OrbitControls holds this radius
  // (zoom is disabled), so it is set once and never touched again — only
  // the frustum moves after this.
  const worstSpan = Math.hypot(extents.halfWidth, extents.halfHeight);
  const distance = Math.max(10, 4 * worstSpan);
  camera.near = 0.1;
  camera.far = 2 * distance + 4 * worstSpan;
  camera.position.set(
    0,
    lookAtHeight + distance * Math.sin(DEFAULT_ELEVATION),
    distance * Math.cos(DEFAULT_ELEVATION),
  );
  camera.lookAt(0, lookAtHeight, 0);

  /**
   * Re-sizes the frustum to the silhouette AT THE CURRENT ORIENTATION,
   * every frame. A square footprint's apparent width swings by sqrt(2)
   * as it turns; sizing for the worst yaw is what kept the sculpture
   * small at every other one. Because the fit covers rather than
   * contains, the swing now reads as the frame breathing against a
   * silhouette that is always cropped.
   */
  function updateFrustum(width: number, height: number, yaw: number, elevation: number) {
    const live = extentsAtOrientation(fitColumns, BLOCK_OVERHANG, yaw, elevation, lookAtHeight);
    const framed = dampedExtents(live, extents, FRAME_DAMPING);
    const { halfW, halfH } = coverFrustum(framed, width, height, OVERSCAN);

    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.updateProjectionMatrix();
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

  // Both carving loops touch a handful of instances out of tens of
  // thousands, so they flag just the elements they wrote. Without a range
  // three re-uploads the whole buffer — for the reveal loop that is the
  // entire instance matrix (16 floats per block) on every single block.
  function revealOne(): void {
    if (!mesh || hiddenPool.length === 0) return;
    const pick = Math.floor(revealRng() * hiddenPool.length);
    const index = hiddenPool.splice(pick, 1)[0];
    const b = blocks[index];
    position.set(b.x, b.y + 0.5, b.z);
    matrix.compose(position, quaternion, visibleScale);
    mesh.setMatrixAt(index, matrix);
    mesh.instanceMatrix.addUpdateRange(index * MATRIX_STRIDE, MATRIX_STRIDE);
    mesh.instanceMatrix.needsUpdate = true;
  }

  function driftColor(): void {
    if (!mesh) return;
    const flip = pickColorFlip(columns, currentColors, targetZestRatio, driftRng);
    if (!flip) return;

    let min = Infinity;
    let max = -Infinity;
    for (const index of flip.indices) {
      currentColors[index] = flip.toColor;
      mesh.setColorAt(index, tmpColor.set(COLOR_HEX[flip.toColor]));
      if (index < min) min = index;
      if (index > max) max = index;
    }

    if (mesh.instanceColor) {
      // A column's blocks are emitted consecutively, so one span covers
      // them; a wider span would still be correct, only less efficient.
      mesh.instanceColor.addUpdateRange(min * COLOR_STRIDE, (max - min + 1) * COLOR_STRIDE);
      mesh.instanceColor.needsUpdate = true;
    }
  }

  function dispose() {
    geometry.dispose();
    material.dispose();
    ground.dispose();
  }

  function setPixelRatio(next: number) {
    updatePrintMaterialScale(material, next);
    ground.setPixelRatio(next);
  }

  return {
    threeScene,
    camera,
    lookAtHeight,
    updateFrustum,
    dispose,
    setPixelRatio,
    setGroundTime: ground.setTime,
    setRegistration: ground.setRegistration,
    hasHidden,
    revealOne,
    driftColor,
    revealRng,
    driftRng,
  };
}

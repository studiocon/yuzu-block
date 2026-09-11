"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { INK, YUZU_WHITE, YUZU_YELLOW, YUZU_ZEST } from "@/lib/palette";
import type { Block, SceneSpec } from "@/lib/types";

const BLOCK_SCALE = 0.96;

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
    container.appendChild(canvas);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch {
      return () => {
        container.removeChild(canvas);
      };
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(new THREE.Color(YUZU_WHITE), 1);

    const three = buildScene(scene);
    const { threeScene, camera, updateCameraForViewport } = three;

    const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const prefersReducedMotion = reduceMotionQuery.matches;

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
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      updateCameraForViewport(width / height);
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

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
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
  updateCameraForViewport: (aspect: number) => void;
  dispose: () => void;
}

function buildScene(scene: SceneSpec): BuiltScene {
  const threeScene = new THREE.Scene();

  const hemiLight = new THREE.HemisphereLight(
    new THREE.Color(YUZU_WHITE),
    new THREE.Color(INK),
    0.9,
  );
  threeScene.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
  dirLight.position.set(1, 1.6, 0.8);
  threeScene.add(dirLight);

  const geometry = new THREE.BoxGeometry(BLOCK_SCALE, BLOCK_SCALE, BLOCK_SCALE);
  const yellowMaterial = new THREE.MeshLambertMaterial({ color: new THREE.Color(YUZU_YELLOW) });
  const zestMaterial = new THREE.MeshLambertMaterial({ color: new THREE.Color(YUZU_ZEST) });

  const yellowBlocks = scene.blocks.filter((b) => b.color === "yellow");
  const zestBlocks = scene.blocks.filter((b) => b.color === "zest");

  const yellowMesh = buildInstancedMesh(geometry, yellowMaterial, yellowBlocks);
  const zestMesh = buildInstancedMesh(geometry, zestMaterial, zestBlocks);
  if (yellowMesh) threeScene.add(yellowMesh);
  if (zestMesh) threeScene.add(zestMesh);

  const lookAtHeight = scene.maxHeight * 0.3;

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);
  const elevation = THREE.MathUtils.degToRad(35);
  const halfWidth = Math.max(1, scene.extent);

  function updateCameraForViewport(aspect: number) {
    const vFovRad = THREE.MathUtils.degToRad(camera.fov);
    const hFovRad = 2 * Math.atan(Math.tan(vFovRad / 2) * aspect);
    const effectiveFov = Math.min(vFovRad, hFovRad);

    // Half-extent of the sculpture footprint (diagonal, to be safe for any
    // rotation) plus its height, fit within the smaller of the two FOVs.
    const footprintRadius = halfWidth * Math.SQRT2;
    const radius = Math.max(footprintRadius, scene.maxHeight);
    const distance = radius / Math.tan(effectiveFov / 2) + radius;

    const horizontalDistance = distance * Math.cos(elevation);
    const verticalDistance = distance * Math.sin(elevation);

    camera.position.set(0, lookAtHeight + verticalDistance, horizontalDistance);
    camera.lookAt(0, lookAtHeight, 0);
  }

  updateCameraForViewport(1);

  function dispose() {
    geometry.dispose();
    yellowMaterial.dispose();
    zestMaterial.dispose();
    yellowMesh?.dispose();
    zestMesh?.dispose();
  }

  return { threeScene, camera, lookAtHeight, updateCameraForViewport, dispose };
}

interface DisposableInstancedMesh extends THREE.InstancedMesh {
  dispose: () => void;
}

function buildInstancedMesh(
  geometry: THREE.BoxGeometry,
  material: THREE.MeshLambertMaterial,
  blocks: Block[],
): DisposableInstancedMesh | null {
  if (blocks.length === 0) return null;

  const mesh = new THREE.InstancedMesh(geometry, material, blocks.length) as DisposableInstancedMesh;
  const matrix = new THREE.Matrix4();
  blocks.forEach((block, i) => {
    matrix.makeTranslation(block.x, block.y + 0.5, block.z);
    mesh.setMatrixAt(i, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.dispose = () => {
    // Geometry and material are shared/disposed by the caller; this mesh
    // itself holds no additional GPU resources beyond instanceMatrix,
    // which is released when the mesh is garbage collected after removal.
  };
  return mesh;
}

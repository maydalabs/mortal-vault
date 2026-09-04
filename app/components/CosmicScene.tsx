"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

import type { ConstellationStar } from "@/lib/constellation";

type CosmicSceneProps = {
  vaultStars?: ConstellationStar[];
};

/** Soft radial glow texture, drawn once on a canvas. */
function glowTexture(inner: string, outer: string): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(
    size / 2, size / 2, 0,
    size / 2, size / 2, size / 2,
  );
  gradient.addColorStop(0, inner);
  gradient.addColorStop(1, outer);
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function starSpriteTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(
    size / 2, size / 2, 0,
    size / 2, size / 2, size / 2,
  );
  gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
  gradient.addColorStop(0.4, "rgba(255, 255, 255, 0.55)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function hashDepth(owner: string): number {
  let h = 3;
  for (let i = 0; i < owner.length; i++) h = (h * 33 + owner.charCodeAt(i)) % 9973;
  return h / 9973;
}

/**
 * The universe behind everything: thousands of drifting stars with depth,
 * faint nebulae, gentle mouse parallax — and the constellation of real
 * vaults as glowing aurora bodies among them.
 */
export function CosmicScene({ vaultStars }: CosmicSceneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const vaultGroupRef = useRef<THREE.Group | null>(null);
  const starsRef = useRef<ConstellationStar[] | undefined>(vaultStars);

  useEffect(() => {
    starsRef.current = vaultStars;
  }, [vaultStars]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      600,
    );
    camera.position.z = 60;

    // WebGL is not always available. It is a fingerprinting surface, so the
    // privacy-minded people this product is for often disable it, and Tor
    // Browser blocks it by default. This scene is decorative and aria-hidden,
    // so when there is no context we leave the page without a starfield rather
    // than letting the throw take the whole app down.
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    // --- Star layers (two clouds with opposing twinkle phases) -----------
    const starSprite = starSpriteTexture();
    const makeStarCloud = (count: number, size: number) => {
      const positions = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      const palette = [
        new THREE.Color("#e0e7ff"),
        new THREE.Color("#c9d6ff"),
        new THREE.Color("#fdf3d8"),
        new THREE.Color("#bfe8d8"),
      ];
      for (let i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 260;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 150;
        positions[i * 3 + 2] = -30 - Math.random() * 160;
        const color = palette[Math.floor(Math.random() * palette.length)];
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      const material = new THREE.PointsMaterial({
        size,
        map: starSprite,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const points = new THREE.Points(geometry, material);
      scene.add(points);
      return { points, material, geometry };
    };

    const compact = window.innerWidth < 640;
    const cloudA = makeStarCloud(compact ? 550 : 1100, 0.6);
    const cloudB = makeStarCloud(compact ? 320 : 650, 1.05);

    // --- Nebulae: two vast, nearly invisible drifting glows --------------
    const auroraTexture = glowTexture("rgba(92, 224, 161, 0.16)", "rgba(92, 224, 161, 0)");
    const violetTexture = glowTexture("rgba(122, 110, 228, 0.13)", "rgba(122, 110, 228, 0)");
    const makeNebula = (texture: THREE.CanvasTexture, x: number, y: number, z: number, scale: number) => {
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.position.set(x, y, z);
      sprite.scale.setScalar(scale);
      scene.add(sprite);
      return sprite;
    };
    const nebulaA = makeNebula(auroraTexture, 70, 38, -170, 240);
    const nebulaB = makeNebula(violetTexture, -80, -46, -190, 260);

    // --- The constellation: real vaults as aurora bodies ------------------
    const vaultTexture = glowTexture("rgba(140, 255, 200, 0.95)", "rgba(92, 224, 161, 0)");
    const vaultGroup = new THREE.Group();
    scene.add(vaultGroup);
    vaultGroupRef.current = vaultGroup;

    const rebuildVaultStars = (stars: ConstellationStar[] | undefined) => {
      while (vaultGroup.children.length > 0) {
        const child = vaultGroup.children[0] as THREE.Sprite;
        vaultGroup.remove(child);
        child.material.dispose();
      }
      for (const star of stars ?? []) {
        const material = new THREE.SpriteMaterial({
          map: vaultTexture,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const sprite = new THREE.Sprite(material);
        const depth = -40 - hashDepth(star.owner) * 60;
        sprite.position.set((star.x - 0.5) * 150, (0.5 - star.y) * 85, depth);
        sprite.scale.setScalar(star.fresh ? 7 : 4.6);
        sprite.userData = { fresh: star.fresh, base: star.fresh ? 7 : 4.6, phase: hashDepth(star.owner) * Math.PI * 2 };
        vaultGroup.add(sprite);
      }
    };
    rebuildVaultStars(starsRef.current);
    let knownStars = starsRef.current;

    // --- Parallax ---------------------------------------------------------
    let targetX = 0;
    let targetY = 0;
    const handlePointer = (event: PointerEvent) => {
      targetX = (event.clientX / window.innerWidth - 0.5) * 2;
      targetY = (event.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener("pointermove", handlePointer);

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", handleResize);

    // --- Loop -------------------------------------------------------------
    let frame = 0;
    let running = true;
    const startTime = performance.now();

    const render = () => {
      const t = (performance.now() - startTime) / 1000;

      if (starsRef.current !== knownStars) {
        knownStars = starsRef.current;
        rebuildVaultStars(knownStars);
      }

      cloudA.material.opacity = 0.55 + 0.2 * Math.sin(t * 0.7);
      cloudB.material.opacity = 0.55 + 0.2 * Math.sin(t * 0.7 + Math.PI);
      cloudA.points.rotation.z = t * 0.004;
      cloudB.points.rotation.z = -t * 0.003;

      nebulaA.position.x = 70 + Math.sin(t * 0.03) * 12;
      nebulaB.position.y = -46 + Math.cos(t * 0.025) * 9;

      for (const child of vaultGroup.children) {
        const sprite = child as THREE.Sprite;
        const { fresh, base, phase } = sprite.userData as { fresh: boolean; base: number; phase: number };
        const pulse = fresh ? 1 + 0.35 * Math.sin(t * 2.2 + phase) : 1 + 0.08 * Math.sin(t * 0.9 + phase);
        sprite.scale.setScalar(base * pulse);
      }

      camera.position.x += (targetX * 3 - camera.position.x) * 0.03;
      camera.position.y += (-targetY * 2 - camera.position.y) * 0.03;
      camera.lookAt(0, 0, -80);

      renderer.render(scene, camera);
    };

    const loop = () => {
      if (!running) return;
      // Hidden tabs are throttled by the browser's own rAF scheduling.
      render();
      frame = window.requestAnimationFrame(loop);
    };

    // Paint immediately — don't wait for the first rAF tick (which never
    // arrives at all in a hidden tab).
    render();
    if (!reducedMotion) {
      frame = window.requestAnimationFrame(loop);
    }

    return () => {
      running = false;
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", handlePointer);
      window.removeEventListener("resize", handleResize);
      rebuildVaultStars([]);
      cloudA.geometry.dispose();
      cloudA.material.dispose();
      cloudB.geometry.dispose();
      cloudB.material.dispose();
      nebulaA.material.dispose();
      nebulaB.material.dispose();
      starSprite.dispose();
      auroraTexture.dispose();
      violetTexture.dispose();
      vaultTexture.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
    // The scene is built once; live star updates flow through starsRef.
     
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[1]"
    />
  );
}

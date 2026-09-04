"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

type VaultStar3DProps = {
  toneHex: string;
  /** 0..1: how far the eclipse has progressed; null/undefined = no eclipse. */
  eclipseFraction?: number | null;
  /** Faster breathing under threat. */
  urgent?: boolean;
};

const VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vPos;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vPos;
  uniform float uTime;
  uniform vec3 uColor;
  void main() {
    float fres = pow(1.0 - abs(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0))), 1.5);
    float shimmer = 0.5 + 0.5
      * sin(vPos.x * 7.0 + uTime * 1.1)
      * sin(vPos.y * 8.0 - uTime * 0.9)
      * sin(vPos.z * 6.0 + uTime * 0.7);
    vec3 core = mix(vec3(1.0, 0.97, 0.9), uColor, clamp(fres * 1.35, 0.0, 1.0));
    vec3 color = core * (0.72 + 0.4 * shimmer);
    gl_FragColor = vec4(color, 0.96 - fres * 0.2);
  }
`;

function coronaTexture(color: THREE.Color): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(
    size / 2, size / 2, size * 0.1,
    size / 2, size / 2, size / 2,
  );
  const rgb = `${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}`;
  gradient.addColorStop(0, `rgba(${rgb}, 0.55)`);
  gradient.addColorStop(0.5, `rgba(${rgb}, 0.16)`);
  gradient.addColorStop(1, `rgba(${rgb}, 0)`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

/**
 * The vault as a living celestial body: a shader-lit sun with a corona and
 * orbiting dust — and, under an active claim, a dark body physically
 * crossing it toward totality.
 */
export function VaultStar3D({ toneHex, eclipseFraction, urgent }: VaultStar3DProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef({ toneHex, eclipseFraction, urgent });

  useEffect(() => {
    stateRef.current = { toneHex, eclipseFraction, urgent };
  }, [toneHex, eclipseFraction, urgent]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const size = container.clientWidth || 240;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 50);
    camera.position.z = 6;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(size, size);
    container.appendChild(renderer.domElement);

    const tone = new THREE.Color(stateRef.current.toneHex);

    const sunMaterial = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: tone.clone() },
      },
    });
    const sun = new THREE.Mesh(new THREE.SphereGeometry(1.18, 48, 48), sunMaterial);
    scene.add(sun);

    const coronaMap = coronaTexture(tone);
    const coronaMaterial = new THREE.SpriteMaterial({
      map: coronaMap,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const corona = new THREE.Sprite(coronaMaterial);
    corona.scale.setScalar(4.6);
    corona.position.z = -0.5;
    scene.add(corona);

    // Orbiting dust: a thin ring of embers circling the star.
    const dustCount = 110;
    const dustPositions = new Float32Array(dustCount * 3);
    const dustSeed: Array<{ radius: number; speed: number; phase: number; tilt: number }> = [];
    for (let i = 0; i < dustCount; i++) {
      dustSeed.push({
        radius: 1.7 + Math.random() * 0.9,
        speed: 0.12 + Math.random() * 0.25,
        phase: Math.random() * Math.PI * 2,
        tilt: (Math.random() - 0.5) * 0.7,
      });
    }
    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
    const dustMaterial = new THREE.PointsMaterial({
      size: 0.035,
      color: tone.clone().lerp(new THREE.Color("#ffffff"), 0.35),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const dust = new THREE.Points(dustGeometry, dustMaterial);
    scene.add(dust);

    // The eclipsing body: a void-dark sphere that crosses in front.
    const shadowMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color("#05060c") });
    const shadow = new THREE.Mesh(new THREE.SphereGeometry(1.24, 48, 48), shadowMaterial);
    shadow.position.z = 1.1;
    shadow.visible = false;
    scene.add(shadow);

    let frame = 0;
    let running = true;
    const startTime = performance.now();
    let shadowX = 6;

    const render = () => {
      const t = (performance.now() - startTime) / 1000;
      const current = stateRef.current;

      sunMaterial.uniforms.uTime.value = t;
      const targetTone = new THREE.Color(current.toneHex);
      (sunMaterial.uniforms.uColor.value as THREE.Color).lerp(targetTone, 0.06);
      dustMaterial.color.lerp(targetTone.clone().lerp(new THREE.Color("#ffffff"), 0.35), 0.06);

      const breath = 1 + 0.035 * Math.sin(t * (current.urgent ? 3.6 : 1.35));
      sun.scale.setScalar(breath);
      corona.scale.setScalar(4.6 * (1 + 0.06 * Math.sin(t * (current.urgent ? 3.6 : 1.35) + 0.7)));
      sun.rotation.y = t * 0.12;

      const positions = dustGeometry.attributes.position.array as Float32Array;
      for (let i = 0; i < dustCount; i++) {
        const seed = dustSeed[i];
        const angle = seed.phase + t * seed.speed;
        positions[i * 3] = Math.cos(angle) * seed.radius;
        positions[i * 3 + 1] = Math.sin(angle) * seed.radius * 0.34 + Math.sin(angle * 2) * seed.tilt * 0.2;
        positions[i * 3 + 2] = Math.sin(angle) * seed.radius * 0.6;
      }
      dustGeometry.attributes.position.needsUpdate = true;

      const eclipse = current.eclipseFraction;
      if (eclipse === null || eclipse === undefined) {
        shadow.visible = false;
        shadowX = 6;
      } else {
        shadow.visible = true;
        const target = (1 - Math.min(1, Math.max(0, eclipse))) * 4.2;
        shadowX += (target - shadowX) * 0.04;
        shadow.position.x = shadowX;
        shadow.position.y = shadowX * 0.08;
      }

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
      sun.geometry.dispose();
      sunMaterial.dispose();
      coronaMaterial.dispose();
      coronaMap.dispose();
      dustGeometry.dispose();
      dustMaterial.dispose();
      shadow.geometry.dispose();
      shadowMaterial.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
    // Built once; tone/eclipse/urgency updates stream in through stateRef.
     
  }, []);

  return <div ref={containerRef} className="absolute inset-0" aria-hidden="true" />;
}

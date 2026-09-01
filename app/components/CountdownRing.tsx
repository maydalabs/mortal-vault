"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { RING_TRACK, TONE_HEX, type Tone } from "./tone";

const VaultStar3D = dynamic(
  () => import("./VaultStar3D").then((module) => module.VaultStar3D),
  { ssr: false },
);

const RADIUS = 104;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

type CountdownRingProps = {
  tone: Tone;
  /** Portion of the arc to fill, 0..1. */
  fraction: number;
  value: string;
  label: string;
  /** Optional live clock line (hh:mm:ss) rendered under the label. */
  clock?: string | null;
  /**
   * When set, a dark disc slides across the star: 0 = eclipse just begun
   * (disc at the rim), 1 = totality (claim executable).
   */
  eclipseFraction?: number | null;
};

export function CountdownRing({
  tone,
  fraction,
  value,
  label,
  clock,
  eclipseFraction,
}: CountdownRingProps) {
  const clamped = Math.min(1, Math.max(0, fraction));
  const targetOffset = CIRCUMFERENCE * (1 - clamped);
  const valueSize = value.length > 4 ? "text-3xl" : "text-5xl";

  // Draw the arc in on mount: first paint empty, then transition to target.
  // A timeout (not rAF) so the draw-in also happens in background tabs.
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setDrawn(true), 60);
    return () => window.clearTimeout(timer);
  }, []);

  const eclipsing = eclipseFraction !== null && eclipseFraction !== undefined;

  return (
    <div className="relative h-60 w-60 flex-shrink-0" aria-hidden="true">
      {/* The star itself: a living celestial body. */}
      <VaultStar3D
        toneHex={TONE_HEX[tone]}
        eclipseFraction={eclipseFraction}
        urgent={eclipsing}
      />

      <svg width="240" height="240" viewBox="0 0 240 240" className="absolute inset-0">
        <circle
          cx="120"
          cy="120"
          r={RADIUS}
          fill="none"
          stroke={RING_TRACK}
          strokeWidth="6"
        />
        <circle
          className="ring-breathe"
          cx="120"
          cy="120"
          r={RADIUS}
          fill="none"
          stroke={TONE_HEX[tone]}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={drawn ? targetOffset : CIRCUMFERENCE}
          transform="rotate(-90 120 120)"
          style={{ transition: "stroke-dashoffset 1.6s cubic-bezier(0.22, 1, 0.36, 1)" }}
        />
        <circle
          cx="120"
          cy="120"
          r={RADIUS}
          fill="none"
          stroke={TONE_HEX[tone]}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={drawn ? targetOffset : CIRCUMFERENCE}
          transform="rotate(-90 120 120)"
          style={{ transition: "stroke-dashoffset 1.6s cubic-bezier(0.22, 1, 0.36, 1)" }}
        />
      </svg>

      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1">
        <div
          className={`font-serif font-light leading-none text-ink ${valueSize}`}
          style={{ textShadow: "0 2px 18px rgba(5, 6, 12, 0.9)" }}
        >
          {value}
        </div>
        <div
          className="text-xs tracking-wide text-ink-soft"
          style={{ textShadow: "0 1px 10px rgba(5, 6, 12, 0.9)" }}
        >
          {label}
        </div>
        {clock && (
          <div
            className="mt-0.5 font-mono text-[13px] tabular-nums"
            style={{ color: TONE_HEX[tone], textShadow: "0 1px 10px rgba(5, 6, 12, 0.9)" }}
          >
            {clock}
          </div>
        )}
      </div>
    </div>
  );
}

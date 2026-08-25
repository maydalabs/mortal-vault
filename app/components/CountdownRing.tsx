import { useEffect, useState } from "react";

import { RING_TRACK, TONE_HEX, type Tone } from "./tone";

const RADIUS = 104;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

type CountdownRingProps = {
  tone: Tone;
  /** Portion of the ring to fill, 0..1. */
  fraction: number;
  value: string;
  label: string;
  /** Optional live clock line (hh:mm:ss) rendered under the label. */
  clock?: string | null;
};

export function CountdownRing({ tone, fraction, value, label, clock }: CountdownRingProps) {
  const clamped = Math.min(1, Math.max(0, fraction));
  const targetOffset = CIRCUMFERENCE * (1 - clamped);
  const valueSize = value.length > 4 ? "text-4xl" : "text-6xl";

  // Draw the arc in on mount: first paint empty, then transition to target.
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="relative h-60 w-60 flex-shrink-0" aria-hidden="true">
      <svg width="240" height="240" viewBox="0 0 240 240" className="absolute inset-0">
        <circle
          cx="120"
          cy="120"
          r={RADIUS}
          fill="none"
          stroke={RING_TRACK}
          strokeWidth="10"
        />
        <circle
          className="ring-breathe"
          cx="120"
          cy="120"
          r={RADIUS}
          fill="none"
          stroke={TONE_HEX[tone]}
          strokeWidth="16"
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
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={drawn ? targetOffset : CIRCUMFERENCE}
          transform="rotate(-90 120 120)"
          style={{ transition: "stroke-dashoffset 1.6s cubic-bezier(0.22, 1, 0.36, 1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
        <div className={`font-serif font-light leading-none text-ink ${valueSize}`}>
          {value}
        </div>
        <div className="text-xs tracking-wide text-muted">{label}</div>
        {clock && (
          <div className="mt-1 font-mono text-[13px] tabular-nums" style={{ color: TONE_HEX[tone] }}>
            {clock}
          </div>
        )}
      </div>
    </div>
  );
}

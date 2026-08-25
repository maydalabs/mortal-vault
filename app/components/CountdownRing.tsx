import { RING_TRACK, TONE_HEX, type Tone } from "./tone";

const RADIUS = 104;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

type CountdownRingProps = {
  tone: Tone;
  /** Portion of the ring to fill, 0..1. */
  fraction: number;
  value: string;
  label: string;
};

export function CountdownRing({ tone, fraction, value, label }: CountdownRingProps) {
  const clamped = Math.min(1, Math.max(0, fraction));
  const offset = CIRCUMFERENCE * (1 - clamped);
  const valueSize = value.length > 4 ? "text-4xl" : "text-6xl";

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
          cx="120"
          cy="120"
          r={RADIUS}
          fill="none"
          stroke={TONE_HEX[tone]}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          transform="rotate(-90 120 120)"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
        <div className={`font-serif font-light leading-none text-ink ${valueSize}`}>
          {value}
        </div>
        <div className="text-xs tracking-wide text-muted">{label}</div>
      </div>
    </div>
  );
}

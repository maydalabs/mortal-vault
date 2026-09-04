import { useEffect, useRef, useState } from "react";

export type Ritual =
  | { kind: "checkin"; days: number }
  | { kind: "sealed"; days: number };

type RitualOverlayProps = {
  ritual: Ritual;
  onDone: () => void;
};

const VISIBLE_MS = 3400;

export function RitualOverlay({ ritual, onDone }: RitualOverlayProps) {
  const [leaving, setLeaving] = useState(false);

  // The parent re-renders every second (live clocks), so onDone gets a new
  // identity constantly; run the dismiss timers once and read the latest
  // callback through a ref instead of resetting them on every render.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const leaveTimer = window.setTimeout(() => setLeaving(true), VISIBLE_MS - 500);
    const doneTimer = window.setTimeout(() => onDoneRef.current(), VISIBLE_MS);
    return () => {
      window.clearTimeout(leaveTimer);
      window.clearTimeout(doneTimer);
    };
  }, []);

  const headline = ritual.kind === "checkin" ? "Welcome back." : "Your vault is sealed.";
  const sub =
    ritual.kind === "checkin"
      ? `Your quiet period has reset — ${ritual.days} days of calm ahead.`
      : `From today, it stands guard. Check in within ${ritual.days} days, as life allows.`;

  return (
    <div
      role="status"
      onClick={onDone}
      className={`fixed inset-0 z-50 flex cursor-pointer flex-col items-center justify-center gap-8 ${leaving ? "fade-out" : "fade-in"}`}
      style={{ background: "rgba(5, 6, 12, 0.94)" }}
    >
      <div className="relative flex h-64 w-64 items-center justify-center" aria-hidden="true">
        <svg viewBox="0 0 256 256" className="absolute inset-0 h-full w-full overflow-visible">
          <circle className="ritual-ripple" cx="128" cy="128" r="100" fill="none" stroke="#5ce0a1" strokeWidth="1.5" />
          <circle className="ritual-ripple ritual-ripple-2" cx="128" cy="128" r="100" fill="none" stroke="#5ce0a1" strokeWidth="1" />
          <circle className="ritual-ripple ritual-ripple-3" cx="128" cy="128" r="100" fill="none" stroke="#5ce0a1" strokeWidth="0.75" />
        </svg>
        <div
          className="stamp-in flex h-40 w-40 flex-col items-center justify-center gap-1 rounded-full"
          style={{ border: "2px solid #5ce0a1", color: "#5ce0a1", boxShadow: "0 0 40px rgba(92, 224, 161, 0.25), inset 0 0 30px rgba(92, 224, 161, 0.08)" }}
        >
          <div className="text-[11px] font-semibold tracking-[0.3em]">
            {ritual.kind === "checkin" ? "ALIVE" : "SEALED"}
          </div>
          <div className="font-mono text-[12px] tracking-[0.2em]">&amp; WELL</div>
          <div className="mt-1 h-px w-12" style={{ background: "rgba(92, 224, 161, 0.5)" }} />
          <div className="font-mono text-[10px] tracking-[0.12em]">
            {new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          </div>
        </div>
      </div>
      <div className="flex flex-col items-center gap-3 px-6 text-center">
        <div className="font-serif text-3xl font-light text-parchment sm:text-4xl">{headline}</div>
        <div className="max-w-md text-base leading-relaxed text-muted">{sub}</div>
      </div>
    </div>
  );
}

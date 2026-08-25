import { useEffect, useState } from "react";

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

  useEffect(() => {
    const leaveTimer = window.setTimeout(() => setLeaving(true), VISIBLE_MS - 500);
    const doneTimer = window.setTimeout(onDone, VISIBLE_MS);
    return () => {
      window.clearTimeout(leaveTimer);
      window.clearTimeout(doneTimer);
    };
  }, [onDone]);

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
      style={{ background: "rgba(245, 241, 230, 0.96)" }}
    >
      <div className="relative flex h-64 w-64 items-center justify-center" aria-hidden="true">
        <svg viewBox="0 0 256 256" className="absolute inset-0 h-full w-full overflow-visible">
          <circle className="ritual-ripple" cx="128" cy="128" r="100" fill="none" stroke="#3e6e54" strokeWidth="1.5" />
          <circle className="ritual-ripple ritual-ripple-2" cx="128" cy="128" r="100" fill="none" stroke="#3e6e54" strokeWidth="1" />
          <circle className="ritual-ripple ritual-ripple-3" cx="128" cy="128" r="100" fill="none" stroke="#3e6e54" strokeWidth="0.75" />
        </svg>
        <div
          className="stamp-in flex h-40 w-40 flex-col items-center justify-center gap-1 rounded-full"
          style={{ border: "2.5px solid #3e6e54", color: "#3e6e54" }}
        >
          <div className="text-[11px] font-semibold tracking-[0.3em]">
            {ritual.kind === "checkin" ? "ALIVE" : "SEALED"}
          </div>
          <div className="font-serif text-[15px] italic">&amp; well</div>
          <div className="mt-1 h-px w-12" style={{ background: "rgba(62, 110, 84, 0.5)" }} />
          <div className="font-mono text-[10px] tracking-[0.12em]">
            {new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          </div>
        </div>
      </div>
      <div className="flex flex-col items-center gap-3 px-6 text-center">
        <div className="font-serif text-5xl font-medium italic text-ink">{headline}</div>
        <div className="max-w-md text-base leading-relaxed text-muted">{sub}</div>
      </div>
    </div>
  );
}

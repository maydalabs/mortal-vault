import { assessDurationRisk } from "@/lib/duration-policy";

type DurationWarningsProps = {
  inactivityDays: string | number;
  claimDelayDays: string | number;
};

export function DurationWarnings({
  inactivityDays,
  claimDelayDays,
}: DurationWarningsProps) {
  const notes = assessDurationRisk(inactivityDays, claimDelayDays);
  if (notes.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col gap-2 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-[13px] leading-relaxed text-warn"
    >
      {notes.map((note) => (
        <div key={note.id} className="flex items-start gap-2.5">
          <span
            className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-warn"
            aria-hidden="true"
          />
          <span>{note.message}</span>
        </div>
      ))}
    </div>
  );
}

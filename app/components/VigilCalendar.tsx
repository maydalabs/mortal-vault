import { useMemo } from "react";

import type { VaultActivity } from "@/lib/vault-events";
import { buildVigil, type VigilMark } from "@/lib/vigil";

const MARK_PRIORITY: VigilMark[] = ["claim", "saved", "deposit", "withdraw", "checkin"];

const MARK_COLOR: Record<VigilMark, string> = {
  claim: "#ee6a4d",
  saved: "#8cf0c0",
  deposit: "#d8c58f",
  withdraw: "#8b92a6",
  checkin: "#5ce0a1",
};

const MARK_LABEL: Record<VigilMark, string> = {
  claim: "claim attempt",
  saved: "claim turned away",
  deposit: "deposit",
  withdraw: "withdrawal",
  checkin: "check-in",
};

const LEGEND: VigilMark[] = ["checkin", "deposit", "withdraw", "saved", "claim"];

function cellColor(marks: VigilMark[]): string {
  for (const mark of MARK_PRIORITY) {
    if (marks.includes(mark)) return MARK_COLOR[mark];
  }
  return "rgba(238, 241, 248, 0.07)";
}

type VigilCalendarProps = {
  items: VaultActivity[];
  nowSeconds: number;
};

/**
 * The owner's whole history as a field of days: every check-in a light,
 * every claim scare an ember, every save a flare.
 */
export function VigilCalendar({ items, nowSeconds }: VigilCalendarProps) {
  const vigil = useMemo(() => buildVigil(items, nowSeconds), [items, nowSeconds]);
  const { stats } = vigil;

  const sentence = [
    stats.vigilDays !== null
      ? `Keeping the vigil for ${stats.vigilDays} day${stats.vigilDays === 1 ? "" : "s"}`
      : "Keeping the vigil",
    `${stats.checkIns} check-in${stats.checkIns === 1 ? "" : "s"}`,
    `${stats.deposits} deposit${stats.deposits === 1 ? "" : "s"}`,
    ...(stats.claimsTurnedAway > 0
      ? [`${stats.claimsTurnedAway} claim${stats.claimsTurnedAway === 1 ? "" : "s"} turned away`]
      : []),
  ].join(" · ");

  return (
    <section className="flex flex-col gap-4 rounded-[14px] border border-hairline bg-panel/80 p-6 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <span className="text-[11px] tracking-[0.13em] text-faint">THE VIGIL</span>
        <span className="h-px flex-1 bg-hairline" aria-hidden="true" />
      </div>
      <p className="font-mono text-[12.5px] tracking-[0.04em] text-ink-soft">
        {sentence}
        {stats.partial ? " · earliest days beyond this window" : ""}
      </p>
      <div className="overflow-x-auto pb-1">
        <div className="flex gap-[3px]" aria-hidden="true">
          {vigil.weeks.map((week, weekIndex) => (
            <div key={weekIndex} className="flex flex-col gap-[3px]">
              {week.map((day) => (
                <div
                  key={day.iso}
                  title={
                    day.marks.length > 0
                      ? `${day.iso}: ${day.marks.map((mark) => MARK_LABEL[mark]).join(", ")}`
                      : day.iso
                  }
                  className="h-[11px] w-[11px] rounded-[3px]"
                  style={{
                    background: cellColor(day.marks),
                    boxShadow: day.marks.length > 0 ? `0 0 6px ${cellColor(day.marks)}55` : "none",
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-faint">
        {LEGEND.map((mark) => (
          <span key={mark} className="flex items-center gap-1.5">
            <span
              className="inline-block h-[9px] w-[9px] rounded-[2.5px]"
              style={{ background: MARK_COLOR[mark] }}
              aria-hidden="true"
            />
            {MARK_LABEL[mark]}
          </span>
        ))}
      </div>
    </section>
  );
}

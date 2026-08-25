import type { ReactNode } from "react";

import { CountdownRing } from "./CountdownRing";
import { TONE_BUTTON_TEXT, TONE_HEX, toneTint, type Tone } from "./tone";

export type HeroAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

export type HeroRing = {
  fraction: number;
  value: string;
  label: string;
  clock?: string | null;
};

type StatusHeroProps = {
  tone: Tone;
  overline: string;
  headline: string;
  body: ReactNode;
  note?: ReactNode;
  ring?: HeroRing | null;
  primary?: HeroAction;
  secondary?: HeroAction;
  /** Extra content (e.g. the vault setup form) rendered under the copy. */
  children?: ReactNode;
};

export function StatusHero({
  tone,
  overline,
  headline,
  body,
  note,
  ring,
  primary,
  secondary,
  children,
}: StatusHeroProps) {
  const accent = TONE_HEX[tone];
  return (
    <section
      className="relative mx-6 overflow-hidden rounded-2xl border p-8 md:mx-10 md:p-12"
      style={{
        borderColor: tone === "danger" ? toneTint("danger", 0.35) : "var(--color-hairline)",
        background: `linear-gradient(180deg, ${toneTint(tone, 0.06)}, ${toneTint(tone, 0)} 60%), var(--color-panel)`,
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 top-1/2 h-[400px] w-[400px] -translate-y-1/2 rounded-full"
        style={{
          background: `radial-gradient(circle, ${toneTint(tone, 0.1)}, ${toneTint(tone, 0)} 65%)`,
        }}
      />
      <div className="relative flex flex-col items-start justify-between gap-10 lg:flex-row lg:items-center">
        <div className="flex max-w-2xl flex-col gap-4">
          <div
            className="rise rise-1 text-[11px] font-semibold tracking-[0.18em]"
            style={{ color: accent }}
          >
            {overline}
          </div>
          <h1 className="rise rise-2 font-serif text-4xl font-medium leading-[1.1] text-parchment md:text-5xl">
            {headline}
          </h1>
          <div className="rise rise-3 text-base leading-relaxed text-muted">{body}</div>
          {(primary || secondary) && (
            <div className="rise rise-4 mt-2 flex flex-wrap gap-3">
              {primary && (
                <button
                  type="button"
                  onClick={primary.onClick}
                  disabled={primary.disabled}
                  className="inline-flex h-[46px] items-center rounded-[10px] px-6 text-[15px] font-semibold transition hover:brightness-110 disabled:opacity-40"
                  style={{ background: accent, color: TONE_BUTTON_TEXT[tone] }}
                >
                  {primary.label}
                </button>
              )}
              {secondary && (
                <button
                  type="button"
                  onClick={secondary.onClick}
                  disabled={secondary.disabled}
                  className="inline-flex h-[46px] items-center rounded-[10px] border border-hairline-strong px-5 text-[15px] font-medium text-ink-soft transition hover:bg-inset disabled:opacity-40"
                >
                  {secondary.label}
                </button>
              )}
            </div>
          )}
          {note && <div className="rise rise-5 text-[13.5px] leading-relaxed text-faint">{note}</div>}
          {children}
        </div>
        {ring && (
          <div className="rise rise-2">
            <CountdownRing tone={tone} fraction={ring.fraction} value={ring.value} label={ring.label} clock={ring.clock} />
          </div>
        )}
      </div>
    </section>
  );
}

"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { buildHeirGuide, type HeirGuideInput } from "@/lib/heir-guide";

type HeirGuideSheetProps = {
  input: HeirGuideInput;
  onClose: () => void;
};

/**
 * The page an owner prints and leaves behind.
 *
 * It renders through a portal so that printing can hide every other direct
 * child of the body and put this sheet, alone, on paper.
 */
export function HeirGuideSheet({ input, onClose }: HeirGuideSheetProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  /*
   * aria-modal="true" tells assistive technology that everything behind this
   * dialog does not exist. That was a promise the component did not keep: the
   * background stayed focusable, so a keyboard user tabbed out of the dialog
   * into content their screen reader had been told to ignore, with no way to
   * tell where they had gone.
   *
   * `inert` makes the rest of the page genuinely unreachable — both to focus
   * and to assistive technology — which is what the attribute claims. The Tab
   * handler below is the backstop for browsers without it.
   */
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const siblings = [...document.body.children].filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && !child.contains(dialog),
    );
    const wasInert = siblings.map((el) => el.inert);
    siblings.forEach((el) => {
      el.inert = true;
    });

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusable = () =>
      [
        ...dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => el.offsetParent !== null);

    focusable()[0]?.focus();

    // An arrow function, not a declaration: a hoisted declaration could in
    // principle run before the null check above, so TypeScript drops the
    // narrowing on `dialog` inside one.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      siblings.forEach((el, index) => {
        el.inert = wasInert[index];
      });
      document.body.style.overflow = previousOverflow;
      // Send the keyboard back where it came from, not to the top of the page.
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  // Only ever rendered in response to a click, so document.body exists here.
  const guide = buildHeirGuide(input);

  return createPortal(
    <div
      ref={dialogRef}
      className="heir-guide-portal fixed inset-0 z-50 overflow-y-auto bg-bg/92 px-4 py-10 backdrop-blur-sm sm:px-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="heir-guide-heading"
    >
      <div className="heir-guide-chrome mx-auto mb-5 flex w-full max-w-[720px] items-center gap-3">
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex h-11 items-center justify-center rounded-[9px] bg-gold px-5 text-sm font-semibold text-on-accent transition hover:brightness-110"
        >
          Print or save as PDF
        </button>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-11 items-center justify-center rounded-[9px] border border-hairline-strong px-5 text-sm text-ink-soft transition hover:bg-inset"
        >
          Close
        </button>
        <p className="ml-auto hidden text-[12.5px] text-faint sm:block">
          Print it. A vault nobody can find is a vault nobody inherits.
        </p>
      </div>

      <article className="heir-guide-sheet mx-auto w-full max-w-[720px] rounded-[14px] bg-parchment px-8 py-10 text-[#1b1a17] shadow-[0_30px_80px_rgba(0,0,0,0.55)] sm:px-12">
        <header className="border-b border-[#1b1a17]/15 pb-6">
          <p className="text-[11px] tracking-[0.18em] text-[#1b1a17]/55">
            MORTAL VAULT · INSTRUCTIONS FOR MY BENEFICIARY
          </p>
          <h1
            id="heir-guide-heading"
            className="mt-3 font-serif text-[26px] leading-tight sm:text-[30px]"
          >
            {guide.heading}
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-[#1b1a17]/80">
            {guide.intro}
          </p>
        </header>

        <section className="mt-7">
          <h2 className="text-[11px] tracking-[0.16em] text-[#1b1a17]/55">
            THE DETAILS THAT MATTER
          </h2>
          <dl className="mt-4 flex flex-col gap-3.5">
            {guide.facts.map((fact) => (
              <div
                key={fact.label}
                className="border-l-2 border-[#1b1a17]/20 pl-4"
              >
                <dt className="text-[12.5px] uppercase tracking-wide text-[#1b1a17]/55">
                  {fact.label}
                </dt>
                <dd
                  className={`mt-0.5 break-all text-[15px] ${
                    fact.mono ? "font-mono text-[13.5px]" : ""
                  }`}
                >
                  {fact.value}
                </dd>
                {fact.note && (
                  <dd className="mt-1 text-[13px] leading-relaxed text-[#1b1a17]/65">
                    {fact.note}
                  </dd>
                )}
              </div>
            ))}
          </dl>
        </section>

        <section className="mt-7 rounded-lg bg-[#1b1a17]/[0.05] px-5 py-4">
          <h2 className="text-[11px] tracking-[0.16em] text-[#1b1a17]/55">
            THE EARLIEST THIS COULD HAPPEN
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed">
            A claim could be started no earlier than{" "}
            <strong>{guide.timing.earliestRequest}</strong>, and could be
            completed no earlier than{" "}
            <strong>{guide.timing.earliestExecution}</strong>.
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-[#1b1a17]/70">
            {guide.timing.caveat}
          </p>
        </section>

        <section className="mt-7">
          <h2 className="text-[11px] tracking-[0.16em] text-[#1b1a17]/55">
            WHAT TO DO, IN ORDER
          </h2>
          <ol className="mt-4 flex flex-col gap-4">
            {guide.steps.map((step, index) => (
              <li key={step.title} className="flex gap-4">
                <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full border border-[#1b1a17]/25 font-serif text-[13px]">
                  {index + 1}
                </span>
                <div>
                  <h3 className="text-[15px] font-semibold">{step.title}</h3>
                  <p className="mt-1 break-words text-[14px] leading-relaxed text-[#1b1a17]/80">
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-7 border border-[#8c2f1b]/35 bg-[#8c2f1b]/[0.06] px-5 py-4">
          <h2 className="text-[11px] tracking-[0.16em] text-[#8c2f1b]">
            READ THIS BEFORE YOU CLAIM ANYTHING
          </h2>
          <ul className="mt-3 flex flex-col gap-2.5">
            {guide.warnings.map((warning) => (
              <li
                key={warning}
                className="text-[13.5px] leading-relaxed text-[#1b1a17]/85"
              >
                {warning}
              </li>
            ))}
          </ul>
        </section>

        <footer className="mt-7 break-all border-t border-[#1b1a17]/15 pt-5 text-[12.5px] leading-relaxed text-[#1b1a17]/60">
          {guide.footer}
        </footer>
      </article>
    </div>,
    document.body,
  );
}

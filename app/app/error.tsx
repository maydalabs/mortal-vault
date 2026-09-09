"use client";

import { useEffect } from "react";

type AppErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

/**
 * The last thing between a rendering bug and an owner who cannot check in.
 *
 * A blank crash screen here is not cosmetic: the vault's clock keeps running
 * whether or not this page renders, so the one thing this surface owes the
 * owner is a way to reset that clock anyway.
 */
export default function AppError({ error, reset }: AppErrorProps) {
  useEffect(() => {
    console.error("Mortal Vault interface error:", error);
  }, [error]);

  return (
    <main
      className="relative z-10 flex min-h-screen items-center justify-center px-6 py-16 text-ink"
      role="alert"
    >
      <div className="flex w-full max-w-[560px] flex-col gap-5 rounded-[14px] border border-hairline bg-panel/80 p-8 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <span className="text-[11px] tracking-[0.16em] text-danger">
            INTERFACE ERROR
          </span>
          <span className="h-px flex-1 bg-hairline" aria-hidden="true" />
        </div>

        <h1 className="font-serif text-[28px] leading-tight">
          This page broke. Your vault did not.
        </h1>

        <p className="text-[15px] leading-relaxed text-muted">
          Everything that matters lives in the contract, not in this interface.
          Your funds have not moved, your plan is unchanged, and nothing here
          can act on its own. Only the display failed.
        </p>

        <p className="text-[15px] leading-relaxed text-muted">
          Your quiet period is still counting, though. If you came here to check
          in, do that first — it works without the rest of the page loading.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row">
          {/*
            A plain anchor, deliberately. next/link would navigate on the
            client, reusing the very JavaScript context that just threw; a hard
            load gives the check-in a clean one. Recovery beats routing here.
          */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/?action=checkin"
            className="inline-flex h-11 flex-1 items-center justify-center rounded-[9px] bg-safe px-5 text-sm font-semibold text-on-accent transition hover:brightness-110"
          >
            Check in now
          </a>
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-11 flex-1 items-center justify-center rounded-[9px] border border-hairline-strong px-5 text-sm text-ink-soft transition hover:bg-inset"
          >
            Try loading it again
          </button>
        </div>

        <p className="text-[13px] leading-relaxed text-faint">
          If this keeps happening, your vault is still reachable without this
          site: the contract can be called directly from any wallet or block
          explorer, which is the point of holding it this way.
          {error.digest && (
            <>
              {" "}
              Reference <span className="font-mono">{error.digest}</span>.
            </>
          )}
        </p>
      </div>
    </main>
  );
}

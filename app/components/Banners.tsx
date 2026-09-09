import type { ChainConfig } from "@/lib/mortal-vault";
import { getExplorerUrl } from "@/lib/mortal-vault";

export type PendingTransaction = {
  action: string;
  label: string;
  stage: "wallet" | "confirming";
  hash?: string;
  chain?: ChainConfig | null;
};

/**
 * Every failure in the app arrives here: no wallet, wrong network, a rejected
 * request, and every contract revert. The banner sits above the fold while the
 * buttons that cause those failures — check in, begin the claim, execute the
 * claim — sit well below it, so without an announcement a scrolled or
 * screen-reader user presses a button and perceives nothing at all.
 *
 * role="alert" carries an implicit aria-live="assertive", which is right here:
 * the user just acted and the action did not happen.
 */
export function ErrorBanner({ message }: { message: string }) {
  return (
    <section
      role="alert"
      className="mx-4 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-ink sm:mx-6 md:mx-10"
    >
      <div className="font-medium">Something didn&apos;t go through</div>
      <p className="mt-1 text-xs leading-5 text-ink-soft">{message}</p>
    </section>
  );
}

export function PendingBanner({ pending }: { pending: PendingTransaction }) {
  const explorer = pending.hash
    ? getExplorerUrl(pending.chain ?? null, "tx", pending.hash)
    : undefined;
  return (
    // Progress, not a failure: polite waits for a pause rather than cutting in,
    // and the stage changes under the same element so each step is announced.
    <section
      aria-live="polite"
      className="mx-4 rounded-xl border border-hairline bg-panel/85 px-4 py-3 text-sm text-ink backdrop-blur-sm sm:mx-6 md:mx-10"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-start gap-3">
          <span className="spin-slow mt-0.5 inline-block h-4 w-4 flex-shrink-0 rounded-full border-2 border-hairline-strong" style={{ borderTopColor: "var(--color-ink)" }} aria-hidden="true" />
          <div>
          <div className="font-medium">
            {pending.stage === "wallet"
              ? "Confirm in your wallet"
              : "Waiting for the chain"}
          </div>
          <p className="mt-1 text-xs leading-5 text-muted">
            {pending.stage === "wallet"
              ? pending.label
              : "Your transaction is submitted. The vault refreshes once it confirms."}
          </p>
          </div>
        </div>
        {explorer && (
          <a
            href={explorer}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-hairline px-3 py-2 text-xs text-ink-soft hover:bg-inset"
          >
            View transaction
          </a>
        )}
      </div>
    </section>
  );
}

/**
 * Shown when the visit came from a calendar reminder or a recovery link.
 *
 * The deep link used to fire the check-in itself, so arriving from a calendar
 * entry raised a wallet signature prompt nobody had asked for in that moment.
 * A product about custody should not teach people to approve prompts they did
 * not initiate, and a calendar can be shared. The convenience survives — the
 * action is one deliberate click away, and already primed.
 */
export function CheckInPromptBanner({
  onCheckIn,
  onDismiss,
  busy,
}: {
  onCheckIn: () => void;
  onDismiss: () => void;
  busy: boolean;
}) {
  return (
    <section
      className="mx-4 rounded-xl border border-safe/35 bg-safe/10 px-4 py-3.5 text-sm text-ink sm:mx-6 md:mx-10"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-medium">You came here to check in</div>
          <p className="mt-1 text-xs leading-5 text-ink-soft">
            One confirmation resets your quiet period.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCheckIn}
            disabled={busy}
            className="inline-flex h-10 items-center rounded-[9px] bg-safe px-5 text-[13px] font-semibold text-on-accent transition hover:brightness-110 disabled:opacity-40"
          >
            Check in now
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex h-10 items-center rounded-[9px] border border-hairline-strong px-4 text-[13px] text-ink-soft transition hover:bg-inset"
          >
            Not now
          </button>
        </div>
      </div>
    </section>
  );
}

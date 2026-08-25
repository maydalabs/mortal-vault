import type { ChainConfig } from "@/lib/mortal-vault";
import { getExplorerUrl } from "@/lib/mortal-vault";

export type PendingTransaction = {
  action: string;
  label: string;
  stage: "wallet" | "confirming";
  hash?: string;
  chain?: ChainConfig | null;
};

export function ErrorBanner({ message }: { message: string }) {
  return (
    <section className="mx-6 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-ink md:mx-10">
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
    <section className="mx-6 rounded-xl border border-hairline bg-panel px-4 py-3 text-sm text-ink md:mx-10">
      <div className="flex flex-wrap items-center justify-between gap-2">
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

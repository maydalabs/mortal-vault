import type { ChainConfig } from "@/lib/mortal-vault";
import { getExplorerUrl } from "@/lib/mortal-vault";
import { shortAddress } from "@/lib/ui";
import type { VaultActivity, VaultActivityQueryResult } from "@/lib/vault-events";
import { getVaultActivityLabel } from "@/lib/vault-events";
import type { VaultReminder } from "@/lib/vault-reminders";
import { TONE_HEX, toneTint } from "./tone";

export type ActivityScope = "owner" | "beneficiary" | "loaded-owner";

export type ReminderPreview =
  | { state: "incomplete" | "empty" | "error"; message: string }
  | {
      state: "ready";
      status: string;
      due: VaultReminder[];
      next: VaultReminder | null;
    };

const ACTIVITY_TITLES: Record<VaultActivity["eventName"], string> = {
  VaultCreated: "Vault created",
  Deposited: "Deposit",
  Heartbeat: "You checked in",
  VaultUpdated: "Plan updated",
  Withdrawn: "Withdrawal",
  ClaimRequested: "Claim requested",
  ClaimCancelled: "Claim cancelled",
  Claimed: "Claim executed",
  VaultClosed: "Vault closed",
};

const ICON_PATHS: Record<VaultActivity["eventName"], string> = {
  VaultCreated: "M12 3l7 3v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6l7-3z",
  Deposited: "M12 4v10 M8 10l4 4 4-4 M4 19h16",
  Heartbeat: "M3 12h4l2-6 4 12 2-6h6",
  VaultUpdated: "M4 20l4-1L19 8l-3-3L5 16l-1 4z",
  Withdrawn: "M12 18V8 M8 12l4-4 4 4 M4 19h16",
  ClaimRequested: "M5 21V4 M5 4h12l-2 4 2 4H5",
  ClaimCancelled: "M3 12h4l2-6 4 12 2-6h6",
  Claimed: "M5 21V4 M5 4h12l-2 4 2 4H5",
  VaultClosed: "M6 11V8a6 6 0 0 1 12 0v3 M5 11h14v9H5v-9z",
};

function eventTone(eventName: VaultActivity["eventName"]): "neutral" | "safe" | "danger" {
  if (eventName === "ClaimRequested" || eventName === "Claimed") return "danger";
  if (eventName === "ClaimCancelled") return "safe";
  return "neutral";
}

function EventIcon({ eventName }: { eventName: VaultActivity["eventName"] }) {
  const tone = eventTone(eventName);
  const color = TONE_HEX[tone];
  const background =
    tone === "neutral" ? "var(--color-inset)" : toneTint(tone, 0.09);
  return (
    <div
      className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-lg border border-hairline"
      style={{ background }}
      aria-hidden="true"
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {ICON_PATHS[eventName].split(" M").map((segment, index) => (
          <path key={index} d={index === 0 ? segment : `M${segment}`} />
        ))}
      </svg>
    </div>
  );
}

type ActivityCardProps = {
  selectionLabel: string | null;
  scope: ActivityScope;
  scopeOptions: ReadonlyArray<{ scope: ActivityScope; label: string; disabled: boolean }>;
  loading: boolean;
  error: string | null;
  result: VaultActivityQueryResult | null;
  chain: ChainConfig | null;
  reminderPreview: ReminderPreview | null;
  onScopeChange: (scope: ActivityScope) => void;
  onRefresh: () => void;
};

export function ActivityCard({
  selectionLabel,
  scope,
  scopeOptions,
  loading,
  error,
  result,
  chain,
  reminderPreview,
  onScopeChange,
  onRefresh,
}: ActivityCardProps) {
  return (
    <section className="flex flex-col gap-3.5 rounded-[14px] border border-hairline bg-panel p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] tracking-[0.13em] text-faint">RECENT ACTIVITY</div>
          <p className="mt-1 text-[11px] text-faint">
            {selectionLabel ?? "Connect a wallet to load history"}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={!selectionLabel || loading}
          className="inline-flex min-h-11 items-center text-[12px] text-faint transition hover:text-ink-soft disabled:opacity-40"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {scopeOptions.map((option) => (
          <button
            key={option.scope}
            type="button"
            onClick={() => onScopeChange(option.scope)}
            disabled={option.disabled}
            className={`rounded-full border px-3 py-1.5 text-[11px] transition disabled:opacity-30 ${
              scope === option.scope
                ? "border-hairline-strong bg-inset text-ink-soft"
                : "border-hairline text-faint hover:text-ink-soft"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {result?.partial && (
        <p className="rounded-lg border border-warn/25 bg-warn/10 px-3 py-2 text-[11px] leading-4 text-warn">
          Deployment block is not configured. Showing only the latest{" "}
          {result.toBlock - result.fromBlock + 1} blocks.
        </p>
      )}

      {error && (
        <p className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-[11px] leading-4 text-danger">
          {error}
        </p>
      )}

      {reminderPreview && (
        <div className="rounded-xl border border-hairline bg-inset p-3.5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] tracking-[0.14em] text-gold">REMINDERS</p>
            <span className="rounded-full border border-hairline px-2 py-0.5 text-[10px] text-faint">
              Delivery off
            </span>
          </div>
          {reminderPreview.state !== "ready" ? (
            <p className="mt-2 text-[11px] leading-4 text-faint">{reminderPreview.message}</p>
          ) : reminderPreview.due.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1.5">
              {reminderPreview.due.map((item) => (
                <li key={item.id} className="rounded-lg border border-warn/25 bg-warn/10 px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-medium text-warn">{item.title}</span>
                    <span className="uppercase tracking-wider text-faint">{item.audience}</span>
                  </div>
                  <p className="mt-1 text-[10px] leading-4 text-muted">{item.message}</p>
                </li>
              ))}
            </ul>
          ) : reminderPreview.next ? (
            <p className="mt-2 text-[11px] leading-4 text-faint">
              Next: {reminderPreview.next.title} for the {reminderPreview.next.audience} at{" "}
              {new Date(reminderPreview.next.deliverAt * 1000).toLocaleString()}.
            </p>
          ) : (
            <p className="mt-2 text-[11px] leading-4 text-faint">
              No reminders are scheduled for this closed-out vault.
            </p>
          )}
        </div>
      )}

      {!selectionLabel ? (
        <p className="text-xs leading-5 text-faint">
          Connect a wallet, or load an owner in the beneficiary workspace.
        </p>
      ) : loading && !result ? (
        <p className="text-xs leading-5 text-faint">Reading confirmed events...</p>
      ) : result?.items.length === 0 ? (
        <p className="text-xs leading-5 text-faint">
          No confirmed events found in blocks {result.fromBlock}-{result.toBlock}.
        </p>
      ) : result ? (
        <>
          <ol className="flex max-h-[420px] flex-col gap-3.5 overflow-y-auto pr-1">
            {result.items.slice(0, 50).map((item) => {
              const explorer = getExplorerUrl(chain, "tx", item.transactionHash);
              const tone = eventTone(item.eventName);
              return (
                <li key={item.id} className="flex items-start gap-3">
                  <EventIcon eventName={item.eventName} />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className="text-sm"
                        style={{ color: tone === "danger" ? TONE_HEX.danger : "var(--color-ink-soft)" }}
                      >
                        {ACTIVITY_TITLES[item.eventName]}
                      </span>
                      <span className="flex-shrink-0 text-[11px] text-faint">
                        {item.blockTimestamp === null
                          ? `block ${item.blockNumber}`
                          : new Date(item.blockTimestamp * 1000).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-[11.5px] leading-4 text-faint">
                      {getVaultActivityLabel(item)}
                    </div>
                    <div className="font-mono text-[10px] text-faint/80">
                      {shortAddress(item.owner)}
                      {item.beneficiary && <> / {shortAddress(item.beneficiary)}</>}
                      {explorer && (
                        <>
                          {" · "}
                          <a
                            href={explorer}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:text-muted"
                          >
                            explorer
                          </a>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="text-[10px] text-faint/80">
            {result.items.length} event{result.items.length === 1 ? "" : "s"} in blocks{" "}
            {result.fromBlock}-{result.toBlock}.
            {result.items.length > 50 ? " Showing newest 50." : ""}
          </p>
        </>
      ) : null}

      {scope === "beneficiary" && (
        <p className="text-[10px] leading-4 text-faint/80">
          The beneficiary view shows assignment and claim events. Load an owner
          for the complete lifecycle, including cancellations.
        </p>
      )}
    </section>
  );
}

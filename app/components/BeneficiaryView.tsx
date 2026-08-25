import { formatEther } from "ethers";

import type { ChainConfig, VaultView } from "@/lib/mortal-vault";
import { VAULT_STATUS, getChainConfig, getVaultStatusLabel } from "@/lib/mortal-vault";
import { formatRemaining, shortAddress } from "@/lib/ui";
import { TONE_HEX, type Tone } from "./tone";

type BeneficiaryViewProps = {
  account: string | null;
  chain: ChainConfig | null;
  nativeSymbol: string;
  claimChainId: number | null;
  claimOwner: string;
  claimLoaded: boolean;
  claimVault: VaultView | null;
  claimRecipient: string;
  timelineTone: Tone;
  timelineLabel: string;
  currentTimestamp: number;
  busy: boolean;
  loadBusy: boolean;
  onClaimOwnerChange: (value: string) => void;
  onLoad: () => void;
  onSwitchNetwork: (chainId: number) => void;
  onClaimRecipientChange: (value: string) => void;
  onRequestClaim: () => void;
  onExecuteClaim: () => void;
};

type StepState = "done" | "active" | "upcoming";

function StepMarker({ state, index }: { state: StepState; index: number }) {
  if (state === "done") {
    return (
      <div className="flex h-[30px] w-[30px] items-center justify-center rounded-full border border-safe/50 text-sm font-semibold text-safe">
        {index}
      </div>
    );
  }
  if (state === "active") {
    return (
      <div className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-warn text-sm font-semibold text-on-accent">
        {index}
      </div>
    );
  }
  return (
    <div className="flex h-[30px] w-[30px] items-center justify-center rounded-full border border-hairline-strong text-sm font-semibold text-muted">
      {index}
    </div>
  );
}

export function BeneficiaryView({
  account,
  chain,
  nativeSymbol,
  claimChainId,
  claimOwner,
  claimLoaded,
  claimVault,
  claimRecipient,
  timelineTone,
  timelineLabel,
  currentTimestamp,
  busy,
  loadBusy,
  onClaimOwnerChange,
  onLoad,
  onSwitchNetwork,
  onClaimRecipientChange,
  onRequestClaim,
  onExecuteClaim,
}: BeneficiaryViewProps) {
  const isBeneficiary =
    !!account &&
    !!claimVault &&
    account.toLowerCase() === claimVault.beneficiary.toLowerCase();

  const canRequest =
    claimVault?.status === VAULT_STATUS.active && claimVault.inactive;
  const claimRequested = claimVault?.status === VAULT_STATUS.claimRequested;
  const claimedAlready = claimVault?.status === VAULT_STATUS.claimed;

  const stepStates: [StepState, StepState, StepState] = claimedAlready
    ? ["done", "done", "done"]
    : claimRequested
      ? ["done", claimVault.claimable ? "done" : "active", claimVault.claimable ? "active" : "upcoming"]
      : ["active", "upcoming", "upcoming"];

  let headline = "Claim a vault shared with you.";
  let overline = "BENEFICIARY";
  let lede: React.ReactNode = (
    "If someone named you as their beneficiary, paste their address below — or open the link they shared with you, which fills everything in."
  );

  if (claimVault) {
    const quietFor = Math.max(0, currentTimestamp - Number(claimVault.lastHeartbeat));
    if (claimedAlready) {
      overline = "COMPLETE";
      headline = "This vault has been claimed.";
      lede = "The full balance has already been transferred. There is nothing left to do here.";
    } else if (claimVault.status === VAULT_STATUS.closed) {
      overline = "CLOSED";
      headline = "The owner closed this vault.";
      lede = "The owner took their funds back and ended the plan. Nothing can be claimed.";
    } else if (claimRequested) {
      overline = claimVault.claimable ? "READY" : "COUNTDOWN RUNNING";
      headline = claimVault.claimable
        ? "The vault is ready to pass to you."
        : "The countdown is running.";
      lede = claimVault.claimable ? (
        "The waiting period has passed without the owner checking in. You can now execute the claim."
      ) : (
        <>The claim was requested. If the owner is fine, one check-in from them cancels it — that protection is the point.</>
      );
    } else if (canRequest) {
      overline = "SOMEONE PLANNED FOR THIS MOMENT";
      headline = "You’ve been named a beneficiary.";
      lede = (
        <>
          The owner of this vault arranged for it to pass to you if they ever
          went quiet. They have now been inactive for{" "}
          <strong className="font-medium text-ink">{formatRemaining(quietFor)}</strong>.
          You can begin the claim whenever you&apos;re ready.
        </>
      );
    } else {
      overline = "ALL QUIET";
      headline = "The owner is still active.";
      lede = "Nothing to do here — and that is good news. The claim only opens if they stop checking in.";
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-5 px-6 pb-10 md:px-0">
      <div className="flex flex-col gap-3.5 pt-4">
        <div className="text-[11px] font-semibold tracking-[0.18em] text-gold">{overline}</div>
        <h1 className="font-serif text-4xl font-medium leading-[1.15] text-parchment">
          {headline}
        </h1>
        <div className="text-base leading-relaxed text-muted">{lede}</div>
      </div>

      {claimChainId && chain?.chainId !== claimChainId && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-warn/25 bg-warn/10 px-4 py-3 text-[13px] text-warn">
          <span>
            This link targets{" "}
            {getChainConfig(claimChainId)?.name ?? `chain ${claimChainId}`}.
          </span>
          <button
            type="button"
            onClick={() => onSwitchNetwork(claimChainId)}
            disabled={busy}
            className="h-10 flex-shrink-0 rounded-lg bg-warn px-4 text-xs font-semibold text-on-accent disabled:opacity-40"
          >
            Switch network
          </button>
        </div>
      )}

      <div className="flex h-12 rounded-[10px] border border-hairline bg-panel p-1">
        <input
          value={claimOwner}
          onChange={(event) => onClaimOwnerChange(event.target.value)}
          placeholder="Owner address 0x..."
          className="min-w-0 flex-1 bg-transparent px-3 font-mono text-[13px] text-ink outline-none"
        />
        <button
          type="button"
          onClick={onLoad}
          disabled={busy}
          className="rounded-lg bg-warn px-5 text-[13px] font-semibold text-on-accent transition hover:brightness-110 disabled:opacity-40"
        >
          {loadBusy ? "Loading..." : "Load"}
        </button>
      </div>

      {claimLoaded && !claimVault && (
        <p className="text-sm text-muted">No vault exists for that owner.</p>
      )}

      {claimVault && (
        <>
          <div className="flex flex-col rounded-[14px] border border-hairline bg-panel px-6 py-1">
            {(
              [
                ["Vault owner", <span key="o" className="font-mono text-[13px] text-ink-soft" title={claimVault.owner}>{shortAddress(claimVault.owner)}</span>],
                ["In the vault", <span key="b" className="text-sm text-ink">{formatEther(claimVault.balance)} {nativeSymbol}</span>],
                ["Owner last active", <span key="l" className="text-sm text-ink-soft">{new Date(Number(claimVault.lastHeartbeat) * 1000).toLocaleString()}</span>],
                [
                  "Status",
                  <span key="s" className="flex items-center gap-2 text-sm" style={{ color: TONE_HEX[timelineTone] }}>
                    <span className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: TONE_HEX[timelineTone] }} aria-hidden="true" />
                    {getVaultStatusLabel(claimVault.status)}
                  </span>,
                ],
              ] as const
            ).map(([label, value], index, rows) => (
              <div
                key={label}
                className={`flex items-center justify-between gap-3 py-3.5 ${
                  index < rows.length - 1 ? "border-b border-hairline/60" : ""
                }`}
              >
                <div className="text-[13.5px] text-faint">{label}</div>
                {value}
              </div>
            ))}
          </div>

          <p className="text-[13px] leading-relaxed" style={{ color: TONE_HEX[timelineTone] }}>
            {timelineLabel}
          </p>

          {!isBeneficiary && account && (
            <p className="rounded-xl border border-hairline bg-panel px-4 py-3 text-[13px] text-muted">
              Connect the beneficiary wallet {shortAddress(claimVault.beneficiary)} to continue.
            </p>
          )}

          {!claimedAlready && claimVault.status !== VAULT_STATUS.closed && (
            <div className="grid grid-cols-1 gap-4 py-2 sm:grid-cols-3">
              {(
                [
                  ["Request the claim", "One transaction, costing only gas. It starts a public countdown."],
                  ["A waiting period", "The owner can cancel at any time by checking in — that protection is the point."],
                  ["The vault passes to you", "The balance transfers to an address you choose."],
                ] as const
              ).map(([title, description], index) => (
                <div key={title} className="flex flex-col gap-2.5">
                  <StepMarker state={stepStates[index] ?? "upcoming"} index={index + 1} />
                  <div className="text-[14.5px] font-semibold text-ink">{title}</div>
                  <div className="text-[13px] leading-relaxed text-muted">{description}</div>
                </div>
              ))}
            </div>
          )}

          {canRequest && (
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={onRequestClaim}
                disabled={busy || !isBeneficiary}
                className="inline-flex h-[46px] items-center self-start rounded-[10px] bg-warn px-7 text-[15px] font-semibold text-on-accent transition hover:brightness-110 disabled:opacity-40"
              >
                Begin the claim
              </button>
              <p className="text-[13px] leading-relaxed text-faint">
                Nothing moves today. If the owner is fine, one check-in from them
                cancels everything — and no harm is done.
              </p>
            </div>
          )}

          {claimRequested && (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5 text-xs text-muted">
                <span>Payout recipient</span>
                <input
                  value={claimRecipient}
                  onChange={(event) => onClaimRecipientChange(event.target.value)}
                  placeholder={account ?? "Recipient address 0x..."}
                  className="h-12 rounded-[10px] border border-hairline bg-panel px-3 font-mono text-[13px] text-ink outline-none transition focus:border-hairline-strong"
                />
              </label>
              <p className="text-[12px] leading-relaxed text-faint">
                Defaults to your connected wallet. A smart-contract beneficiary
                may direct the payout to another address.
              </p>
              <button
                type="button"
                onClick={onExecuteClaim}
                disabled={busy || !isBeneficiary || !claimVault.claimable}
                className="inline-flex h-[46px] items-center self-start rounded-[10px] bg-danger px-7 text-[15px] font-semibold text-on-accent transition hover:brightness-110 disabled:opacity-40"
              >
                {claimVault.claimable ? "Execute the claim" : "Waiting period active"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

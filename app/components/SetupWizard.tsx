import { useState } from "react";
import { formatEther } from "ethers";
import { isAddress } from "ethers";

import { shortAddress } from "@/lib/ui";

type SetupWizardProps = {
  beneficiary: string;
  beneficiaryLabel: string;
  timeoutDays: string;
  claimDelayDays: string;
  initialDeposit: string;
  maxVaultBalance: bigint | null;
  nativeSymbol: string;
  saving: boolean;
  disabled: boolean;
  onBeneficiaryChange: (value: string) => void;
  onLabelChange: (value: string) => void;
  onTimeoutChange: (value: string) => void;
  onClaimDelayChange: (value: string) => void;
  onDepositChange: (value: string) => void;
  onCreate: () => void;
};

const TIMEOUT_PRESETS = ["30", "90", "180", "365"] as const;
const DELAY_PRESETS = ["7", "14", "30"] as const;

const inputClass =
  "h-12 rounded-lg border border-hairline bg-inset px-3.5 text-sm text-ink outline-none transition focus:border-hairline-strong";

function PresetChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-11 rounded-full border px-4 text-[13px] transition ${
        active
          ? "border-ink bg-ink text-on-accent"
          : "border-hairline-strong text-muted hover:border-ink hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

export function SetupWizard({
  beneficiary,
  beneficiaryLabel,
  timeoutDays,
  claimDelayDays,
  initialDeposit,
  maxVaultBalance,
  nativeSymbol,
  saving,
  disabled,
  onBeneficiaryChange,
  onLabelChange,
  onTimeoutChange,
  onClaimDelayChange,
  onDepositChange,
  onCreate,
}: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const displayName =
    beneficiaryLabel.trim() !== ""
      ? beneficiaryLabel.trim()
      : isAddress(beneficiary)
        ? shortAddress(beneficiary)
        : "your beneficiary";

  const stepValid =
    step === 0
      ? isAddress(beneficiary)
      : step === 1
        ? Number(timeoutDays) >= 1 && Number(claimDelayDays) >= 1
        : true;

  return (
    <div className="mt-3 flex w-full max-w-xl flex-col gap-6">
      <div className="flex items-center gap-4" aria-label={`Step ${step + 1} of 3`}>
        {["I", "II", "III"].map((numeral, index) => (
          <div key={numeral} className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => index < step && setStep(index)}
              className={`font-serif text-lg ${
                index === step
                  ? "text-ink"
                  : index < step
                    ? "cursor-pointer text-gold"
                    : "text-faint/70"
              }`}
            >
              {numeral}
            </button>
            {index < 2 && <div className="h-px w-10 bg-hairline-strong" />}
          </div>
        ))}
      </div>

      {step === 0 && (
        <div className="rise flex flex-col gap-4">
          <div className="font-serif text-[26px] italic text-ink">Who do you trust?</div>
          <label className="flex flex-col gap-1.5 text-xs text-muted">
            <span>Their wallet address</span>
            <input
              value={beneficiary}
              onChange={(event) => onBeneficiaryChange(event.target.value)}
              placeholder="0x..."
              className={`${inputClass} font-mono`}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-muted">
            <span>What do you call them? (stays on this device)</span>
            <input
              value={beneficiaryLabel}
              onChange={(event) => onLabelChange(event.target.value)}
              placeholder="e.g. Deniz"
              className={inputClass}
            />
          </label>
          <p className="text-[13px] leading-relaxed text-faint">
            This is the one person who can receive the vault — and only after
            you go quiet. You can change your mind at any time.
          </p>
        </div>
      )}

      {step === 1 && (
        <div className="rise flex flex-col gap-5">
          <div className="font-serif text-[26px] italic text-ink">
            How much quiet is too much?
          </div>
          <div className="flex flex-col gap-2.5">
            <div className="text-xs text-muted">
              If you don&apos;t check in for this long, {displayName} may begin a claim:
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {TIMEOUT_PRESETS.map((preset) => (
                <PresetChip
                  key={preset}
                  label={`${preset} days`}
                  active={timeoutDays === preset}
                  onClick={() => onTimeoutChange(preset)}
                />
              ))}
              <input
                value={timeoutDays}
                onChange={(event) => onTimeoutChange(event.target.value)}
                type="number"
                min="1"
                aria-label="Quiet period in days"
                className={`${inputClass} w-24`}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2.5">
            <div className="text-xs text-muted">
              …and their claim must then wait, giving you time to cancel it:
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {DELAY_PRESETS.map((preset) => (
                <PresetChip
                  key={preset}
                  label={`${preset} days`}
                  active={claimDelayDays === preset}
                  onClick={() => onClaimDelayChange(preset)}
                />
              ))}
              <input
                value={claimDelayDays}
                onChange={(event) => onClaimDelayChange(event.target.value)}
                type="number"
                min="1"
                aria-label="Claim countdown in days"
                className={`${inputClass} w-24`}
              />
            </div>
          </div>
          <p className="text-[13px] leading-relaxed text-faint">
            If you go quiet for {timeoutDays || "…"} days, {displayName} can begin
            a {claimDelayDays || "…"}-day claim countdown. Any check-in from you
            cancels it.
          </p>
        </div>
      )}

      {step === 2 && (
        <div className="rise flex flex-col gap-4">
          <div className="font-serif text-[26px] italic text-ink">Seal your vault.</div>
          <label className="flex flex-col gap-1.5 text-xs text-muted">
            <span>
              First deposit
              {maxVaultBalance !== null
                ? ` (up to ${formatEther(maxVaultBalance)} ${nativeSymbol})`
                : ""}
            </span>
            <input
              value={initialDeposit}
              onChange={(event) => onDepositChange(event.target.value)}
              className={`${inputClass} font-mono w-48`}
            />
          </label>
          <div className="rounded-xl border border-hairline bg-inset p-4 text-[14.5px] leading-relaxed text-ink-soft">
            {initialDeposit || "…"} {nativeSymbol} enters the vault today. If you
            ever stay quiet for{" "}
            <strong className="font-semibold">{timeoutDays} days</strong>,{" "}
            {displayName} may open a claim — and even then, the vault waits{" "}
            <strong className="font-semibold">{claimDelayDays} more days</strong>{" "}
            for you before anything moves.
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        {step > 0 && (
          <button
            type="button"
            onClick={() => setStep(step - 1)}
            className="inline-flex h-[46px] items-center rounded-[10px] border border-hairline-strong px-5 text-[15px] font-medium text-ink-soft hover:bg-inset"
          >
            Back
          </button>
        )}
        {step < 2 ? (
          <button
            type="button"
            onClick={() => setStep(step + 1)}
            disabled={!stepValid}
            className="inline-flex h-[46px] items-center rounded-[10px] bg-ink px-6 text-[15px] font-semibold text-on-accent transition hover:brightness-125 disabled:opacity-40"
          >
            Continue
          </button>
        ) : (
          <button
            type="button"
            onClick={onCreate}
            disabled={disabled}
            className="inline-flex h-[46px] items-center rounded-[10px] bg-safe px-6 text-[15px] font-semibold text-on-accent transition hover:brightness-110 disabled:opacity-40"
          >
            {saving ? "Sealing..." : "Seal the vault"}
          </button>
        )}
      </div>
    </div>
  );
}

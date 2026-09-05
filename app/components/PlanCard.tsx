import { DurationWarnings } from "@/components/DurationWarnings";
import { shortAddress } from "@/lib/ui";

type PlanCardProps = {
  beneficiary: string;
  beneficiaryLabel: string | null;
  vaultTimeoutDays: number;
  vaultClaimDelayDays: number;
  editing: boolean;
  formBeneficiary: string;
  formLabel: string;
  formTimeoutDays: string;
  formClaimDelayDays: string;
  saving: boolean;
  disabled: boolean;
  linkCopied: boolean;
  onToggleEdit: () => void;
  onFormBeneficiaryChange: (value: string) => void;
  onFormLabelChange: (value: string) => void;
  onFormTimeoutChange: (value: string) => void;
  onFormClaimDelayChange: (value: string) => void;
  onSave: () => void;
  onCopyLink: () => void;
  onPreview: () => void;
  onCloseVault: () => void;
};

function formatDays(days: number): string {
  const rounded = Math.round(days * 10) / 10;
  return `${rounded} day${rounded === 1 ? "" : "s"}`;
}

export function PlanCard({
  beneficiary,
  beneficiaryLabel,
  vaultTimeoutDays,
  vaultClaimDelayDays,
  editing,
  formBeneficiary,
  formLabel,
  formTimeoutDays,
  formClaimDelayDays,
  saving,
  disabled,
  linkCopied,
  onToggleEdit,
  onFormBeneficiaryChange,
  onFormLabelChange,
  onFormTimeoutChange,
  onFormClaimDelayChange,
  onSave,
  onCopyLink,
  onPreview,
  onCloseVault,
}: PlanCardProps) {
  const displayName = beneficiaryLabel ?? shortAddress(beneficiary);
  const initial = (beneficiaryLabel ?? beneficiary.replace(/^0x/, "")).charAt(0).toUpperCase();

  return (
    <section className="flex flex-col gap-3.5 rounded-[14px] border border-hairline bg-panel/80 p-6 backdrop-blur-sm">
      <div className="flex items-center gap-3"><span className="text-[11px] tracking-[0.13em] text-faint">YOUR PLAN</span><span className="h-px flex-1 bg-hairline" aria-hidden="true" /></div>
      <p className="text-[15px] leading-relaxed text-muted">
        If you go quiet for{" "}
        <strong className="font-medium text-ink">{formatDays(vaultTimeoutDays)}</strong>,{" "}
        {displayName} can begin a{" "}
        <strong className="font-medium text-ink">
          {Math.round(vaultClaimDelayDays * 10) / 10}-day
        </strong>{" "}
        claim countdown.
      </p>
      <DurationWarnings
        inactivityDays={editing ? formTimeoutDays : vaultTimeoutDays}
        claimDelayDays={editing ? formClaimDelayDays : vaultClaimDelayDays}
      />
      <div className="h-px bg-hairline" />
      <div className="flex items-center gap-3">
        <div className="flex h-[30px] w-[30px] items-center justify-center rounded-full border border-hairline-strong bg-inset font-serif text-[15px] text-gold">
          {initial}
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="truncate text-sm text-ink">{displayName}</div>
          <div className="font-mono text-[11.5px] text-faint" title={beneficiary}>
            {shortAddress(beneficiary)}
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleEdit}
          className="ml-auto inline-flex min-h-11 items-center text-[13px] text-gold hover:text-gold-bright"
        >
          {editing ? "Hide editor" : "Edit plan"}
        </button>
      </div>

      <button
        type="button"
        onClick={onCopyLink}
        className="inline-flex h-11 items-center justify-center rounded-[9px] border border-hairline-strong text-[13px] font-medium text-ink-soft transition hover:bg-inset"
      >
        {linkCopied ? "Claim link copied" : "Copy the beneficiary claim link"}
      </button>
      <button
        type="button"
        onClick={onPreview}
        className="inline-flex min-h-11 items-center justify-center text-[13px] text-gold transition hover:text-gold-bright"
      >
        See what {displayName} will see
      </button>

      {editing && (
        <div className="flex flex-col gap-3 rounded-xl border border-hairline bg-inset p-4">
          <label className="flex flex-col gap-1.5 text-xs text-muted">
            <span>Beneficiary address</span>
            <input
              value={formBeneficiary}
              onChange={(event) => onFormBeneficiaryChange(event.target.value)}
              placeholder="0x..."
              className="h-11 rounded-lg border border-hairline bg-panel px-3 font-mono text-xs text-ink outline-none transition focus:border-hairline-strong"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-muted">
            <span>Nickname — stays on this device only</span>
            <input
              value={formLabel}
              onChange={(event) => onFormLabelChange(event.target.value)}
              placeholder="e.g. Deniz"
              className="h-11 rounded-lg border border-hairline bg-panel px-3 text-xs text-ink outline-none transition focus:border-hairline-strong"
            />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-xs text-muted">
              <span>Quiet period (days)</span>
              <input
                type="number"
                min="1"
                value={formTimeoutDays}
                onChange={(event) => onFormTimeoutChange(event.target.value)}
                className="h-11 rounded-lg border border-hairline bg-panel px-3 text-xs text-ink outline-none transition focus:border-hairline-strong"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-muted">
              <span>Claim countdown (days)</span>
              <input
                type="number"
                min="1"
                value={formClaimDelayDays}
                onChange={(event) => onFormClaimDelayChange(event.target.value)}
                className="h-11 rounded-lg border border-hairline bg-panel px-3 text-xs text-ink outline-none transition focus:border-hairline-strong"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={onSave}
            disabled={disabled}
            className="inline-flex h-11 items-center justify-center rounded-[9px] bg-safe text-sm font-semibold text-on-accent transition hover:brightness-110 disabled:opacity-40"
          >
            {saving ? "Waiting for confirmation..." : "Update plan"}
          </button>
          <button
            type="button"
            onClick={onCloseVault}
            disabled={disabled}
            className="inline-flex min-h-11 items-center justify-center text-[13px] text-danger/80 transition hover:text-danger disabled:opacity-40"
          >
            Close the vault and take everything back
          </button>
        </div>
      )}
    </section>
  );
}

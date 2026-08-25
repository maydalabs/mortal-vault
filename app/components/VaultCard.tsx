import { formatEther } from "ethers";

type VaultCardProps = {
  balance: bigint;
  maxVaultBalance: bigint | null;
  nativeSymbol: string;
  depositAmount: string;
  withdrawAmount: string;
  disabled: boolean;
  onDepositAmountChange: (value: string) => void;
  onWithdrawAmountChange: (value: string) => void;
  onDeposit: () => void;
  onWithdraw: () => void;
};

export function VaultCard({
  balance,
  maxVaultBalance,
  nativeSymbol,
  depositAmount,
  withdrawAmount,
  disabled,
  onDepositAmountChange,
  onWithdrawAmountChange,
  onDeposit,
  onWithdraw,
}: VaultCardProps) {
  return (
    <section className="flex flex-col gap-3.5 rounded-[14px] border border-hairline bg-panel p-6">
      <div className="flex items-center gap-3"><span className="text-[11px] tracking-[0.13em] text-faint">IN THE VAULT</span><span className="h-px flex-1 bg-hairline" aria-hidden="true" /></div>
      <div className="flex items-baseline gap-2">
        <div className="font-serif text-[42px] leading-none text-ink">
          {formatEther(balance)}
        </div>
        <div className="text-[15px] text-muted">{nativeSymbol}</div>
      </div>
      {maxVaultBalance !== null && (
        <div className="text-[13px] text-faint">
          vault cap {formatEther(maxVaultBalance)} {nativeSymbol}
        </div>
      )}
      <div className="h-px bg-hairline" />
      <div className="flex flex-col gap-2.5">
        <div className="flex h-11 rounded-[9px] border border-hairline bg-inset p-1">
          <input
            value={depositAmount}
            onChange={(event) => onDepositAmountChange(event.target.value)}
            aria-label="Deposit amount"
            className="min-w-0 flex-1 bg-transparent px-2.5 font-mono text-xs text-ink outline-none"
          />
          <button
            type="button"
            disabled={disabled}
            onClick={onDeposit}
            className="rounded-md border border-hairline-strong px-4 text-xs font-medium text-ink-soft transition hover:bg-panel disabled:opacity-40"
          >
            Deposit
          </button>
        </div>
        <div className="flex h-11 rounded-[9px] border border-hairline bg-inset p-1">
          <input
            value={withdrawAmount}
            onChange={(event) => onWithdrawAmountChange(event.target.value)}
            aria-label="Withdrawal amount"
            className="min-w-0 flex-1 bg-transparent px-2.5 font-mono text-xs text-ink outline-none"
          />
          <button
            type="button"
            disabled={disabled}
            onClick={onWithdraw}
            className="rounded-md border border-hairline-strong px-4 text-xs font-medium text-ink-soft transition hover:bg-panel disabled:opacity-40"
          >
            Withdraw
          </button>
        </div>
      </div>
    </section>
  );
}

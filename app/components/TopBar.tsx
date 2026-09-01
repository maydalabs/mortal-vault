import type { ChainConfig } from "@/lib/mortal-vault";
import { shortAddress } from "@/lib/ui";

type Workspace = "owner" | "beneficiary";

type TopBarProps = {
  chains: readonly ChainConfig[];
  currentChainId: number | null;
  switchingChainId: number | null;
  busy: boolean;
  account: string | null;
  walletBalance: string | null;
  nativeSymbol: string;
  workspace: Workspace;
  showWorkspaceToggle: boolean;
  onSwitchChain: (chainId: number) => void;
  onConnect: () => void;
  onWorkspaceChange: (workspace: Workspace) => void;
};

export function TopBar({
  chains,
  currentChainId,
  switchingChainId,
  busy,
  account,
  walletBalance,
  nativeSymbol,
  workspace,
  showWorkspaceToggle,
  onSwitchChain,
  onConnect,
  onWorkspaceChange,
}: TopBarProps) {
  // Local dev chains (Hardhat/localhost) read as "unfinished" on the public page —
  // show them only outside production.
  const visibleChains = chains.filter(
    (chain) =>
      process.env.NODE_ENV !== "production" || !/localhost|hardhat/i.test(chain.name),
  );

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6 md:gap-4 md:px-10 md:py-5">
      <div className="flex items-center gap-3">
        <div className="font-serif text-[15px] font-medium uppercase tracking-[0.22em] text-parchment">
          Mortal Vault
        </div>
        <div className="rounded-full border border-hairline-strong px-2.5 py-1 text-[10px] tracking-[0.16em] text-muted">
          BETA
        </div>
        {showWorkspaceToggle && (
          <div className="ml-2 flex rounded-full border border-hairline bg-panel p-1">
            {(
              [
                ["owner", "My vault"],
                ["beneficiary", "Beneficiary"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => onWorkspaceChange(value)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
                  workspace === value
                    ? "bg-inset text-ink"
                    : "text-faint hover:text-ink-soft"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {visibleChains.map((chain) => {
            const active = chain.chainId === currentChainId;
            return (
              <button
                key={chain.chainId}
                type="button"
                onClick={() => onSwitchChain(chain.chainId)}
                disabled={busy}
                className={`items-center gap-2 rounded-full border px-3.5 py-2 text-xs transition disabled:opacity-40 ${
                  active
                    ? "flex border-hairline-strong bg-panel text-ink-soft"
                    : "hidden border-transparent text-faint hover:border-hairline hover:text-ink-soft md:flex"
                }`}
              >
                {active && (
                  <span className="h-[7px] w-[7px] rounded-full bg-safe" aria-hidden="true" />
                )}
                {switchingChainId === chain.chainId ? "Switching..." : chain.name}
              </button>
            );
          })}
        </div>

        {account ? (
          <div className="rounded-full border border-hairline bg-panel px-4 py-2 font-mono text-[12.5px] text-ink-soft">
            {walletBalance ? `${walletBalance} ${nativeSymbol} · ` : ""}
            {shortAddress(account)}
          </div>
        ) : (
          <button
            type="button"
            onClick={onConnect}
            disabled={busy}
            className="rounded-[10px] bg-safe px-5 py-2.5 text-sm font-semibold text-on-accent transition hover:brightness-110 disabled:opacity-50"
          >
            Connect wallet
          </button>
        )}
      </div>
    </header>
  );
}

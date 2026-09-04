import { formatEther } from "ethers";

import type { ChainConfig } from "@/lib/mortal-vault";
import { getExplorerUrl } from "@/lib/mortal-vault";
import { shortAddress } from "@/lib/ui";

type FooterProps = {
  chain: ChainConfig | null;
  contractAddress: string | null;
  maxVaultBalance: bigint | null;
  nativeSymbol: string;
};

export function Footer({ chain, contractAddress, maxVaultBalance, nativeSymbol }: FooterProps) {
  const explorer = contractAddress
    ? getExplorerUrl(chain, "address", contractAddress)
    : undefined;

  return (
    <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 px-4 py-5 font-mono text-[11px] text-faint sm:px-6 md:px-10 md:text-[11.5px]" style={{ borderTop: "3px double var(--color-hairline-strong)" }}>
      <div>
        Unaudited beta — keep only test funds here. This is a technical
        continuity tool, not a legal will.
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {maxVaultBalance !== null && (
          <span>
            Vault cap {formatEther(maxVaultBalance)} {nativeSymbol}
          </span>
        )}
        {contractAddress &&
          (explorer ? (
            <a href={explorer} target="_blank" rel="noreferrer" className="hover:text-muted">
              Contract {shortAddress(contractAddress)}
            </a>
          ) : (
            <span>Contract {shortAddress(contractAddress)}</span>
          ))}
      </div>
    </footer>
  );
}

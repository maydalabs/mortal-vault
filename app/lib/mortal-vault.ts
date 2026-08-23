import { formatEther, getAddress, Interface, type Result } from "ethers";

export const VAULT_STATUS = {
  none: 0,
  active: 1,
  claimRequested: 2,
  claimed: 3,
  closed: 4,
} as const;

export type VaultStatus = (typeof VAULT_STATUS)[keyof typeof VAULT_STATUS];

export type VaultView = {
  owner: string;
  beneficiary: string;
  timeout: bigint;
  claimDelay: bigint;
  lastHeartbeat: bigint;
  claimRequestedAt: bigint;
  balance: bigint;
  status: VaultStatus;
  inactive: boolean;
  claimable: boolean;
};

export type ChainConfig = {
  chainId: number;
  name: string;
  contractAddress?: string;
  explorerUrl?: string;
  walletAdd?: {
    nativeCurrency: {
      name: string;
      symbol: string;
      decimals: 18;
    };
    rpcUrls: string[];
  };
  testnet: boolean;
};

export type WalletAddChainParams = {
  chainId: string;
  chainName: string;
  nativeCurrency: ChainConfig["walletAdd"] extends infer WalletAdd
    ? WalletAdd extends { nativeCurrency: infer NativeCurrency }
      ? NativeCurrency
      : never
    : never;
  rpcUrls: string[];
  blockExplorerUrls?: string[];
};

export const MORTAL_VAULT_ABI = [
  "function createVault(address beneficiary, uint64 timeout, uint64 claimDelay) payable",
  "function deposit() payable",
  "function heartbeat()",
  "function updateVault(address beneficiary, uint64 timeout, uint64 claimDelay)",
  "function withdraw(uint256 amount)",
  "function closeVault()",
  "function requestClaim(address owner)",
  "function executeClaim(address owner)",
  "function executeClaimTo(address owner, address recipient)",
  "function MAX_VAULT_BALANCE() view returns (uint256)",
  "function getVault(address owner) view returns (address vaultOwner,address beneficiary,uint256 timeout,uint256 claimDelay,uint256 lastHeartbeat,uint256 claimRequestedAt,uint256 balance,uint8 status,bool inactive,bool claimable)",
  "error InvalidBeneficiary()",
  "error BeneficiaryIsOwner()",
  "error InvalidTimeout()",
  "error InvalidClaimDelay()",
  "error InvalidMaxVaultBalance()",
  "error MustDeposit()",
  "error VaultBalanceLimitExceeded()",
  "error VaultAlreadyActive()",
  "error NoVault()",
  "error VaultNotMutable()",
  "error NoEthSent()",
  "error AmountMustBePositive()",
  "error InsufficientBalance()",
  "error NotBeneficiary()",
  "error OwnerStillActive()",
  "error EmptyVault()",
  "error ClaimNotRequested()",
  "error ClaimDelayActive()",
  "error InvalidRecipient()",
  "error TransferFailed()",
  "error ReentrancyGuardReentrantCall()",
] as const;

const CHAINS: Record<number, ChainConfig> = {
  31337: {
    chainId: 31337,
    name: "Hardhat localhost",
    contractAddress:
      process.env.NEXT_PUBLIC_MORTAL_VAULT_ADDRESS_LOCAL ??
      "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    walletAdd: {
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: ["http://127.0.0.1:8545"],
    },
    testnet: true,
  },
  11155111: {
    chainId: 11155111,
    name: "Ethereum Sepolia",
    contractAddress: process.env.NEXT_PUBLIC_MORTAL_VAULT_ADDRESS_SEPOLIA,
    explorerUrl: "https://sepolia.etherscan.io",
    testnet: true,
  },
  84532: {
    chainId: 84532,
    name: "Base Sepolia",
    contractAddress: process.env.NEXT_PUBLIC_MORTAL_VAULT_ADDRESS_BASE_SEPOLIA,
    explorerUrl: "https://sepolia-explorer.base.org",
    walletAdd: {
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: ["https://sepolia.base.org"],
    },
    testnet: true,
  },
  97: {
    chainId: 97,
    name: "BNB Smart Chain Testnet",
    contractAddress: process.env.NEXT_PUBLIC_MORTAL_VAULT_ADDRESS_BSC_TESTNET,
    explorerUrl: "https://testnet.bscscan.com",
    walletAdd: {
      nativeCurrency: { name: "Test BNB", symbol: "tBNB", decimals: 18 },
      rpcUrls: ["https://bsc-testnet-dataseed.bnbchain.org"],
    },
    testnet: true,
  },
};

export const SUPPORTED_CHAINS = Object.freeze([
  CHAINS[31337],
  CHAINS[11155111],
  CHAINS[84532],
  CHAINS[97],
]);

const CONTRACT_ERROR_MESSAGES: Record<string, string> = {
  InvalidBeneficiary: "Choose a non-zero beneficiary address.",
  BeneficiaryIsOwner: "The beneficiary must be different from the owner.",
  InvalidTimeout: "The inactivity timeout must be between 1 day and 5 years.",
  InvalidClaimDelay: "The challenge period must be between 1 and 180 days.",
  InvalidMaxVaultBalance: "This deployment has an invalid vault balance limit.",
  MustDeposit: "An initial deposit is required to create a vault.",
  VaultBalanceLimitExceeded: "This deposit exceeds the deployment's per-vault balance limit.",
  VaultAlreadyActive: "This owner already has an active or pending vault.",
  NoVault: "No vault exists for this owner.",
  VaultNotMutable: "This vault can no longer be changed in its current state.",
  NoEthSent: "Enter a deposit amount greater than zero.",
  AmountMustBePositive: "Enter an amount greater than zero.",
  InsufficientBalance: "The vault does not contain enough funds.",
  NotBeneficiary: "Only the configured beneficiary can perform this claim action.",
  OwnerStillActive: "The owner inactivity deadline has not passed.",
  EmptyVault: "An empty vault cannot be claimed.",
  ClaimNotRequested: "No beneficiary claim is currently pending.",
  ClaimDelayActive: "The claim challenge period is still active.",
  InvalidRecipient: "Enter a valid non-zero payout recipient.",
  TransferFailed: "The recipient rejected the native-asset transfer.",
  ReentrancyGuardReentrantCall: "The contract blocked a reentrant callback.",
};

const vaultInterface = new Interface(MORTAL_VAULT_ABI);

export function getChainConfig(chainId: number): ChainConfig | undefined {
  return CHAINS[chainId];
}

export function toHexChainId(chainId: number): string {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("Chain ID must be a positive safe integer.");
  }
  return `0x${chainId.toString(16)}`;
}

export function getWalletAddChainParams(
  chainId: number,
): WalletAddChainParams | undefined {
  const chain = getChainConfig(chainId);
  if (!chain?.walletAdd) return undefined;

  return {
    chainId: toHexChainId(chain.chainId),
    chainName: chain.name,
    nativeCurrency: chain.walletAdd.nativeCurrency,
    rpcUrls: chain.walletAdd.rpcUrls,
    ...(chain.explorerUrl
      ? { blockExplorerUrls: [chain.explorerUrl] }
      : {}),
  };
}

export function getExplorerUrl(
  chain: ChainConfig | null | undefined,
  type: "address" | "tx",
  value: string,
): string | undefined {
  if (!chain?.explorerUrl) return undefined;
  return `${chain.explorerUrl}/${type}/${value}`;
}

export function requireContractAddress(chainId: number): string {
  const chain = getChainConfig(chainId);
  if (!chain) {
    throw new Error(
      `Unsupported network (chainId ${chainId}). Use Hardhat, Ethereum Sepolia, Base Sepolia, or BSC Testnet.`,
    );
  }
  if (!chain.contractAddress) {
    throw new Error(`${chain.name} is supported but has no configured deployment.`);
  }
  return getAddress(chain.contractAddress);
}

function findRevertData(error: unknown, seen = new WeakSet<object>()): string | null {
  if (!error || typeof error !== "object" || seen.has(error)) return null;
  seen.add(error);

  const record = error as Record<string, unknown>;
  if (typeof record.data === "string" && record.data.startsWith("0x")) {
    return record.data;
  }

  for (const key of ["data", "error", "info", "cause"]) {
    const nested = findRevertData(record[key], seen);
    if (nested) return nested;
  }
  return null;
}

export function getErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const candidate = error as {
      code?: number | string;
      message?: unknown;
      shortMessage?: unknown;
      reason?: unknown;
    };

    if (candidate.code === -32002) {
      return "A wallet request is already pending. Open your wallet to approve or reject it.";
    }
    if (candidate.code === 4001 || candidate.code === "ACTION_REJECTED") {
      return "You rejected the request in your wallet.";
    }
    if (candidate.code === "INSUFFICIENT_FUNDS") {
      return "The connected wallet does not have enough native currency for this transaction and gas.";
    }

    const revertData = findRevertData(error);
    if (revertData) {
      try {
        const parsed = vaultInterface.parseError(revertData);
        if (parsed && CONTRACT_ERROR_MESSAGES[parsed.name]) {
          return CONTRACT_ERROR_MESSAGES[parsed.name];
        }
      } catch {
        // Fall through to the wallet's human-readable message.
      }
    }

    const message = [
      candidate.shortMessage,
      candidate.reason,
      candidate.message,
    ].find((value): value is string => typeof value === "string");

    if (message?.toLowerCase().includes("user rejected")) {
      return "You rejected the request in your wallet.";
    }
    if (message) return message.length > 180 ? `${message.slice(0, 177)}...` : message;
  }

  if (typeof error === "string") return error;
  return "Unexpected wallet or contract error.";
}

export function parseVaultResult(result: Result): VaultView | null {
  const status = Number(result[7]) as VaultStatus;
  if (status === VAULT_STATUS.none) return null;

  return {
    owner: result[0] as string,
    beneficiary: result[1] as string,
    timeout: result[2] as bigint,
    claimDelay: result[3] as bigint,
    lastHeartbeat: result[4] as bigint,
    claimRequestedAt: result[5] as bigint,
    balance: result[6] as bigint,
    status,
    inactive: result[8] as boolean,
    claimable: result[9] as boolean,
  };
}

export function getVaultStatusLabel(status: VaultStatus): string {
  switch (status) {
    case VAULT_STATUS.active:
      return "Active";
    case VAULT_STATUS.claimRequested:
      return "Claim requested";
    case VAULT_STATUS.claimed:
      return "Claimed";
    case VAULT_STATUS.closed:
      return "Closed";
    default:
      return "None";
  }
}

export function assertVaultBalanceWithinLimit(
  currentBalance: bigint,
  deposit: bigint,
  maximumBalance: bigint,
): void {
  if (
    currentBalance < BigInt(0) ||
    deposit < BigInt(0) ||
    maximumBalance <= BigInt(0)
  ) {
    throw new Error("Vault balance limit inputs are invalid.");
  }

  const remaining =
    currentBalance < maximumBalance
      ? maximumBalance - currentBalance
      : BigInt(0);
  if (deposit > remaining) {
    throw new Error(
      `This deployment caps each vault at ${formatEther(maximumBalance)} native tokens. Remaining capacity: ${formatEther(remaining)}.`,
    );
  }
}

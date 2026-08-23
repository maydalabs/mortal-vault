import { getAddress, type Result } from "ethers";

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
  testnet: boolean;
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
  "function getVault(address owner) view returns (address vaultOwner,address beneficiary,uint256 timeout,uint256 claimDelay,uint256 lastHeartbeat,uint256 claimRequestedAt,uint256 balance,uint8 status,bool inactive,bool claimable)",
] as const;

const CHAINS: Record<number, ChainConfig> = {
  31337: {
    chainId: 31337,
    name: "Hardhat localhost",
    contractAddress:
      process.env.NEXT_PUBLIC_MORTAL_VAULT_ADDRESS_LOCAL ??
      "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    testnet: true,
  },
  11155111: {
    chainId: 11155111,
    name: "Ethereum Sepolia",
    contractAddress: process.env.NEXT_PUBLIC_MORTAL_VAULT_ADDRESS_SEPOLIA,
    testnet: true,
  },
  84532: {
    chainId: 84532,
    name: "Base Sepolia",
    contractAddress: process.env.NEXT_PUBLIC_MORTAL_VAULT_ADDRESS_BASE_SEPOLIA,
    testnet: true,
  },
  97: {
    chainId: 97,
    name: "BNB Smart Chain Testnet",
    contractAddress: process.env.NEXT_PUBLIC_MORTAL_VAULT_ADDRESS_BSC_TESTNET,
    testnet: true,
  },
};

export function getChainConfig(chainId: number): ChainConfig | undefined {
  return CHAINS[chainId];
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

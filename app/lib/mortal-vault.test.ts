import { describe, expect, it } from "vitest";
import { Interface } from "ethers";
import {
  MORTAL_VAULT_ABI,
  SUPPORTED_CHAINS,
  getChainConfig,
  getErrorMessage,
  getExplorerUrl,
  getWalletAddChainParams,
  requireContractAddress,
  toHexChainId,
} from "./mortal-vault";

describe("chain configuration", () => {
  it("exposes every supported MVP chain", () => {
    expect(SUPPORTED_CHAINS.map((chain) => chain.chainId)).toEqual([
      31337, 11155111, 84532, 97,
    ]);
    expect(requireContractAddress(31337)).toBe(
      "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    );
  });

  it("builds wallet-add and explorer parameters", () => {
    expect(toHexChainId(84532)).toBe("0x14a34");
    expect(getWalletAddChainParams(84532)).toMatchObject({
      chainId: "0x14a34",
      chainName: "Base Sepolia",
      rpcUrls: ["https://sepolia.base.org"],
    });
    expect(
      getExplorerUrl(getChainConfig(84532), "tx", "0xabc"),
    ).toBe("https://sepolia-explorer.base.org/tx/0xabc");
    expect(getWalletAddChainParams(11155111)).toBeUndefined();
  });

  it("rejects invalid chain IDs", () => {
    expect(() => toHexChainId(0)).toThrow("positive safe integer");
  });
});

describe("wallet and contract errors", () => {
  it("decodes MortalVault custom errors from nested provider data", () => {
    const contractInterface = new Interface(MORTAL_VAULT_ABI);
    const data = contractInterface.encodeErrorResult("NotBeneficiary");

    expect(getErrorMessage({ info: { error: { data } } })).toBe(
      "Only the configured beneficiary can perform this claim action.",
    );
  });

  it("normalizes common wallet errors", () => {
    expect(getErrorMessage({ code: 4001 })).toBe(
      "You rejected the request in your wallet.",
    );
    expect(getErrorMessage({ code: -32002 })).toContain("already pending");
    expect(getErrorMessage({ code: "INSUFFICIENT_FUNDS" })).toContain(
      "enough native currency",
    );
  });
});

import { expect } from "chai";
// We’ll use Hardhat’s ethers later when we implement these tests for real.
// import { ethers } from "hardhat";

describe("MortalVault – lifecycle", () => {
  it("S1 – owner can keep the vault alive with heartbeats", async () => {
    // TODO: implement based on docs/test-scenarios.md (S1)
  });

  it("S2 – beneficiary can claim after expiry when owner disappears", async () => {
    // TODO: implement based on S2
  });

  it("S3 – non-owner cannot modify someone else's vault", async () => {
    // TODO: implement based on S3
  });

  it("S4 – beneficiary cannot claim before expiry", async () => {
    // TODO: implement based on S5
  });

  it("S5 – behaviour after claim/close is well-defined", async () => {
    // TODO: implement based on S8/S7
  });
});

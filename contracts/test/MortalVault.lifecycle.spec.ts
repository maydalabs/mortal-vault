import { expect } from "chai";
import { network } from "hardhat";

const { ethers, provider } = await network.create();

const DAY = 24 * 60 * 60;
const TIMEOUT = 30 * DAY;
const CLAIM_DELAY = 7 * DAY;
const DEPOSIT = ethers.parseEther("1");
const MAX_VAULT_BALANCE = ethers.parseEther("100");

async function deployActiveVault() {
  const [owner, beneficiary, other] = await ethers.getSigners();
  const vault = await ethers.deployContract("MortalVault", [MAX_VAULT_BALANCE]);
  await vault.waitForDeployment();
  await vault
    .connect(owner)
    .createVault(beneficiary.address, TIMEOUT, CLAIM_DELAY, { value: DEPOSIT });
  return { vault, owner, beneficiary, other };
}

async function increaseTime(seconds: number) {
  await provider.send("evm_increaseTime", [seconds]);
  await provider.send("evm_mine", []);
}

async function requestExpiredClaim(
  vault: Awaited<ReturnType<typeof ethers.deployContract>>,
  owner: Awaited<ReturnType<typeof ethers.getSigners>>[number],
  beneficiary: Awaited<ReturnType<typeof ethers.getSigners>>[number],
) {
  await increaseTime(TIMEOUT + 1);
  await vault.connect(beneficiary).requestClaim(owner.address);
}

describe("MortalVault claim lifecycle", function () {
  it("does not permit a claim request before owner inactivity", async function () {
    const { vault, owner, beneficiary } = await deployActiveVault();

    await expect(
      vault.connect(beneficiary).requestClaim(owner.address),
    ).to.be.revertedWithCustomError(vault, "OwnerStillActive");
  });

  it("allows only the configured beneficiary to request a claim", async function () {
    const { vault, owner, other } = await deployActiveVault();
    await increaseTime(TIMEOUT + 1);

    await expect(
      vault.connect(other).requestClaim(owner.address),
    ).to.be.revertedWithCustomError(vault, "NotBeneficiary");
  });

  it("starts a challenge period after owner inactivity", async function () {
    const { vault, owner, beneficiary } = await deployActiveVault();
    await increaseTime(TIMEOUT + 1);

    await expect(vault.connect(beneficiary).requestClaim(owner.address)).to.emit(
      vault,
      "ClaimRequested",
    );

    const [, , , , , requestedAt, balance, status, inactive, claimable] =
      await vault.getVault(owner.address);
    expect(requestedAt).to.be.greaterThan(0n);
    expect(balance).to.equal(DEPOSIT);
    expect(status).to.equal(2n);
    expect(inactive).to.equal(true);
    expect(claimable).to.equal(false);
  });

  it("blocks execution during the challenge period", async function () {
    const { vault, owner, beneficiary } = await deployActiveVault();
    await requestExpiredClaim(vault, owner, beneficiary);

    await expect(
      vault.connect(beneficiary).executeClaim(owner.address),
    ).to.be.revertedWithCustomError(vault, "ClaimDelayActive");
  });

  it("lets an owner heartbeat cancel a pending claim", async function () {
    const { vault, owner, beneficiary } = await deployActiveVault();
    await requestExpiredClaim(vault, owner, beneficiary);

    await expect(vault.connect(owner).heartbeat())
      .to.emit(vault, "ClaimCancelled")
      .and.to.emit(vault, "Heartbeat");

    const [, , , , , requestedAt, , status, inactive, claimable] =
      await vault.getVault(owner.address);
    expect(requestedAt).to.equal(0n);
    expect(status).to.equal(1n);
    expect(inactive).to.equal(false);
    expect(claimable).to.equal(false);
  });

  it("lets an owner heartbeat win when it confirms before execution of a mature claim", async function () {
    const { vault, owner, beneficiary } = await deployActiveVault();
    await requestExpiredClaim(vault, owner, beneficiary);
    const pending = await vault.getVault(owner.address);
    const executableAt = pending.claimRequestedAt + pending.claimDelay;
    await provider.send("evm_setNextBlockTimestamp", [Number(executableAt)]);
    await provider.send("evm_mine", []);
    expect(await vault.isClaimable(owner.address)).to.equal(true);

    const beneficiaryBalanceBefore = await ethers.provider.getBalance(
      beneficiary.address,
    );
    const heartbeat = await vault.connect(owner).heartbeat();
    await heartbeat.wait();
    await expect(heartbeat).to.emit(vault, "ClaimCancelled");
    expect(await ethers.provider.getBalance(beneficiary.address)).to.equal(
      beneficiaryBalanceBefore,
    );

    await expect(
      vault.connect(beneficiary).executeClaim(owner.address),
    ).to.be.revertedWithCustomError(vault, "ClaimNotRequested");

    const current = await vault.getVault(owner.address);
    expect(current.lastHeartbeat).to.be.greaterThanOrEqual(executableAt);
    expect(current.claimRequestedAt).to.equal(0n);
    expect(current.balance).to.equal(DEPOSIT);
    expect(current.status).to.equal(1n);
    expect(current.inactive).to.equal(false);
    expect(current.claimable).to.equal(false);
    expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(
      DEPOSIT,
    );
  });

  it("lets beneficiary execution win when it confirms before the owner heartbeat", async function () {
    const { vault, owner, beneficiary } = await deployActiveVault();
    await requestExpiredClaim(vault, owner, beneficiary);
    const pending = await vault.getVault(owner.address);
    const executableAt = pending.claimRequestedAt + pending.claimDelay;
    await provider.send("evm_setNextBlockTimestamp", [Number(executableAt)]);
    await provider.send("evm_mine", []);
    expect(await vault.isClaimable(owner.address)).to.equal(true);

    const beneficiaryBalanceBefore = await ethers.provider.getBalance(
      beneficiary.address,
    );
    const execution = await vault.connect(beneficiary).executeClaim(owner.address);
    const receipt = await execution.wait();
    expect(receipt).not.to.equal(null);
    await expect(execution)
      .to.emit(vault, "Claimed")
      .withArgs(owner.address, beneficiary.address, beneficiary.address, DEPOSIT);
    expect(
      (await ethers.provider.getBalance(beneficiary.address)) + receipt!.fee,
    ).to.equal(beneficiaryBalanceBefore + DEPOSIT);

    await expect(vault.connect(owner).heartbeat()).to.be.revertedWithCustomError(
      vault,
      "VaultNotMutable",
    );

    const current = await vault.getVault(owner.address);
    expect(current.lastHeartbeat).to.equal(pending.lastHeartbeat);
    expect(current.claimRequestedAt).to.equal(0n);
    expect(current.balance).to.equal(0n);
    expect(current.status).to.equal(3n);
    expect(current.inactive).to.equal(false);
    expect(current.claimable).to.equal(false);
    expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(0n);
  });

  it("treats deposit, withdrawal, and update as claim-cancelling activity", async function () {
    const cases = ["deposit", "withdraw", "update"] as const;

    for (const activity of cases) {
      const { vault, owner, beneficiary, other } = await deployActiveVault();
      await requestExpiredClaim(vault, owner, beneficiary);

      if (activity === "deposit") {
        await vault.connect(owner).deposit({ value: ethers.parseEther("0.1") });
      } else if (activity === "withdraw") {
        await vault.connect(owner).withdraw(ethers.parseEther("0.1"));
      } else {
        await vault
          .connect(owner)
          .updateVault(other.address, TIMEOUT, CLAIM_DELAY);
      }

      const [, , , , , requestedAt, , status] = await vault.getVault(
        owner.address,
      );
      expect(requestedAt, activity).to.equal(0n);
      expect(status, activity).to.equal(1n);
    }
  });

  it("does not cancel a pending claim when a deposit exceeds the limit", async function () {
    const { vault, owner, beneficiary } = await deployActiveVault();
    await requestExpiredClaim(vault, owner, beneficiary);
    const [, , , , heartbeatBefore, requestedAtBefore] =
      await vault.getVault(owner.address);

    await expect(
      vault
        .connect(owner)
        .deposit({ value: MAX_VAULT_BALANCE - DEPOSIT + 1n }),
    ).to.be.revertedWithCustomError(vault, "VaultBalanceLimitExceeded");

    const [, , , , heartbeatAfter, requestedAtAfter, balance, status] =
      await vault.getVault(owner.address);
    expect(heartbeatAfter).to.equal(heartbeatBefore);
    expect(requestedAtAfter).to.equal(requestedAtBefore);
    expect(balance).to.equal(DEPOSIT);
    expect(status).to.equal(2n);
  });

  it("transfers the full balance after the challenge period", async function () {
    const { vault, owner, beneficiary } = await deployActiveVault();
    await requestExpiredClaim(vault, owner, beneficiary);
    await increaseTime(CLAIM_DELAY + 1);

    await expect(vault.connect(beneficiary).executeClaim(owner.address))
      .to.emit(vault, "Claimed")
      .withArgs(
        owner.address,
        beneficiary.address,
        beneficiary.address,
        DEPOSIT,
      );

    const [, , , , , , balance, status, inactive, claimable] =
      await vault.getVault(owner.address);
    expect(balance).to.equal(0n);
    expect(status).to.equal(3n);
    expect(inactive).to.equal(false);
    expect(claimable).to.equal(false);
    expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(0n);
  });

  it("prevents duplicate claims and terminal-state mutation", async function () {
    const { vault, owner, beneficiary } = await deployActiveVault();
    await requestExpiredClaim(vault, owner, beneficiary);
    await increaseTime(CLAIM_DELAY + 1);
    await vault.connect(beneficiary).executeClaim(owner.address);

    await expect(
      vault.connect(beneficiary).executeClaim(owner.address),
    ).to.be.revertedWithCustomError(vault, "ClaimNotRequested");
    await expect(vault.connect(owner).heartbeat()).to.be.revertedWithCustomError(
      vault,
      "VaultNotMutable",
    );
  });

  it("permits a new vault after a completed claim", async function () {
    const { vault, owner, beneficiary, other } = await deployActiveVault();
    await requestExpiredClaim(vault, owner, beneficiary);
    await increaseTime(CLAIM_DELAY + 1);
    await vault.connect(beneficiary).executeClaim(owner.address);

    await expect(
      vault
        .connect(owner)
        .createVault(other.address, TIMEOUT, CLAIM_DELAY, { value: DEPOSIT }),
    ).to.emit(vault, "VaultCreated");

    const [, storedBeneficiary, , , , , balance, status] = await vault.getVault(
      owner.address,
    );
    expect(storedBeneficiary).to.equal(other.address);
    expect(balance).to.equal(DEPOSIT);
    expect(status).to.equal(1n);
  });

  it("allows closure during a pending claim", async function () {
    const { vault, owner, beneficiary } = await deployActiveVault();
    await requestExpiredClaim(vault, owner, beneficiary);

    await expect(vault.connect(owner).closeVault())
      .to.emit(vault, "VaultClosed")
      .withArgs(owner.address, DEPOSIT);

    const [, , , , , requestedAt, balance, status] = await vault.getVault(
      owner.address,
    );
    expect(requestedAt).to.equal(0n);
    expect(balance).to.equal(0n);
    expect(status).to.equal(4n);
  });
});

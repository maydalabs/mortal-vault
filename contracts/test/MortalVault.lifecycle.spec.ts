import { expect } from "chai";
import { network } from "hardhat";

const { ethers, provider } = await network.create();

const DAY = 24 * 60 * 60;
const TIMEOUT = 30 * DAY;
const CLAIM_DELAY = 7 * DAY;
const DEPOSIT = ethers.parseEther("1");

async function deployActiveVault() {
  const [owner, beneficiary, other] = await ethers.getSigners();
  const vault = await ethers.deployContract("MortalVault");
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

  it("transfers the full balance after the challenge period", async function () {
    const { vault, owner, beneficiary } = await deployActiveVault();
    await requestExpiredClaim(vault, owner, beneficiary);
    await increaseTime(CLAIM_DELAY + 1);

    await expect(vault.connect(beneficiary).executeClaim(owner.address))
      .to.emit(vault, "Claimed")
      .withArgs(owner.address, beneficiary.address, DEPOSIT);

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

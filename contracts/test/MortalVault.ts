import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

const DAY = 24 * 60 * 60;
const DEFAULT_TIMEOUT = 30 * DAY;
const DEFAULT_CLAIM_DELAY = 7 * DAY;
const INITIAL_DEPOSIT = ethers.parseEther("1");
const MAX_VAULT_BALANCE = ethers.parseEther("100");

async function deployVault() {
  const [owner, beneficiary, other] = await ethers.getSigners();
  const vault = await ethers.deployContract("MortalVault", [MAX_VAULT_BALANCE]);
  await vault.waitForDeployment();
  return { vault, owner, beneficiary, other };
}

async function createDefaultVault(
  vault: Awaited<ReturnType<typeof ethers.deployContract>>,
  owner: Awaited<ReturnType<typeof ethers.getSigners>>[number],
  beneficiary: Awaited<ReturnType<typeof ethers.getSigners>>[number],
) {
  await vault
    .connect(owner)
    .createVault(beneficiary.address, DEFAULT_TIMEOUT, DEFAULT_CLAIM_DELAY, {
      value: INITIAL_DEPOSIT,
    });
}

describe("MortalVault owner operations", function () {
  it("requires a non-zero immutable vault balance limit", async function () {
    const factory = await ethers.getContractFactory("MortalVault");

    await expect(factory.deploy(0)).to.be.revertedWithCustomError(
      factory,
      "InvalidMaxVaultBalance",
    );
  });

  it("creates an active vault with bounded configuration", async function () {
    const { vault, owner, beneficiary } = await deployVault();

    await expect(
      vault
        .connect(owner)
        .createVault(
          beneficiary.address,
          DEFAULT_TIMEOUT,
          DEFAULT_CLAIM_DELAY,
          { value: INITIAL_DEPOSIT },
        ),
    )
      .to.emit(vault, "VaultCreated")
      .withArgs(
        owner.address,
        beneficiary.address,
        DEFAULT_TIMEOUT,
        DEFAULT_CLAIM_DELAY,
        INITIAL_DEPOSIT,
      );

    const [
      storedOwner,
      storedBeneficiary,
      timeout,
      claimDelay,
      lastHeartbeat,
      claimRequestedAt,
      balance,
      status,
      inactive,
      claimable,
    ] = await vault.getVault(owner.address);

    expect(storedOwner).to.equal(owner.address);
    expect(storedBeneficiary).to.equal(beneficiary.address);
    expect(timeout).to.equal(DEFAULT_TIMEOUT);
    expect(claimDelay).to.equal(DEFAULT_CLAIM_DELAY);
    expect(lastHeartbeat).to.be.greaterThan(0n);
    expect(claimRequestedAt).to.equal(0n);
    expect(balance).to.equal(INITIAL_DEPOSIT);
    expect(status).to.equal(1n);
    expect(inactive).to.equal(false);
    expect(claimable).to.equal(false);
    expect(await vault.MAX_VAULT_BALANCE()).to.equal(MAX_VAULT_BALANCE);
  });

  it("enforces the balance limit on creation and deposits", async function () {
    const { vault, owner, beneficiary, other } = await deployVault();

    await expect(
      vault
        .connect(owner)
        .createVault(
          beneficiary.address,
          DEFAULT_TIMEOUT,
          DEFAULT_CLAIM_DELAY,
          { value: MAX_VAULT_BALANCE + 1n },
        ),
    ).to.be.revertedWithCustomError(vault, "VaultBalanceLimitExceeded");

    await vault.connect(owner).createVault(
      beneficiary.address,
      DEFAULT_TIMEOUT,
      DEFAULT_CLAIM_DELAY,
      { value: MAX_VAULT_BALANCE - 1n },
    );

    await expect(vault.connect(owner).deposit({ value: 1n }))
      .to.emit(vault, "Deposited")
      .withArgs(owner.address, 1n, MAX_VAULT_BALANCE);

    await expect(
      vault.connect(owner).deposit({ value: 1n }),
    ).to.be.revertedWithCustomError(vault, "VaultBalanceLimitExceeded");

    const [, , , , , , balance] = await vault.getVault(owner.address);
    expect(balance).to.equal(MAX_VAULT_BALANCE);

    await expect(
      vault
        .connect(other)
        .createVault(owner.address, DEFAULT_TIMEOUT, DEFAULT_CLAIM_DELAY, {
          value: MAX_VAULT_BALANCE,
        }),
    ).to.emit(vault, "VaultCreated");
  });

  it("rejects unsafe creation configuration", async function () {
    const { vault, owner, beneficiary } = await deployVault();
    const minTimeout = await vault.MIN_TIMEOUT();
    const maxTimeout = await vault.MAX_TIMEOUT();
    const minClaimDelay = await vault.MIN_CLAIM_DELAY();
    const maxClaimDelay = await vault.MAX_CLAIM_DELAY();

    await expect(
      vault.createVault(
        ethers.ZeroAddress,
        DEFAULT_TIMEOUT,
        DEFAULT_CLAIM_DELAY,
        { value: INITIAL_DEPOSIT },
      ),
    ).to.be.revertedWithCustomError(vault, "InvalidBeneficiary");

    await expect(
      vault.createVault(
        owner.address,
        DEFAULT_TIMEOUT,
        DEFAULT_CLAIM_DELAY,
        { value: INITIAL_DEPOSIT },
      ),
    ).to.be.revertedWithCustomError(vault, "BeneficiaryIsOwner");

    await expect(
      vault.createVault(beneficiary.address, minTimeout - 1n, minClaimDelay, {
        value: INITIAL_DEPOSIT,
      }),
    ).to.be.revertedWithCustomError(vault, "InvalidTimeout");

    await expect(
      vault.createVault(beneficiary.address, maxTimeout + 1n, minClaimDelay, {
        value: INITIAL_DEPOSIT,
      }),
    ).to.be.revertedWithCustomError(vault, "InvalidTimeout");

    await expect(
      vault.createVault(beneficiary.address, minTimeout, minClaimDelay - 1n, {
        value: INITIAL_DEPOSIT,
      }),
    ).to.be.revertedWithCustomError(vault, "InvalidClaimDelay");

    await expect(
      vault.createVault(beneficiary.address, minTimeout, maxClaimDelay + 1n, {
        value: INITIAL_DEPOSIT,
      }),
    ).to.be.revertedWithCustomError(vault, "InvalidClaimDelay");

    await expect(
      vault.createVault(
        beneficiary.address,
        DEFAULT_TIMEOUT,
        DEFAULT_CLAIM_DELAY,
      ),
    ).to.be.revertedWithCustomError(vault, "MustDeposit");
  });

  it("prevents replacing an active vault", async function () {
    const { vault, owner, beneficiary, other } = await deployVault();
    await createDefaultVault(vault, owner, beneficiary);

    await expect(
      vault
        .connect(owner)
        .createVault(
          other.address,
          DEFAULT_TIMEOUT,
          DEFAULT_CLAIM_DELAY,
          { value: INITIAL_DEPOSIT },
        ),
    ).to.be.revertedWithCustomError(vault, "VaultAlreadyActive");
  });

  it("accumulates deposits and refreshes owner activity", async function () {
    const { vault, owner, beneficiary } = await deployVault();
    await createDefaultVault(vault, owner, beneficiary);
    const [, , , , firstHeartbeat] = await vault.getVault(owner.address);
    const topUp = ethers.parseEther("0.25");

    await expect(vault.connect(owner).deposit({ value: topUp }))
      .to.emit(vault, "Deposited")
      .withArgs(owner.address, topUp, INITIAL_DEPOSIT + topUp);

    const [, , , , nextHeartbeat, , balance] = await vault.getVault(
      owner.address,
    );
    expect(nextHeartbeat).to.be.greaterThanOrEqual(firstHeartbeat);
    expect(balance).to.equal(INITIAL_DEPOSIT + topUp);
  });

  it("updates the beneficiary and timing bounds", async function () {
    const { vault, owner, beneficiary, other } = await deployVault();
    await createDefaultVault(vault, owner, beneficiary);
    const nextTimeout = 60 * DAY;
    const nextClaimDelay = 14 * DAY;

    await expect(
      vault
        .connect(owner)
        .updateVault(other.address, nextTimeout, nextClaimDelay),
    )
      .to.emit(vault, "VaultUpdated")
      .withArgs(owner.address, other.address, nextTimeout, nextClaimDelay);

    const [, storedBeneficiary, timeout, claimDelay] = await vault.getVault(
      owner.address,
    );
    expect(storedBeneficiary).to.equal(other.address);
    expect(timeout).to.equal(nextTimeout);
    expect(claimDelay).to.equal(nextClaimDelay);
  });

  it("withdraws a partial balance and rejects invalid amounts", async function () {
    const { vault, owner, beneficiary } = await deployVault();
    await createDefaultVault(vault, owner, beneficiary);
    const amount = ethers.parseEther("0.4");

    await expect(vault.connect(owner).withdraw(0)).to.be.revertedWithCustomError(
      vault,
      "AmountMustBePositive",
    );
    await expect(
      vault.connect(owner).withdraw(INITIAL_DEPOSIT + 1n),
    ).to.be.revertedWithCustomError(vault, "InsufficientBalance");

    await expect(vault.connect(owner).withdraw(amount))
      .to.emit(vault, "Withdrawn")
      .withArgs(owner.address, amount, INITIAL_DEPOSIT - amount);

    const [, , , , , , balance] = await vault.getVault(owner.address);
    expect(balance).to.equal(INITIAL_DEPOSIT - amount);
  });

  it("closes a vault and permits a fresh vault", async function () {
    const { vault, owner, beneficiary, other } = await deployVault();
    await createDefaultVault(vault, owner, beneficiary);

    await expect(vault.connect(owner).closeVault())
      .to.emit(vault, "VaultClosed")
      .withArgs(owner.address, INITIAL_DEPOSIT);

    const [, , , , , , balance, status] = await vault.getVault(owner.address);
    expect(balance).to.equal(0n);
    expect(status).to.equal(4n);

    await expect(vault.connect(owner).heartbeat()).to.be.revertedWithCustomError(
      vault,
      "VaultNotMutable",
    );

    await expect(
      vault
        .connect(owner)
        .createVault(
          other.address,
          DEFAULT_TIMEOUT,
          DEFAULT_CLAIM_DELAY,
          { value: INITIAL_DEPOSIT },
        ),
    ).to.emit(vault, "VaultCreated");
  });

  it("rejects owner operations when no vault exists", async function () {
    const { vault } = await deployVault();

    await expect(vault.heartbeat()).to.be.revertedWithCustomError(
      vault,
      "NoVault",
    );
    await expect(
      vault.deposit({ value: ethers.parseEther("0.1") }),
    ).to.be.revertedWithCustomError(vault, "NoVault");
    await expect(vault.withdraw(1)).to.be.revertedWithCustomError(
      vault,
      "NoVault",
    );
  });
});

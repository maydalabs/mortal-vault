import { expect } from "chai";
import { network } from "hardhat";

// Hardhat 3 mocha-ethers pattern:
const { ethers, provider } = await network.connect();

describe("MortalVault", function () {
  it("creates a vault and stores the correct data", async function () {
    const [owner, beneficiary] = await ethers.getSigners();

    const vault = await ethers.deployContract("MortalVault");
    await vault.waitForDeployment();

    const timeout = 24 * 60 * 60; // 1 day
    const deposit = ethers.parseEther("1"); // 1 ETH

    await vault
      .connect(owner)
      .createVault(beneficiary.address, timeout, { value: deposit });

    const [
      ownerAddr,
      beneficiaryAddr,
      storedTimeout,
      lastHeartbeat,
      balance,
      exists,
      claimed,
      expired,
    ] = await vault.getVault(owner.address);

    expect(ownerAddr).to.equal(owner.address);
    expect(beneficiaryAddr).to.equal(beneficiary.address);
    expect(storedTimeout).to.equal(timeout);
    expect(balance).to.equal(deposit);
    expect(exists).to.equal(true);
    expect(claimed).to.equal(false);
    expect(expired).to.equal(false);
    expect(lastHeartbeat).to.be.greaterThan(0n);
  });

  it("lets the owner withdraw and updates the balance", async function () {
    const [owner, beneficiary] = await ethers.getSigners();

    const vault = await ethers.deployContract("MortalVault");
    await vault.waitForDeployment();

    const timeout = 24 * 60 * 60;
    const deposit = ethers.parseEther("1");
    await vault.createVault(beneficiary.address, timeout, { value: deposit });

    const withdrawAmount = ethers.parseEther("0.4");
    await vault.withdraw(withdrawAmount);

    const [, , , , balance] = await vault.getVault(owner.address);

    expect(balance).to.equal(deposit - withdrawAmount);
  });

  it("lets the beneficiary claim after expiry and empties the vault", async function () {
    const [owner, beneficiary] = await ethers.getSigners();

    const vault = await ethers.deployContract("MortalVault");
    await vault.waitForDeployment();

    const timeout = 24 * 60 * 60;
    const deposit = ethers.parseEther("1");
    await vault
      .connect(owner)
      .createVault(beneficiary.address, timeout, { value: deposit });

    // fast-forward time past the timeout
    await provider.send("evm_increaseTime", [timeout + 10]);
    await provider.send("evm_mine", []);

    await vault.connect(beneficiary).claim(owner.address);

    const [, , , , balance, , claimed, expired] =
      await vault.getVault(owner.address);

    expect(balance).to.equal(0n);
    expect(claimed).to.equal(true);
    expect(expired).to.equal(true);
  });
});

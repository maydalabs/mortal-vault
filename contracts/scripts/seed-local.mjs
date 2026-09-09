#!/usr/bin/env node

/**
 * Drives a local Hardhat chain into every vault lifecycle state at once.
 *
 * The vault's shortest legal inactivity timeout and challenge period are one
 * day each, so on a real clock the claim path cannot be seen until tomorrow.
 * `docs/local-dev.md` says as much: "Claim request is intentionally unavailable
 * until the timeout." That makes the half of the product that matters most —
 * what a beneficiary sees, what an owner sees when a claim is running — the
 * half nobody can look at while building it.
 *
 * This mines through that. It creates one vault per state, ages the chain
 * between steps, and prints who owns what, so any of them can be opened in the
 * app immediately.
 *
 * Local networks only. It refuses to run against a chain it does not recognise
 * as a development node, because `evm_increaseTime` is not something to point
 * at anything real.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Contract, JsonRpcProvider, formatEther, isAddress, parseEther } from "ethers";

import { contractsRoot, releaseError } from "./release-lib.mjs";

const DEFAULT_RPC_URL = "http://127.0.0.1:8545";
const LOCAL_CHAIN_IDS = new Set([31337, 1337]);
const HOUR = 3600;
const DAY = 86_400;

const ABI = [
  "function createVault(address beneficiary, uint64 timeout, uint64 claimDelay) payable",
  "function deposit() payable",
  "function heartbeat()",
  "function closeVault()",
  "function requestClaim(address owner)",
  "function executeClaim(address owner)",
  "function getVault(address owner) view returns (address,address,uint256,uint256,uint256,uint256,uint256,uint8,bool,bool)",
];

const STATUS_NAMES = ["None", "Active", "ClaimRequested", "Claimed", "Closed"];

/**
 * Every vault is created in the same first step, so its age is decided by the
 * timeout it is given rather than by when it was made. After the two time jumps
 * below (three days and two hours in total) each one has landed in its state.
 */
const SCENARIOS = [
  {
    key: "active",
    description: "Healthy. Recently checked in, months of runway.",
    owner: 0,
    beneficiary: 1,
    timeout: 180 * DAY,
    claimDelay: 60 * DAY,
    deposit: "2.5",
    exercise: true,
  },
  {
    key: "due-soon",
    description: "Still safe, but the check-in deadline is hours away.",
    owner: 2,
    beneficiary: 3,
    timeout: 3 * DAY + 12 * HOUR,
    claimDelay: 60 * DAY,
    deposit: "1.0",
  },
  {
    key: "overdue",
    description: "Gone quiet. The beneficiary may now start a claim.",
    owner: 4,
    beneficiary: 5,
    timeout: DAY,
    claimDelay: 7 * DAY,
    deposit: "0.75",
  },
  {
    key: "claim-pending",
    description: "A claim is running. The owner can still cancel by checking in.",
    owner: 6,
    beneficiary: 7,
    timeout: DAY,
    claimDelay: 30 * DAY,
    deposit: "3.2",
    request: true,
  },
  {
    key: "claimable",
    description: "The challenge period has elapsed. The beneficiary can execute.",
    owner: 8,
    beneficiary: 9,
    timeout: DAY,
    claimDelay: DAY,
    deposit: "1.4",
    request: true,
  },
  {
    key: "claimed",
    description: "Terminal. The balance has already passed to the beneficiary.",
    owner: 10,
    beneficiary: 11,
    timeout: DAY,
    claimDelay: DAY,
    deposit: "0.9",
    request: true,
    execute: true,
  },
  {
    key: "closed",
    description: "Terminal. The owner took everything back and ended the plan.",
    owner: 12,
    beneficiary: 13,
    timeout: 30 * DAY,
    claimDelay: 7 * DAY,
    deposit: "0.5",
    close: true,
  },
];

function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw releaseError(`${name} requires a value`);
  return value;
}

async function resolveContractAddress() {
  const override = optionValue("--contract");
  if (override) {
    if (!isAddress(override)) throw releaseError(`--contract is not an address: ${override}`);
    return override;
  }
  const path = resolve(
    contractsRoot,
    "ignition/deployments/localhost/deployed_addresses.json",
  );
  try {
    const deployed = JSON.parse(await readFile(path, "utf8"));
    const address = deployed["MortalVaultModule#MortalVault"];
    if (address) return address;
  } catch {
    // Fall through to the guidance below.
  }
  throw releaseError(
    "no local deployment found. Run `npm run node` in one terminal and " +
      "`npm run deploy:local` in another, or pass --contract <address>.",
  );
}

async function advance(provider, seconds, label) {
  await provider.send("evm_increaseTime", [seconds]);
  await provider.send("evm_mine", []);
  const block = await provider.getBlock("latest");
  process.stdout.write(
    `  … ${label} (chain clock now ${new Date(block.timestamp * 1000).toISOString()})\n`,
  );
}

async function main() {
  // Validate every option before sending anything. A typo discovered after the
  // seeding has run leaves a half-built chain that the next run cannot rebuild.
  const fundTarget = optionValue("--fund");
  if (fundTarget !== undefined && !isAddress(fundTarget)) {
    throw releaseError(`--fund is not an address: ${fundTarget}`);
  }
  const fundAmount = optionValue("--amount") ?? "50";
  if (fundTarget !== undefined) parseEther(fundAmount);

  const rpcUrl = optionValue("--rpc-url") ?? DEFAULT_RPC_URL;
  const provider = new JsonRpcProvider(rpcUrl);

  let chainId;
  try {
    chainId = Number((await provider.getNetwork()).chainId);
  } catch {
    throw releaseError(`no JSON-RPC node answering at ${rpcUrl}. Start one with \`npm run node\`.`);
  }
  if (!LOCAL_CHAIN_IDS.has(chainId)) {
    throw releaseError(
      `refusing to seed chain ${chainId}. This script mines and moves the clock, ` +
        "so it only runs against a local development node.",
    );
  }

  const contractAddress = await resolveContractAddress();
  if ((await provider.getCode(contractAddress)) === "0x") {
    throw releaseError(`no contract deployed at ${contractAddress} on chain ${chainId}`);
  }

  const asOwner = async (index) =>
    new Contract(contractAddress, ABI, await provider.getSigner(index));
  const addressOf = async (index) => (await provider.getSigner(index)).getAddress();
  const reader = new Contract(contractAddress, ABI, provider);

  process.stdout.write(`Seeding ${contractAddress} on chain ${chainId}\n\n`);

  // Step 0 — a seed script that only works once is barely a seed script. Any
  // vault a previous run left on these accounts is closed first, which the
  // owner may always do while the vault is still mutable. Only the fixed
  // development accounts below are touched.
  let cleared = 0;
  for (const scenario of SCENARIOS) {
    const ownerAddress = await addressOf(scenario.owner);
    const view = await reader.getVault(ownerAddress);
    const status = Number(view[7]);
    const mutable = status === 1 || status === 2; // Active or ClaimRequested
    if (mutable) {
      await (await (await asOwner(scenario.owner)).closeVault()).wait();
      cleared += 1;
    }
  }
  if (cleared > 0) {
    process.stdout.write(`  cleared ${cleared} vault(s) from a previous run\n`);
  }

  // Step 1 — every vault is born here, so each one's clock starts together.
  for (const scenario of SCENARIOS) {
    const vault = await asOwner(scenario.owner);
    const beneficiary = await addressOf(scenario.beneficiary);
    await (
      await vault.createVault(beneficiary, BigInt(scenario.timeout), BigInt(scenario.claimDelay), {
        value: parseEther(scenario.deposit),
      })
    ).wait();

    // Give one vault a little history, so the activity feed and the vigil
    // calendar have something to render rather than a single creation event.
    if (scenario.exercise) {
      await (await vault.deposit({ value: parseEther("0.4") })).wait();
    }
    process.stdout.write(`  created ${scenario.key} (${scenario.deposit} ETH)\n`);
  }

  await advance(provider, 2 * DAY + HOUR, "two days pass");

  for (const scenario of SCENARIOS.filter((s) => s.exercise)) {
    await (await (await asOwner(scenario.owner)).heartbeat()).wait();
    process.stdout.write(`  ${scenario.key}: owner checked in\n`);
  }

  // Step 2 — the vaults that have gone quiet long enough are claimed against.
  for (const scenario of SCENARIOS.filter((s) => s.request)) {
    const heir = new Contract(contractAddress, ABI, await provider.getSigner(scenario.beneficiary));
    await (await heir.requestClaim(await addressOf(scenario.owner))).wait();
    process.stdout.write(`  ${scenario.key}: beneficiary requested a claim\n`);
  }

  await advance(provider, DAY + HOUR, "another day passes");

  // Step 3 — terminal states.
  for (const scenario of SCENARIOS.filter((s) => s.execute)) {
    const heir = new Contract(contractAddress, ABI, await provider.getSigner(scenario.beneficiary));
    await (await heir.executeClaim(await addressOf(scenario.owner))).wait();
    process.stdout.write(`  ${scenario.key}: claim executed\n`);
  }
  for (const scenario of SCENARIOS.filter((s) => s.close)) {
    await (await (await asOwner(scenario.owner)).closeVault()).wait();
    process.stdout.write(`  ${scenario.key}: vault closed\n`);
  }

  // Optional: top up a wallet the developer actually holds keys for.
  if (fundTarget) {
    const funder = await provider.getSigner(19);
    await (
      await funder.sendTransaction({ to: fundTarget, value: parseEther(fundAmount) })
    ).wait();
    process.stdout.write(`\n  funded ${fundTarget} with ${fundAmount} ETH\n`);
  }

  // Report what was built, and verify it rather than assuming it.
  process.stdout.write("\nSeeded vaults:\n\n");
  let mismatches = 0;
  for (const scenario of SCENARIOS) {
    const ownerAddress = await addressOf(scenario.owner);
    const view = await reader.getVault(ownerAddress);
    const status = STATUS_NAMES[Number(view[7])] ?? "Unknown";
    const balance = formatEther(view[6]);
    process.stdout.write(
      `  ${scenario.key.padEnd(14)} ${status.padEnd(15)} ${balance.padEnd(8)} ETH  owner ${ownerAddress}\n` +
        `  ${" ".repeat(14)} heir ${await addressOf(scenario.beneficiary)}\n` +
        `  ${" ".repeat(14)} ${scenario.description}\n\n`,
    );
    const expected = expectedStatus(scenario);
    if (status !== expected) {
      process.stderr.write(`  ! ${scenario.key} is ${status}, expected ${expected}\n`);
      mismatches += 1;
    }
  }

  if (mismatches > 0) {
    throw releaseError(`${mismatches} vault(s) did not reach the intended state`);
  }
  process.stdout.write("Every lifecycle state is now reachable in the app.\n");
}

function expectedStatus(scenario) {
  if (scenario.close) return "Closed";
  if (scenario.execute) return "Claimed";
  if (scenario.request) return "ClaimRequested";
  return "Active";
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

#!/usr/bin/env node

/**
 * Answers one question before a release: would `npm run deploy:<network>`
 * succeed right now, or fail on something knowable in advance?
 *
 * Every check is read-only. This script never sends a transaction, and it
 * never prints a private key: a key found in the environment is used only to
 * derive its public address.
 */

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { formatEther, JsonRpcProvider, Wallet, isAddress } from "ethers";

import {
  contractsRoot,
  getGitReleaseState,
  parseBigIntParameter,
  readJson,
  releaseError,
  requireReleaseNetwork,
} from "./release-lib.mjs";

/** Deployments are cheap, but a wallet this empty will not finish one. */
const MINIMUM_BALANCE_WEI = 5_000_000_000_000_000n; // 0.005 ETH
/** Headroom over the estimate, for gas drift between now and the deploy. */
const COST_SAFETY_FACTOR = 3n;

const PASS = "  ok  ";
const WARN = " warn ";
const FAIL = " fail ";

let failures = 0;
let warnings = 0;

function report(status, label, detail) {
  if (status === FAIL) failures += 1;
  if (status === WARN) warnings += 1;
  process.stdout.write(`[${status}] ${label}${detail ? `: ${detail}` : ""}\n`);
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw releaseError(`${name} requires a value`);
  }
  return value;
}

function checkWorkingTree() {
  // Ask the same question the manifest writer will ask, through the same
  // function. A second opinion here is worse than no check at all: this gate
  // runs before the deploy, and the manifest runs after, so any disagreement
  // is discovered only once a contract is live and the funds are spent — and
  // the runbook says a release record cannot be repaired in place.
  let state;
  try {
    state = getGitReleaseState();
  } catch {
    report(WARN, "Working tree", "could not read git state");
    return;
  }

  const { gitCommit, gitStatus } = state;
  const shortCommit = gitCommit.slice(0, 7);
  if (!gitStatus) {
    report(PASS, "Working tree", `clean at ${shortCommit}`);
    return;
  }

  const lines = gitStatus.split("\n").filter((line) => line.trim());
  const untracked = lines.filter((line) => line.startsWith("??"));
  const detail =
    untracked.length === lines.length
      ? `${lines.length} untracked path(s) — commit them or add them to .gitignore: ${untracked
          .map((line) => line.slice(3))
          .join(", ")}`
      : `${lines.length} change(s) not committed`;

  report(
    FAIL,
    "Working tree",
    `${detail}. write-release-manifest.mjs refuses a dirty tree, and it runs after the deploy has already spent gas.`,
  );
}

function checkDeployerKey() {
  const explicit = optionValue("--address");
  if (explicit) {
    if (!isAddress(explicit)) {
      report(FAIL, "Deployer", `--address is not an address: ${explicit}`);
      return undefined;
    }
    report(PASS, "Deployer", `${explicit} (from --address)`);
    return explicit;
  }

  const key = process.env.DEPLOYER_PRIVATE_KEY;
  if (!key) {
    report(
      WARN,
      "Deployer",
      "DEPLOYER_PRIVATE_KEY is not in the environment. Hardhat keystore values are not visible here; pass --address <deployer> to check the balance anyway.",
    );
    return undefined;
  }

  try {
    // Only the address leaves this scope. The key itself is never printed.
    const address = new Wallet(key.startsWith("0x") ? key : `0x${key}`).address;
    report(PASS, "Deployer", `${address} (derived from DEPLOYER_PRIVATE_KEY)`);
    return address;
  } catch {
    report(
      FAIL,
      "Deployer",
      "DEPLOYER_PRIVATE_KEY is set but is not a valid private key",
    );
    return undefined;
  }
}

function checkEtherscanKey() {
  if (process.env.ETHERSCAN_API_KEY) {
    report(PASS, "Etherscan key", "present");
  } else {
    report(
      WARN,
      "Etherscan key",
      "ETHERSCAN_API_KEY is unset. Deployment will work; source verification will not.",
    );
  }
}

async function checkNetwork(network, networkName) {
  const rpcUrl = process.env[network.rpcEnvironmentVariable];
  if (!rpcUrl) {
    report(
      FAIL,
      "RPC endpoint",
      `${network.rpcEnvironmentVariable} is not set in the environment`,
    );
    return undefined;
  }

  const provider = new JsonRpcProvider(rpcUrl);
  try {
    const chain = await provider.getNetwork();
    if (Number(chain.chainId) !== network.chainId) {
      report(
        FAIL,
        "RPC endpoint",
        `answered for chain ${chain.chainId}, expected ${network.chainId} (${networkName})`,
      );
      return undefined;
    }
    const block = await provider.getBlockNumber();
    report(PASS, "RPC endpoint", `chain ${network.chainId} at block ${block}`);
    return provider;
  } catch (error) {
    report(FAIL, "RPC endpoint", `unreachable: ${error.shortMessage ?? error.message}`);
    return undefined;
  }
}

async function estimateDeploymentCost(provider, network, deployer) {
  let artifact;
  try {
    artifact = await readJson(
      resolve(contractsRoot, "artifacts/contracts/MortalVault.sol/MortalVault.json"),
    );
  } catch {
    report(WARN, "Deployment cost", "no compiled artifact; run npm run compile");
    return undefined;
  }

  try {
    const parameters = await readJson(resolve(contractsRoot, network.parameters));
    const maxVaultBalance = BigInt(
      parseBigIntParameter(parameters.MortalVaultModule.maxVaultBalance),
    );
    const constructorArg = maxVaultBalance.toString(16).padStart(64, "0");
    const data = `${artifact.bytecode}${constructorArg}`;

    const [gas, feeData] = await Promise.all([
      provider.estimateGas(deployer ? { data, from: deployer } : { data }),
      provider.getFeeData(),
    ]);
    const price = feeData.maxFeePerGas ?? feeData.gasPrice;
    if (!price) {
      report(WARN, "Deployment cost", `~${gas} gas; node reported no gas price`);
      return undefined;
    }
    const cost = gas * price;
    report(
      PASS,
      "Deployment cost",
      `~${gas} gas, ~${formatEther(cost)} ETH at current fees (cap ${formatEther(maxVaultBalance)} per vault)`,
    );
    return cost;
  } catch (error) {
    report(
      WARN,
      "Deployment cost",
      `could not estimate: ${error.shortMessage ?? error.message}`,
    );
    return undefined;
  }
}

async function checkBalance(provider, deployer, estimatedCost) {
  if (!deployer) {
    report(WARN, "Deployer balance", "skipped, no deployer address known");
    return;
  }

  const balance = await provider.getBalance(deployer);
  const required =
    estimatedCost !== undefined
      ? estimatedCost * COST_SAFETY_FACTOR
      : MINIMUM_BALANCE_WEI;

  if (balance === 0n) {
    report(FAIL, "Deployer balance", "empty; fund it from a faucet");
    return;
  }
  if (balance < required) {
    report(
      FAIL,
      "Deployer balance",
      `${formatEther(balance)} ETH is below the ${formatEther(required)} ETH this deploy wants`,
    );
    return;
  }
  report(PASS, "Deployer balance", `${formatEther(balance)} ETH`);
}

async function checkExistingRelease(network, networkName) {
  try {
    const manifest = await readJson(resolve(contractsRoot, network.manifest));
    report(
      WARN,
      "Existing release",
      `${network.manifest} already records ${manifest.address ?? "a deployment"}. A new deploy creates a separate contract; the old one keeps running.`,
    );
  } catch {
    report(PASS, "Existing release", `none recorded for ${networkName}`);
  }
}

async function main() {
  const networkName = process.argv[2];
  if (!networkName || networkName.startsWith("--")) {
    throw releaseError("usage: preflight-release.mjs <network> [--address 0x...]");
  }
  const network = requireReleaseNetwork(networkName);

  process.stdout.write(`Pre-flight for ${networkName} (chain ${network.chainId})\n\n`);

  checkWorkingTree();
  const deployer = checkDeployerKey();
  checkEtherscanKey();
  await checkExistingRelease(network, networkName);

  const provider = await checkNetwork(network, networkName);
  if (provider) {
    const estimatedCost = await estimateDeploymentCost(provider, network, deployer);
    await checkBalance(provider, deployer, estimatedCost);
    provider.destroy();
  }

  process.stdout.write("\n");
  if (failures > 0) {
    process.stdout.write(
      `NO-GO: ${failures} blocking problem(s)${warnings ? `, ${warnings} warning(s)` : ""}.\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    warnings > 0
      ? `GO, with ${warnings} warning(s) to read first.\n`
      : "GO. Run the deploy command for this network.\n",
  );
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

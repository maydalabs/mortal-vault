#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress, keccak256 } from "ethers";

const contractsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(contractsRoot, "..");
const futureId = "MortalVaultModule#MortalVault";

const networks = {
  local: {
    chainId: 31337,
    deploymentId: "localhost",
    parameters: "ignition/parameters/local.json",
  },
  sepolia: {
    chainId: 11155111,
    deploymentId: "sepolia",
    parameters: "ignition/parameters/sepolia.json",
  },
  "base-sepolia": {
    chainId: 84532,
    deploymentId: "base-sepolia",
    parameters: "ignition/parameters/base-sepolia.json",
  },
  "bsc-testnet": {
    chainId: 97,
    deploymentId: "bsc-testnet",
    parameters: "ignition/parameters/bsc-testnet.json",
  },
};

function fail(message) {
  console.error(`Release manifest error: ${message}`);
  process.exit(1);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function parseBigIntParameter(value) {
  if (typeof value !== "string" || !/^\d+n$/.test(value)) {
    fail("maxVaultBalance must use Ignition's decimal bigint string format");
  }
  return value.slice(0, -1);
}

function journalBigInt(value) {
  if (value && value._kind === "bigint") return value.value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "string") return String(value);
  return null;
}

const networkName = process.argv[2];
const verified = process.argv.includes("--verified");
const allowDirty = process.argv.includes("--allow-dirty");
const network = networks[networkName];

if (!network) {
  fail(`network must be one of: ${Object.keys(networks).join(", ")}`);
}

const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repositoryRoot,
  encoding: "utf8",
}).trim();
const gitStatus = execFileSync("git", ["status", "--porcelain"], {
  cwd: repositoryRoot,
  encoding: "utf8",
}).trim();

if (gitStatus && !allowDirty) {
  fail("the repository must be clean; commit the release candidate first");
}

const deploymentDir = join(
  contractsRoot,
  "ignition",
  "deployments",
  network.deploymentId,
);
const parameters = await readJson(join(contractsRoot, network.parameters));
const maxVaultBalanceWei = parseBigIntParameter(
  parameters.MortalVaultModule?.maxVaultBalance,
);
const addresses = await readJson(join(deploymentDir, "deployed_addresses.json"));
const address = addresses[futureId];

if (!address) fail(`${futureId} is missing from deployed_addresses.json`);

const journalLines = (await readFile(join(deploymentDir, "journal.jsonl"), "utf8"))
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const initialization = journalLines.find(
  (entry) =>
    entry.type === "DEPLOYMENT_EXECUTION_STATE_INITIALIZE" &&
    entry.futureId === futureId,
);
const confirmation = journalLines.findLast(
  (entry) =>
    entry.type === "TRANSACTION_CONFIRM" &&
    entry.futureId === futureId &&
    entry.receipt?.status === "SUCCESS",
);
const deploymentChainId = journalLines.find(
  (entry) => entry.type === "DEPLOYMENT_INITIALIZE",
)?.chainId;

if (!initialization || !confirmation) {
  fail(
    "the Ignition journal does not contain a successful MortalVault deployment",
  );
}
if (deploymentChainId !== network.chainId) {
  fail(
    `deployment chain ${deploymentChainId} does not match expected chain ${network.chainId}`,
  );
}
if (journalBigInt(initialization.constructorArgs?.[0]) !== maxVaultBalanceWei) {
  fail("the deployed constructor cap does not match the checked-in parameter file");
}

const artifact = await readJson(
  join(deploymentDir, "artifacts", `${futureId}.json`),
);
const buildInfo = await readJson(
  join(deploymentDir, "build-info", `${artifact.buildInfoId}.json`),
);

const manifest = {
  $schema: "./manifest.schema.json",
  schemaVersion: 1,
  network: {
    name: networkName,
    chainId: network.chainId,
  },
  deployment: {
    id: network.deploymentId,
    module: "MortalVaultModule",
    futureId,
    address: getAddress(address),
    transactionHash: confirmation.hash,
    blockNumber: confirmation.receipt.blockNumber,
  },
  contract: {
    name: artifact.contractName,
    source: artifact.sourceName,
    constructorArguments: {
      maxVaultBalanceWei,
    },
    creationBytecodeKeccak256: keccak256(artifact.bytecode),
  },
  build: {
    profile: "production",
    buildInfoId: artifact.buildInfoId,
    solcVersion: buildInfo.solcLongVersion,
    optimizer: buildInfo.input.settings.optimizer,
    gitCommit,
    gitDirty: Boolean(gitStatus),
  },
  verification: {
    status: verified ? "verified" : "pending",
    providers: ["etherscan", "sourcify"],
  },
};

const outputPath = join(contractsRoot, "deployments", `${networkName}.json`);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);

#!/usr/bin/env node

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAddress, keccak256 } from "ethers";
import {
  contractsRoot,
  deploymentDirectory,
  futureId,
  getGitReleaseState,
  journalBigInt,
  expectedRuntimeBytecodeHash,
  parseBigIntParameter,
  readJson,
  releaseError,
  requireReleaseNetwork,
  resolveContractsPath,
  validateProductionArtifact,
} from "./release-lib.mjs";

function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw releaseError(`${name} requires a value`);
  }
  return value;
}

async function main() {
  const networkName = process.argv[2];
  const verified = process.argv.includes("--verified");
  const allowDirty = process.argv.includes("--allow-dirty");
  const network = requireReleaseNetwork(networkName);
  const deploymentId = optionValue("--deployment-id") ?? network.deploymentId;
  const outputOption = optionValue("--output");
  const outputPath = resolveContractsPath(outputOption ?? network.manifest);

  if (
    networkName !== "local" &&
    (deploymentId !== network.deploymentId || allowDirty || outputOption)
  ) {
    throw releaseError(
      "public manifest deployment IDs, output paths, and clean-tree checks cannot be overridden",
    );
  }

  const { gitCommit, gitStatus } = getGitReleaseState();
  if (gitStatus && !allowDirty) {
    throw releaseError(
      "the repository must be clean; commit the release candidate first",
    );
  }

  const deploymentDir = deploymentDirectory(deploymentId);
  const parameters = await readJson(join(contractsRoot, network.parameters));
  const maxVaultBalanceWei = parseBigIntParameter(
    parameters.MortalVaultModule?.maxVaultBalance,
  );
  const addresses = await readJson(
    join(deploymentDir, "deployed_addresses.json"),
  );
  const address = addresses[futureId];
  if (!address) {
    throw releaseError(`${futureId} is missing from deployed_addresses.json`);
  }

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
    throw releaseError(
      "the Ignition journal does not contain a successful MortalVault deployment",
    );
  }
  if (deploymentChainId !== network.chainId) {
    throw releaseError(
      `deployment chain ${deploymentChainId} does not match expected chain ${network.chainId}`,
    );
  }
  if (journalBigInt(initialization.constructorArgs?.[0]) !== maxVaultBalanceWei) {
    throw releaseError(
      "the deployed constructor cap does not match the checked-in parameter file",
    );
  }
  if (getAddress(confirmation.receipt.contractAddress) !== getAddress(address)) {
    throw releaseError(
      "the deployment receipt address does not match deployed_addresses.json",
    );
  }

  const artifact = await readJson(
    join(deploymentDir, "artifacts", `${futureId}.json`),
  );
  const buildInfo = await readJson(
    join(deploymentDir, "build-info", `${artifact.buildInfoId}.json`),
  );
  validateProductionArtifact(artifact, buildInfo);

  const manifest = {
    $schema: "./manifest.schema.json",
    schemaVersion: 2,
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
      blockHash: confirmation.receipt.blockHash,
      blockNumber: confirmation.receipt.blockNumber,
    },
    contract: {
      name: artifact.contractName,
      source: artifact.sourceName,
      constructorArguments: {
        maxVaultBalanceWei,
      },
      creationBytecodeKeccak256: keccak256(artifact.bytecode),
      runtimeBytecodeKeccak256: expectedRuntimeBytecodeHash(
        artifact,
        maxVaultBalanceWei,
      ),
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

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { Contract, JsonRpcProvider, getAddress, keccak256 } from "ethers";
import {
  appEnvironmentEntries,
  assertManifestGitCommitExists,
  contractsRoot,
  expectedRuntimeBytecodeHash,
  parseBigIntParameter,
  readJson,
  releaseError,
  requireReleaseNetwork,
  resolveContractsPath,
  upsertEnvironmentFile,
  validateProductionArtifact,
  validateReleaseManifest,
} from "./release-lib.mjs";

const MAX_VAULT_BALANCE_ABI = [
  "function MAX_VAULT_BALANCE() view returns (uint256)",
];

function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw releaseError(`${name} requires a value`);
  }
  return value;
}

function parseNonNegativeInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw releaseError(`${label} must be a non-negative integer`);
  }
  return parsed;
}

async function loadProductionArtifact() {
  const artifactPath = resolve(
    contractsRoot,
    "artifacts/contracts/MortalVault.sol/MortalVault.json",
  );
  const artifact = await readJson(artifactPath);
  const buildInfo = await readJson(
    resolve(contractsRoot, "artifacts/build-info", `${artifact.buildInfoId}.json`),
  );
  validateProductionArtifact(artifact, buildInfo);
  return { artifact, buildInfo };
}

async function main() {
  const networkName = process.argv[2];
  const network = requireReleaseNetwork(networkName);
  const allowDirty = process.argv.includes("--allow-dirty");
  const allowPending = process.argv.includes("--allow-pending");
  const manifestPath = resolveContractsPath(
    optionValue("--manifest") ?? network.manifest,
  );
  const rpcUrl =
    optionValue("--rpc-url") ?? process.env[network.rpcEnvironmentVariable];
  const confirmations = parseNonNegativeInteger(
    optionValue("--confirmations") ?? (networkName === "local" ? "0" : "12"),
    "confirmation count",
  );
  const appEnvOption = optionValue("--app-env");
  const appEnvPath = appEnvOption
    ? isAbsolute(appEnvOption)
      ? appEnvOption
      : resolve(contractsRoot, appEnvOption)
    : undefined;

  if (networkName !== "local" && (allowDirty || allowPending)) {
    throw releaseError(
      "dirty or pending release evidence can only be audited locally",
    );
  }
  if (networkName !== "local" && confirmations < 12) {
    throw releaseError("public release audits require at least 12 confirmations");
  }

  if (!rpcUrl) {
    throw releaseError(
      `provide --rpc-url or set ${network.rpcEnvironmentVariable}`,
    );
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  validateReleaseManifest(manifest, networkName, { allowDirty, allowPending });
  assertManifestGitCommitExists(manifest.build.gitCommit);
  const { artifact, buildInfo } = await loadProductionArtifact();
  const parameters = await readJson(resolve(contractsRoot, network.parameters));
  const checkedInCap = parseBigIntParameter(
    parameters.MortalVaultModule?.maxVaultBalance,
  );

  if (
    manifest.contract.constructorArguments.maxVaultBalanceWei !== checkedInCap
  ) {
    throw releaseError("manifest vault cap does not match checked-in parameters");
  }

  if (
    manifest.build.buildInfoId !== artifact.buildInfoId ||
    manifest.build.solcVersion !== buildInfo.solcLongVersion
  ) {
    throw releaseError("manifest build identity does not match this source tree");
  }

  const expectedCreationHash = keccak256(artifact.bytecode);
  if (manifest.contract.creationBytecodeKeccak256 !== expectedCreationHash) {
    throw releaseError("manifest creation bytecode does not match this source tree");
  }
  const expectedRuntimeHash = expectedRuntimeBytecodeHash(artifact, checkedInCap);
  if (manifest.contract.runtimeBytecodeKeccak256 !== expectedRuntimeHash) {
    throw releaseError("manifest runtime bytecode does not match this source tree");
  }

  const provider = new JsonRpcProvider(rpcUrl, undefined, {
    staticNetwork: false,
  });
  try {
    const providerNetwork = await provider.getNetwork();
    if (providerNetwork.chainId !== BigInt(network.chainId)) {
      throw releaseError(
        `RPC chain ${providerNetwork.chainId} does not match expected chain ${network.chainId}`,
      );
    }

    const address = getAddress(manifest.deployment.address);
    const [code, receipt, latestBlock] = await Promise.all([
      provider.getCode(address),
      provider.getTransactionReceipt(manifest.deployment.transactionHash),
      provider.getBlockNumber(),
    ]);
    if (code === "0x") {
      throw releaseError(`no contract code exists at ${address}`);
    }
    const liveRuntimeHash = keccak256(code);
    if (liveRuntimeHash !== expectedRuntimeHash) {
      throw releaseError("live runtime bytecode does not match the release artifact");
    }
    if (!receipt || receipt.status !== 1) {
      throw releaseError("deployment transaction receipt is missing or unsuccessful");
    }
    if (
      receipt.blockNumber !== manifest.deployment.blockNumber ||
      receipt.blockHash !== manifest.deployment.blockHash
    ) {
      throw releaseError("live deployment receipt does not match the manifest block");
    }
    if (!receipt.contractAddress || getAddress(receipt.contractAddress) !== address) {
      throw releaseError("deployment receipt contract address does not match manifest");
    }
    const observedConfirmations = latestBlock - receipt.blockNumber + 1;
    if (observedConfirmations < confirmations) {
      throw releaseError(
        `deployment has ${observedConfirmations} confirmations; ${confirmations} required`,
      );
    }

    const contract = new Contract(address, MAX_VAULT_BALANCE_ABI, provider);
    const liveCap = await contract.MAX_VAULT_BALANCE();
    if (
      liveCap.toString() !==
      manifest.contract.constructorArguments.maxVaultBalanceWei
    ) {
      throw releaseError("live immutable vault cap does not match the manifest");
    }

    if (appEnvPath) {
      await upsertEnvironmentFile(
        appEnvPath,
        appEnvironmentEntries(network, manifest),
      );
      console.log(`Updated app environment ${appEnvPath}`);
    }

    console.log(
      JSON.stringify(
        {
          status: "passed",
          network: networkName,
          chainId: network.chainId,
          address,
          deploymentBlock: receipt.blockNumber,
          confirmations: observedConfirmations,
          maxVaultBalanceWei: liveCap.toString(),
          runtimeBytecodeKeccak256: liveRuntimeHash,
          sourceVerification: manifest.verification.status,
        },
        null,
        2,
      ),
    );
  } finally {
    await provider.destroy();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

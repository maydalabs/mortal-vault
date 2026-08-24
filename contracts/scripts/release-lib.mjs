import { execFileSync } from "node:child_process";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress, keccak256, toBeHex } from "ethers";

export const contractsRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const repositoryRoot = resolve(contractsRoot, "..");
export const futureId = "MortalVaultModule#MortalVault";

export const releaseNetworks = Object.freeze({
  local: Object.freeze({
    chainId: 31337,
    deploymentId: "localhost",
    parameters: "ignition/parameters/local.json",
    manifest: "deployments/local.json",
    rpcEnvironmentVariable: "LOCALHOST_RPC_URL",
    appAddressEnvironmentVariable: "NEXT_PUBLIC_MORTAL_VAULT_ADDRESS_LOCAL",
  }),
  sepolia: Object.freeze({
    chainId: 11155111,
    deploymentId: "sepolia",
    parameters: "ignition/parameters/sepolia.json",
    manifest: "deployments/sepolia.json",
    rpcEnvironmentVariable: "SEPOLIA_RPC_URL",
    appAddressEnvironmentVariable: "NEXT_PUBLIC_MORTAL_VAULT_ADDRESS_SEPOLIA",
    appBlockEnvironmentVariable:
      "NEXT_PUBLIC_MORTAL_VAULT_DEPLOYMENT_BLOCK_SEPOLIA",
  }),
  "base-sepolia": Object.freeze({
    chainId: 84532,
    deploymentId: "base-sepolia",
    parameters: "ignition/parameters/base-sepolia.json",
    manifest: "deployments/base-sepolia.json",
    rpcEnvironmentVariable: "BASE_SEPOLIA_RPC_URL",
    appAddressEnvironmentVariable:
      "NEXT_PUBLIC_MORTAL_VAULT_ADDRESS_BASE_SEPOLIA",
    appBlockEnvironmentVariable:
      "NEXT_PUBLIC_MORTAL_VAULT_DEPLOYMENT_BLOCK_BASE_SEPOLIA",
  }),
  "bsc-testnet": Object.freeze({
    chainId: 97,
    deploymentId: "bsc-testnet",
    parameters: "ignition/parameters/bsc-testnet.json",
    manifest: "deployments/bsc-testnet.json",
    rpcEnvironmentVariable: "BSC_TESTNET_RPC_URL",
    appAddressEnvironmentVariable:
      "NEXT_PUBLIC_MORTAL_VAULT_ADDRESS_BSC_TESTNET",
    appBlockEnvironmentVariable:
      "NEXT_PUBLIC_MORTAL_VAULT_DEPLOYMENT_BLOCK_BSC_TESTNET",
  }),
});

export function releaseError(message) {
  return new Error(`Release validation error: ${message}`);
}

export function requireReleaseNetwork(networkName) {
  const network = releaseNetworks[networkName];
  if (!network) {
    throw releaseError(
      `network must be one of: ${Object.keys(releaseNetworks).join(", ")}`,
    );
  }
  return network;
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export function parseBigIntParameter(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]*n$/.test(value)) {
    throw releaseError(
      "maxVaultBalance must use Ignition's positive decimal bigint string format",
    );
  }
  return value.slice(0, -1);
}

export function journalBigInt(value) {
  if (value && value._kind === "bigint") return value.value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "string") {
    return String(value);
  }
  return null;
}

function assertHex(value, bytes, label) {
  const pattern = new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`);
  if (typeof value !== "string" || !pattern.test(value)) {
    throw releaseError(`${label} must be a ${bytes}-byte hex value`);
  }
}

function assertPositiveInteger(value, label, allowZero = false) {
  if (
    !Number.isSafeInteger(value) ||
    (allowZero ? Number(value) < 0 : Number(value) <= 0)
  ) {
    throw releaseError(
      `${label} must be a ${allowZero ? "non-negative" : "positive"} integer`,
    );
  }
}

function validateRuntimeBytecode(bytecode) {
  if (typeof bytecode !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(bytecode)) {
    throw releaseError("runtime bytecode must be non-empty, even-length hex");
  }
}

export function materializeRuntimeBytecode(artifact, maxVaultBalanceWei) {
  validateRuntimeBytecode(artifact.deployedBytecode);
  if (!/^[1-9][0-9]*$/.test(maxVaultBalanceWei)) {
    throw releaseError("runtime vault cap must be a positive decimal string");
  }

  const immutableGroups = Object.values(artifact.immutableReferences ?? {});
  if (immutableGroups.length !== 1 || !Array.isArray(immutableGroups[0])) {
    throw releaseError("MortalVault must have exactly one immutable reference group");
  }
  const materialized = artifact.deployedBytecode
    .slice(2)
    .toLowerCase()
    .split("");
  const encodedCap = toBeHex(BigInt(maxVaultBalanceWei), 32).slice(2);
  for (const reference of immutableGroups[0]) {
    const { start, length } = reference ?? {};
    if (
      !Number.isSafeInteger(start) ||
      start < 0 ||
      length !== 32 ||
      (start + length) * 2 > materialized.length
    ) {
      throw releaseError("artifact immutable reference is not a bounded uint256 slot");
    }
    materialized.splice(start * 2, length * 2, ...encodedCap);
  }
  return `0x${materialized.join("")}`;
}

export function expectedRuntimeBytecodeHash(artifact, maxVaultBalanceWei) {
  return keccak256(materializeRuntimeBytecode(artifact, maxVaultBalanceWei));
}

export function validateProductionArtifact(artifact, buildInfo) {
  if (artifact.contractName !== "MortalVault") {
    throw releaseError("artifact contract name must be MortalVault");
  }
  if (artifact.sourceName !== "contracts/MortalVault.sol") {
    throw releaseError("artifact source must be contracts/MortalVault.sol");
  }
  if (!String(buildInfo.solcLongVersion).startsWith("0.8.28+")) {
    throw releaseError("release artifact must use Solidity 0.8.28");
  }
  const optimizer = buildInfo.input?.settings?.optimizer;
  if (optimizer?.enabled !== true || optimizer.runs !== 200) {
    throw releaseError(
      "release artifact must enable the optimizer with exactly 200 runs",
    );
  }
  materializeRuntimeBytecode(artifact, "1");
}

export function validateReleaseManifest(
  manifest,
  networkName,
  { allowDirty = false, allowPending = false } = {},
) {
  const network = requireReleaseNetwork(networkName);
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw releaseError("manifest must be a JSON object");
  }
  if (manifest.schemaVersion !== 2) {
    throw releaseError("manifest schemaVersion must be 2");
  }
  if (
    manifest.network?.name !== networkName ||
    manifest.network?.chainId !== network.chainId
  ) {
    throw releaseError("manifest network does not match the requested network");
  }

  const deployment = manifest.deployment;
  if (
    deployment?.id !== network.deploymentId ||
    deployment?.module !== "MortalVaultModule" ||
    deployment?.futureId !== futureId
  ) {
    throw releaseError("manifest deployment identity is invalid");
  }
  try {
    if (getAddress(deployment.address) !== deployment.address) throw new Error();
  } catch {
    throw releaseError("manifest deployment address must be checksummed");
  }
  assertHex(deployment.transactionHash, 32, "deployment transaction hash");
  assertHex(deployment.blockHash, 32, "deployment block hash");
  assertPositiveInteger(deployment.blockNumber, "deployment block number", true);

  const contract = manifest.contract;
  if (
    contract?.name !== "MortalVault" ||
    contract?.source !== "contracts/MortalVault.sol"
  ) {
    throw releaseError("manifest contract identity is invalid");
  }
  if (!/^[1-9][0-9]*$/.test(contract.constructorArguments?.maxVaultBalanceWei)) {
    throw releaseError("manifest constructor cap must be a positive decimal string");
  }
  assertHex(contract.creationBytecodeKeccak256, 32, "creation bytecode hash");
  assertHex(
    contract.runtimeBytecodeKeccak256,
    32,
    "runtime bytecode hash",
  );

  const build = manifest.build;
  if (
    build?.profile !== "production" ||
    typeof build.buildInfoId !== "string" ||
    !build.buildInfoId ||
    !String(build.solcVersion).startsWith("0.8.28+") ||
    build.optimizer?.enabled !== true ||
    build.optimizer?.runs !== 200
  ) {
    throw releaseError("manifest build is not the required production build");
  }
  if (typeof build.gitCommit !== "string" || !/^[0-9a-f]{40}$/.test(build.gitCommit)) {
    throw releaseError("release git commit must be a 40-character hash");
  }
  if (build.gitDirty !== false && !allowDirty) {
    throw releaseError("dirty release manifests are not permitted");
  }

  const verification = manifest.verification;
  if (!Array.isArray(verification?.providers) || verification.providers.length === 0) {
    throw releaseError("manifest must list at least one verification provider");
  }
  if (verification.status !== "verified" && !allowPending) {
    throw releaseError("contract source verification is not complete");
  }
  if (!["pending", "verified"].includes(verification.status)) {
    throw releaseError("manifest verification status is invalid");
  }
  return network;
}

export function getGitReleaseState() {
  const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
  const gitStatus = execFileSync("git", ["status", "--porcelain"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
  return { gitCommit, gitStatus };
}

export function assertManifestGitCommitExists(gitCommit) {
  try {
    execFileSync("git", ["cat-file", "-e", `${gitCommit}^{commit}`], {
      cwd: repositoryRoot,
      stdio: "ignore",
    });
  } catch {
    throw releaseError(`release commit ${gitCommit} is not present locally`);
  }
}

export function appEnvironmentEntries(network, manifest) {
  const entries = [
    [network.appAddressEnvironmentVariable, manifest.deployment.address],
  ];
  if (network.appBlockEnvironmentVariable) {
    entries.push([
      network.appBlockEnvironmentVariable,
      String(manifest.deployment.blockNumber),
    ]);
  }
  return entries;
}

export async function upsertEnvironmentFile(path, entries) {
  let contents = "";
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  let lines = contents ? contents.replace(/\n$/, "").split("\n") : [];
  for (const [key, value] of entries) {
    const replacement = `${key}=${value}`;
    let replaced = false;
    lines = lines.flatMap((line) => {
      if (!line.startsWith(`${key}=`)) return [line];
      if (replaced) return [];
      replaced = true;
      return [replacement];
    });
    if (!replaced) lines.push(replacement);
  }
  await writeFile(path, `${lines.join("\n")}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

export function resolveContractsPath(path) {
  return resolve(contractsRoot, path);
}

export function deploymentDirectory(deploymentId) {
  return join(contractsRoot, "ignition", "deployments", deploymentId);
}

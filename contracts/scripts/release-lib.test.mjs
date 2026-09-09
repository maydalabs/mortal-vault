import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  appEnvironmentEntries,
  getGitReleaseState,
  materializeRuntimeBytecode,
  parseBigIntParameter,
  releaseNetworks,
  upsertEnvironmentFile,
  validateProductionArtifact,
  validateReleaseManifest,
} from "./release-lib.mjs";

function manifestFixture() {
  return {
    $schema: "./manifest.schema.json",
    schemaVersion: 2,
    network: { name: "local", chainId: 31337 },
    deployment: {
      id: "localhost",
      module: "MortalVaultModule",
      futureId: "MortalVaultModule#MortalVault",
      address: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
      transactionHash: `0x${"11".repeat(32)}`,
      blockHash: `0x${"22".repeat(32)}`,
      blockNumber: 1,
    },
    contract: {
      name: "MortalVault",
      source: "contracts/MortalVault.sol",
      constructorArguments: { maxVaultBalanceWei: "1000" },
      creationBytecodeKeccak256: `0x${"33".repeat(32)}`,
      runtimeBytecodeKeccak256: `0x${"44".repeat(32)}`,
    },
    build: {
      profile: "production",
      buildInfoId: "build-id",
      solcVersion: "0.8.28+commit.7893614a",
      optimizer: { enabled: true, runs: 200 },
      gitCommit: "a".repeat(40),
      gitDirty: true,
    },
    verification: {
      status: "pending",
      providers: ["etherscan", "sourcify"],
    },
  };
}

test("materializes every immutable vault-cap reference", () => {
  const artifact = {
    deployedBytecode: `0x11223344${"00".repeat(32)}aabbccdd`,
    immutableReferences: {
      cap: [{ start: 4, length: 32 }],
    },
  };
  assert.equal(
    materializeRuntimeBytecode(artifact, "258"),
    `0x11223344${"00".repeat(30)}0102aabbccdd`,
  );
  assert.throws(
    () =>
      materializeRuntimeBytecode(
        {
          ...artifact,
          immutableReferences: { cap: [{ start: 39, length: 32 }] },
        },
        "258",
      ),
    /not a bounded uint256 slot/,
  );
});

test("accepts only positive Ignition bigint parameters", () => {
  assert.equal(parseBigIntParameter("1000000000000000000n"), "1000000000000000000");
  assert.throws(() => parseBigIntParameter("0n"), /positive decimal bigint/);
  assert.throws(() => parseBigIntParameter(1000n), /positive decimal bigint/);
});

test("rejects unverified or dirty public release evidence by default", () => {
  const manifest = manifestFixture();
  assert.throws(
    () => validateReleaseManifest(manifest, "local"),
    /dirty release manifests/,
  );
  assert.doesNotThrow(() =>
    validateReleaseManifest(manifest, "local", {
      allowDirty: true,
      allowPending: true,
    }),
  );

  manifest.build.gitDirty = false;
  assert.throws(
    () => validateReleaseManifest(manifest, "local"),
    /source verification is not complete/,
  );
  manifest.verification.status = "verified";
  assert.doesNotThrow(() => validateReleaseManifest(manifest, "local"));
});

test("rejects tampered deployment and build identities", () => {
  const manifest = manifestFixture();
  manifest.build.gitDirty = false;
  manifest.verification.status = "verified";
  manifest.network.chainId = 1;
  assert.throws(
    () => validateReleaseManifest(manifest, "local"),
    /network does not match/,
  );

  manifest.network.chainId = 31337;
  manifest.build.optimizer.runs = 999;
  assert.throws(
    () => validateReleaseManifest(manifest, "local"),
    /not the required production build/,
  );
});

test("keeps public release network metadata centralized", () => {
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(releaseNetworks)
        .filter(([name]) => name !== "local")
        .map(([name, network]) => [name, network.chainId]),
    ),
    { sepolia: 11155111, "base-sepolia": 84532, "bsc-testnet": 97 },
  );
});

test("requires the exact production compiler profile", () => {
  const artifact = {
    contractName: "MortalVault",
    sourceName: "contracts/MortalVault.sol",
    deployedBytecode: `0x${"00".repeat(32)}`,
    immutableReferences: { cap: [{ start: 0, length: 32 }] },
  };
  const buildInfo = {
    solcLongVersion: "0.8.28+commit.7893614a",
    input: { settings: { optimizer: { enabled: true, runs: 200 } } },
  };
  assert.doesNotThrow(() => validateProductionArtifact(artifact, buildInfo));
  buildInfo.input.settings.optimizer.runs = 201;
  assert.throws(
    () => validateProductionArtifact(artifact, buildInfo),
    /exactly 200 runs/,
  );
});

test("updates only the audited network's public app variables", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mortal-vault-release-"));
  const path = join(directory, ".env.local");
  try {
    await writeFile(
      path,
      [
        "UNRELATED=value",
        "NEXT_PUBLIC_MORTAL_VAULT_ADDRESS_SEPOLIA=old",
        "NEXT_PUBLIC_MORTAL_VAULT_ADDRESS_SEPOLIA=duplicate",
        "",
      ].join("\n"),
    );
    const manifest = manifestFixture();
    manifest.deployment.address = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
    manifest.deployment.blockNumber = 123;
    await upsertEnvironmentFile(
      path,
      appEnvironmentEntries(releaseNetworks.sepolia, manifest),
    );
    assert.equal(
      await readFile(path, "utf8"),
      [
        "UNRELATED=value",
        "NEXT_PUBLIC_MORTAL_VAULT_ADDRESS_SEPOLIA=0x5FbDB2315678afecb367f032d93F642f64180aa3",
        "NEXT_PUBLIC_MORTAL_VAULT_DEPLOYMENT_BLOCK_SEPOLIA=123",
        "",
      ].join("\n"),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the pre-flight and the manifest writer agree on a clean tree", () => {
  // These two gates run either side of an irreversible act. The pre-flight
  // decides whether to broadcast; write-release-manifest.mjs decides whether
  // the release is recordable, and it runs after the gas is spent. If they
  // disagree, the failure mode is a live immutable contract with no release
  // record, which the runbook says cannot be repaired in place.
  const scriptsDir = dirname(fileURLToPath(import.meta.url));
  let output;
  try {
    // No RPC configured, so later checks fail and the exit code is non-zero.
    // Only the working-tree verdict is under test here.
    output = execFileSync(
      process.execPath,
      [join(scriptsDir, "preflight-release.mjs"), "sepolia"],
      { encoding: "utf8", env: { ...process.env, SEPOLIA_RPC_URL: "" } },
    );
  } catch (error) {
    output = `${error.stdout ?? ""}`;
  }

  const treeLine = output
    .split("\n")
    .find((line) => line.includes("Working tree"));
  assert.ok(treeLine, `pre-flight printed no working-tree verdict:\n${output}`);

  const { gitStatus } = getGitReleaseState();
  const manifestWouldRefuse = Boolean(gitStatus);
  const preflightRefuses = treeLine.includes("fail");

  assert.equal(
    preflightRefuses,
    manifestWouldRefuse,
    manifestWouldRefuse
      ? `the manifest writer would refuse this tree but the pre-flight allowed it: ${treeLine}`
      : `the pre-flight refused a tree the manifest writer accepts: ${treeLine}`,
  );
});

test("the pre-flight never leaks a private key into its output", () => {
  const scriptsDir = dirname(fileURLToPath(import.meta.url));
  // A well-known public Hardhat test key, never used for real funds.
  const testKey =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  let output;
  try {
    output = execFileSync(
      process.execPath,
      [join(scriptsDir, "preflight-release.mjs"), "sepolia"],
      {
        encoding: "utf8",
        env: { ...process.env, SEPOLIA_RPC_URL: "", DEPLOYER_PRIVATE_KEY: testKey },
      },
    );
  } catch (error) {
    output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }

  assert.ok(
    !output.includes(testKey) && !output.includes(testKey.slice(2)),
    "the pre-flight printed the deployer private key",
  );
  assert.ok(
    output.includes("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"),
    `the pre-flight did not derive the deployer address:\n${output}`,
  );
});

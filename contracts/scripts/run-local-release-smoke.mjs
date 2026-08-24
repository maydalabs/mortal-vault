#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  contractsRoot,
  deploymentDirectory,
  readJson,
} from "./release-lib.mjs";

const hardhat = join(contractsRoot, "node_modules", ".bin", "hardhat");

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (!port) throw new Error("Could not allocate a local release smoke port");
  return port;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: contractsRoot,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      const result = { code, signal, output };
      if (code === 0 || options.allowFailure) resolve(result);
      else reject(new Error(`${command} failed (${code ?? signal}):\n${output}`));
    });
  });
}

async function waitForRpc(rpcUrl, nodeProcess, readNodeOutput) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (nodeProcess.exitCode !== null) {
      throw new Error(`Hardhat node exited early:\n${readNodeOutput()}`);
    }
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_chainId",
          params: [],
        }),
      });
      const payload = await response.json();
      if (payload.result === "0x7a69") return;
    } catch {
      // The node may not have bound its port yet.
    }
    await delay(100);
  }
  throw new Error(`Hardhat node did not become ready:\n${readNodeOutput()}`);
}

async function main() {
  const port = await availablePort();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const deploymentId = `release-smoke-${process.pid}-${Date.now()}`;
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "mortal-vault-release-smoke-"),
  );
  const manifestPath = join(temporaryDirectory, "local.json");
  const tamperedManifestPath = join(temporaryDirectory, "tampered.json");
  const appEnvironmentPath = join(temporaryDirectory, ".env.local");
  const environment = { ...process.env, LOCALHOST_RPC_URL: rpcUrl };
  let nodeOutput = "";
  const nodeProcess = spawn(
    hardhat,
    ["node", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: contractsRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  nodeProcess.stdout.on("data", (chunk) => {
    nodeOutput += chunk;
  });
  nodeProcess.stderr.on("data", (chunk) => {
    nodeOutput += chunk;
  });

  try {
    await waitForRpc(rpcUrl, nodeProcess, () => nodeOutput);
    await run(
      hardhat,
      [
        "--build-profile",
        "production",
        "ignition",
        "deploy",
        "ignition/modules/MortalVault.ts",
        "--network",
        "localhost",
        "--deployment-id",
        deploymentId,
        "--parameters",
        "ignition/parameters/local.json",
      ],
      { env: environment },
    );
    await run(
      process.execPath,
      [
        "scripts/write-release-manifest.mjs",
        "local",
        "--allow-dirty",
        "--deployment-id",
        deploymentId,
        "--output",
        manifestPath,
      ],
      { env: environment },
    );
    const audit = await run(
      process.execPath,
      [
        "scripts/audit-release.mjs",
        "local",
        "--allow-dirty",
        "--allow-pending",
        "--rpc-url",
        rpcUrl,
        "--manifest",
        manifestPath,
        "--confirmations",
        "0",
        "--app-env",
        appEnvironmentPath,
      ],
      { env: environment },
    );
    if (!audit.output.includes('"status": "passed"')) {
      throw new Error(`Release audit did not report success:\n${audit.output}`);
    }

    const manifest = await readJson(manifestPath);
    manifest.contract.constructorArguments.maxVaultBalanceWei = (
      BigInt(manifest.contract.constructorArguments.maxVaultBalanceWei) + 1n
    ).toString();
    await writeFile(
      tamperedManifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    const tamperedAudit = await run(
      process.execPath,
      [
        "scripts/audit-release.mjs",
        "local",
        "--allow-dirty",
        "--allow-pending",
        "--rpc-url",
        rpcUrl,
        "--manifest",
        tamperedManifestPath,
        "--confirmations",
        "0",
      ],
      { env: environment, allowFailure: true },
    );
    if (
      tamperedAudit.code === 0 ||
      !tamperedAudit.output.includes(
        "manifest vault cap does not match checked-in parameters",
      )
    ) {
      throw new Error(
        `Tampered constructor cap was not rejected correctly:\n${tamperedAudit.output}`,
      );
    }

    const receiptTamperedManifest = await readJson(manifestPath);
    receiptTamperedManifest.deployment.blockHash = `0x${"00".repeat(32)}`;
    await writeFile(
      tamperedManifestPath,
      `${JSON.stringify(receiptTamperedManifest, null, 2)}\n`,
    );
    const receiptTamperedAudit = await run(
      process.execPath,
      [
        "scripts/audit-release.mjs",
        "local",
        "--allow-dirty",
        "--allow-pending",
        "--rpc-url",
        rpcUrl,
        "--manifest",
        tamperedManifestPath,
        "--confirmations",
        "0",
      ],
      { env: environment, allowFailure: true },
    );
    if (
      receiptTamperedAudit.code === 0 ||
      !receiptTamperedAudit.output.includes(
        "live deployment receipt does not match",
      )
    ) {
      throw new Error(
        `Tampered receipt block was not rejected correctly:\n${receiptTamperedAudit.output}`,
      );
    }

    const appEnvironment = await readFile(appEnvironmentPath, "utf8");
    if (
      !appEnvironment.includes(
        `NEXT_PUBLIC_MORTAL_VAULT_ADDRESS_LOCAL=${manifest.deployment.address}`,
      )
    ) {
      throw new Error("Audited app environment did not contain the deployment");
    }
    console.log(
      `Local release smoke passed for ${manifest.deployment.address} at block ${manifest.deployment.blockNumber}`,
    );
  } finally {
    if (nodeProcess.exitCode === null) {
      nodeProcess.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => nodeProcess.once("exit", resolve)),
        delay(2_000),
      ]);
    }
    await rm(deploymentDirectory(deploymentId), {
      recursive: true,
      force: true,
    });
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

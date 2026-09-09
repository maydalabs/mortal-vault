import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Interface } from "ethers";

/**
 * The frontend does not import the compiled artifact. It carries its own
 * hand-written copy of the ABI, and nothing has ever compared the two.
 *
 * That is worse than it sounds, because the drift is silent in both
 * directions. Event topic hashes derived from those strings are what
 * `eth_getLogs` filters on, so a changed event signature does not raise an
 * error — the logs are simply never returned, and the vault's history appears
 * empty. A changed function selector reverts every owner transaction. A
 * reordered `getVault` tuple mis-decodes the timestamps that the countdown and
 * the printed beneficiary guide are built from, with no error anywhere.
 *
 * Every existing frontend test builds its fixtures from that same array, so
 * the suite agrees with itself no matter how far it has drifted from the
 * contract. This is the only check that compares it to the real thing.
 */

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const contractsRoot = resolve(scriptsDir, "..");
const repositoryRoot = resolve(contractsRoot, "..");

async function appInterface() {
  const source = await readFile(
    join(repositoryRoot, "app/lib/mortal-vault.ts"),
    "utf8",
  );
  const start = source.indexOf("MORTAL_VAULT_ABI = [");
  assert.notEqual(start, -1, "MORTAL_VAULT_ABI not found in app/lib/mortal-vault.ts");
  const end = source.indexOf("]", start);
  const body = source.slice(start, end);

  const fragments = [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(
    fragments.length > 10,
    `expected the app ABI to hold many fragments, found ${fragments.length}`,
  );
  return { iface: new Interface(fragments), fragments };
}

async function artifactInterface() {
  const path = join(
    contractsRoot,
    "artifacts/contracts/MortalVault.sol/MortalVault.json",
  );
  let artifact;
  try {
    artifact = JSON.parse(await readFile(path, "utf8"));
  } catch {
    assert.fail(
      `no compiled artifact at ${path}. Run \`npm run compile\` in contracts/ first.`,
    );
  }
  return new Interface(artifact.abi);
}

test("every function the app calls exists on the contract, with the same selector", async () => {
  const { iface } = await appInterface();
  const compiled = await artifactInterface();

  const compiledSelectors = new Map();
  compiled.forEachFunction((fragment) => {
    compiledSelectors.set(fragment.selector, fragment.format("full"));
  });

  const missing = [];
  iface.forEachFunction((fragment) => {
    if (!compiledSelectors.has(fragment.selector)) {
      missing.push(`${fragment.format("full")} (selector ${fragment.selector})`);
    }
  });

  assert.deepEqual(
    missing,
    [],
    `the app would call functions the contract does not have, and every such ` +
      `call reverts:\n  ${missing.join("\n  ")}`,
  );
});

test("every event the app filters on exists on the contract, with the same topic", async () => {
  const { iface } = await appInterface();
  const compiled = await artifactInterface();

  const compiledTopics = new Map();
  compiled.forEachEvent((fragment) => {
    compiledTopics.set(fragment.topicHash, fragment.format("full"));
  });

  const missing = [];
  iface.forEachEvent((fragment) => {
    if (!compiledTopics.has(fragment.topicHash)) {
      missing.push(`${fragment.format("full")} (topic ${fragment.topicHash})`);
    }
  });

  // A wrong topic hash returns no logs rather than an error, so the vault's
  // history would just look empty.
  assert.deepEqual(
    missing,
    [],
    `the app filters logs on topics the contract never emits, so those events ` +
      `would silently never appear:\n  ${missing.join("\n  ")}`,
  );
});

test("indexed event parameters match, so decoded fields are not transposed", async () => {
  const { iface } = await appInterface();
  const compiled = await artifactInterface();

  const compiledEvents = new Map();
  compiled.forEachEvent((fragment) => {
    compiledEvents.set(fragment.name, fragment);
  });

  const mismatches = [];
  iface.forEachEvent((fragment) => {
    const other = compiledEvents.get(fragment.name);
    if (!other) return; // covered by the topic test above
    const appShape = fragment.inputs.map((i) => `${i.type}${i.indexed ? " indexed" : ""}`);
    const realShape = other.inputs.map((i) => `${i.type}${i.indexed ? " indexed" : ""}`);
    if (appShape.join(",") !== realShape.join(",")) {
      mismatches.push(`${fragment.name}: app has ${appShape}, contract has ${realShape}`);
    }
  });

  assert.deepEqual(mismatches, [], mismatches.join("\n  "));
});

test("the getVault tuple decodes in the contract's order", async () => {
  const { iface } = await appInterface();
  const compiled = await artifactInterface();

  const appShape = iface
    .getFunction("getVault")
    .outputs.map((output) => `${output.name}:${output.type}`);
  const realShape = compiled
    .getFunction("getVault")
    .outputs.map((output) => `${output.name}:${output.type}`);

  // Reordering two same-typed fields here changes no selector and raises no
  // error; it silently swaps values. lastHeartbeat and claimRequestedAt are
  // both uint256 and adjacent, and the countdown and the printed heir guide
  // are computed from them.
  assert.deepEqual(
    appShape,
    realShape,
    "the app decodes getVault in a different order than the contract returns it",
  );
});

test("the app carries every error the contract can revert with", async () => {
  const { iface } = await appInterface();
  const compiled = await artifactInterface();

  const appErrors = new Set();
  iface.forEachError((fragment) => appErrors.add(fragment.selector));

  const unhandled = [];
  compiled.forEachError((fragment) => {
    if (!appErrors.has(fragment.selector)) unhandled.push(fragment.format("full"));
  });

  // Without the fragment the app cannot name the revert, so the user is shown
  // an unreadable failure instead of a reason.
  assert.deepEqual(
    unhandled,
    [],
    `the contract can revert with errors the app cannot decode:\n  ${unhandled.join("\n  ")}`,
  );
});

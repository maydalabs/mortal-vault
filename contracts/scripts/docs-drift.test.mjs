import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * docs/test-scenarios.md claims each behaviour is held in place by a named
 * test. That claim is only worth something if the names are real.
 *
 * The document previously described an earlier design in which a beneficiary
 * called `claim` and received the balance immediately — no request, no
 * challenge period, which is the whole product. It said so for months because
 * nothing ever compared it to the code. This is that comparison.
 */

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const contractsRoot = resolve(scriptsDir, "..");
const repositoryRoot = resolve(contractsRoot, "..");

const TEST_SOURCES = [
  "contracts/test/MortalVault.ts",
  "contracts/test/MortalVault.lifecycle.spec.ts",
  "contracts/contracts/MortalVault.security.t.sol",
];

/** Backticked text that is prose, a command, or a code fragment, not a test. */
function looksLikeATestName(value) {
  if (value.includes("(") || value.includes("/")) return false;
  if (value.startsWith("npm ") || value.startsWith("`")) return false;
  if (/^(test_|testFuzz_|invariant_)/.test(value)) return true;
  // Mocha titles: several lowercase words, as they read in the source.
  return value.includes(" ") && /^[a-z]/.test(value);
}

async function readSources() {
  const parts = await Promise.all(
    TEST_SOURCES.map((path) => readFile(join(repositoryRoot, path), "utf8")),
  );
  return parts.join("\n");
}

test("every test named in docs/test-scenarios.md exists", async () => {
  const doc = await readFile(
    join(repositoryRoot, "docs/test-scenarios.md"),
    "utf8",
  );
  const sources = await readSources();

  const cited = [...new Set([...doc.matchAll(/`([^`]+)`/g)].map((m) => m[1]))]
    .filter(looksLikeATestName);

  assert.ok(
    cited.length > 20,
    `expected the document to cite many tests, found ${cited.length}. ` +
      "If the citation format changed, update looksLikeATestName.",
  );

  const missing = cited.filter((name) => !sources.includes(name));
  assert.deepEqual(
    missing,
    [],
    `docs/test-scenarios.md names tests that do not exist:\n  ${missing.join("\n  ")}`,
  );
});

test("the scenarios document describes the challenge period, not an instant claim", async () => {
  const doc = await readFile(
    join(repositoryRoot, "docs/test-scenarios.md"),
    "utf8",
  );

  // The specific regression: an earlier draft had the beneficiary receiving the
  // balance on request. Anyone reading that concludes the design is unsafe.
  assert.match(
    doc,
    /challenge period/i,
    "the scenarios must describe the challenge period between request and execution",
  );
  assert.doesNotMatch(
    doc.replace(/^>.*$/gm, ""), // the note explaining the old wording is fine
    /beneficiary calls claim and receives/i,
    "the scenarios describe a claim with no request step or delay",
  );
});

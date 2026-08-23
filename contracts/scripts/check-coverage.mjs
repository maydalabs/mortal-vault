import { readFileSync } from "node:fs";

const report = readFileSync(new URL("../coverage/lcov.info", import.meta.url), "utf8");
const found = [...report.matchAll(/^LF:(\d+)$/gm)].reduce(
  (sum, match) => sum + Number(match[1]),
  0,
);
const hit = [...report.matchAll(/^LH:(\d+)$/gm)].reduce(
  (sum, match) => sum + Number(match[1]),
  0,
);

if (found === 0) {
  throw new Error("Coverage report contains no instrumented Solidity lines.");
}

const percentage = (hit / found) * 100;
const minimum = 100;

if (percentage < minimum) {
  throw new Error(
    `Solidity line coverage ${percentage.toFixed(2)}% is below ${minimum}%.`,
  );
}

console.log(`Solidity line coverage threshold met: ${percentage.toFixed(2)}%.`);

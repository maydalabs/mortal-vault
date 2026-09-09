import { describe, expect, it } from "vitest";

import {
  buildHeirGuide,
  formatGuideDate,
  formatGuideDays,
  type HeirGuideInput,
} from "./heir-guide";

const DAY = 86_400;

const INPUT: HeirGuideInput = {
  ownerAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  beneficiaryAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  beneficiaryLabel: "Deniz",
  chainName: "Ethereum Sepolia",
  contractAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  explorerUrl: "https://sepolia.etherscan.io",
  claimUrl: "https://vault.example/?claim=0xf39Fd6",
  timeoutSeconds: 180 * DAY,
  claimDelaySeconds: 60 * DAY,
  lastHeartbeat: Date.UTC(2026, 0, 1) / 1000,
  balanceLabel: "2.5 ETH",
  generatedAt: Date.UTC(2026, 0, 15) / 1000,
};

describe("formatGuideDays", () => {
  it("names whole and partial days", () => {
    expect(formatGuideDays(DAY)).toBe("1 day");
    expect(formatGuideDays(180 * DAY)).toBe("180 days");
    expect(formatGuideDays(DAY * 1.5)).toBe("1.5 days");
  });
});

describe("formatGuideDate", () => {
  it("writes an unambiguous date rather than a numeric one", () => {
    expect(formatGuideDate(Date.UTC(2026, 6, 4) / 1000)).toBe("4 July 2026");
  });
});

describe("buildHeirGuide", () => {
  it("dates the earliest claim from the last heartbeat, not from today", () => {
    const guide = buildHeirGuide(INPUT);

    // 1 Jan 2026 + 180 days, then + 60 more.
    expect(guide.timing.earliestRequest).toBe("30 June 2026");
    expect(guide.timing.earliestExecution).toBe("29 August 2026");
    expect(guide.timing.caveat).toContain("180 days");
  });

  it("puts both addresses in the facts and says only one wallet can claim", () => {
    const guide = buildHeirGuide(INPUT);
    const owner = guide.facts.find((fact) => fact.value === INPUT.ownerAddress);
    const heir = guide.facts.find(
      (fact) => fact.value === INPUT.beneficiaryAddress,
    );

    expect(owner?.mono).toBe(true);
    expect(heir?.note).toMatch(/Only this wallet can claim/);
  });

  it("uses the nickname when there is one and stays readable without", () => {
    expect(buildHeirGuide(INPUT).intro).toContain("Deniz");

    const anonymous = buildHeirGuide({ ...INPUT, beneficiaryLabel: null });
    expect(anonymous.intro).toContain("you can claim");
    expect(anonymous.intro).not.toContain("null");

    const blank = buildHeirGuide({ ...INPUT, beneficiaryLabel: "   " });
    expect(blank.intro).toContain("you can claim");
  });

  it("orders the steps so waiting comes before wallet access and claiming", () => {
    const titles = buildHeirGuide(INPUT).steps.map((step) => step.title);
    expect(titles[0]).toMatch(/Wait/);
    expect(titles[1]).toMatch(/wallet/);
    expect(titles.at(-1)).toMatch(/Finish the claim after 60 days/);
  });

  it("tells the heir the vault outlives the website", () => {
    const guide = buildHeirGuide(INPUT);
    const step = guide.steps[2].body;
    // The site may be gone by the time this page is read; the contract is not.
    expect(step).toContain(INPUT.contractAddress);
    expect(step).toMatch(/requestClaim/);
    expect(step).toMatch(/executeClaim/);
    expect(step).toMatch(/block explorer/i);
  });

  it("falls back to app instructions when there is no claim link", () => {
    const guide = buildHeirGuide({ ...INPUT, claimUrl: undefined });
    expect(guide.steps[2].body).toContain("Open the Mortal Vault app");
    expect(guide.steps[2].body).toContain("Ethereum Sepolia");
  });

  it("warns against claiming from a living owner before anything else", () => {
    const [first, ...rest] = buildHeirGuide(INPUT).warnings;
    expect(first).toMatch(/If the owner is alive, stop/);
    expect(rest.join(" ")).toMatch(/unaudited/);
  });

  it("never claims a legal or tax effect the contract cannot deliver", () => {
    const guide = buildHeirGuide(INPUT);
    const prose = JSON.stringify(guide).toLowerCase();

    for (const forbidden of [
      "avoid probate",
      "outside your estate",
      "tax-free",
      "tax free",
      "legally binding",
      "this is a will",
    ]) {
      expect(prose).not.toContain(forbidden);
    }
    expect(prose).toContain("does not decide who legally inherits");
  });

  it("stamps the date and offers independent verification", () => {
    const guide = buildHeirGuide(INPUT);
    expect(guide.footer).toContain("15 January 2026");
    expect(guide.footer).toContain(
      "https://sepolia.etherscan.io/address/0x5FbDB2315678afecb367f032d93F642f64180aa3",
    );

    const noExplorer = buildHeirGuide({ ...INPUT, explorerUrl: undefined });
    expect(noExplorer.footer).toContain("15 January 2026");
    expect(noExplorer.footer).not.toContain("undefined");
  });
});

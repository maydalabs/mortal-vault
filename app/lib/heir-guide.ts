const SECONDS_PER_DAY = 86_400;

export type HeirGuideInput = {
  ownerAddress: string;
  beneficiaryAddress: string;
  /** Device-local nickname, if the owner set one. */
  beneficiaryLabel?: string | null;
  chainName: string;
  contractAddress: string;
  explorerUrl?: string;
  /** Where the beneficiary opens the vault, including the claim query. */
  claimUrl?: string;
  timeoutSeconds: number;
  claimDelaySeconds: number;
  /** Owner's last recorded activity, in unix seconds. */
  lastHeartbeat: number;
  /** Balance at the moment of writing, formatted by the caller. */
  balanceLabel: string;
  generatedAt: number;
};

export type HeirGuideFact = {
  label: string;
  value: string;
  /** Addresses and hashes are rendered in a monospace face. */
  mono?: boolean;
  note?: string;
};

export type HeirGuideStep = {
  title: string;
  body: string;
};

export type HeirGuide = {
  heading: string;
  intro: string;
  facts: HeirGuideFact[];
  timing: {
    earliestRequest: string;
    earliestExecution: string;
    caveat: string;
  };
  steps: HeirGuideStep[];
  warnings: string[];
  footer: string;
};

export function formatGuideDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatGuideDays(seconds: number): string {
  const days = Math.round((seconds / SECONDS_PER_DAY) * 10) / 10;
  return `${days} day${days === 1 ? "" : "s"}`;
}

/**
 * Builds the page an owner prints and leaves with the person who will need it.
 *
 * It is written for someone who has never used a wallet, may be reading it on
 * the worst day of their life, and cannot ask the author any questions. So it
 * states the two addresses that matter, the order of operations, and what will
 * not work, and it never claims a legal effect the contract cannot deliver.
 */
export function buildHeirGuide({
  ownerAddress,
  beneficiaryAddress,
  beneficiaryLabel,
  chainName,
  contractAddress,
  explorerUrl,
  claimUrl,
  timeoutSeconds,
  claimDelaySeconds,
  lastHeartbeat,
  balanceLabel,
  generatedAt,
}: HeirGuideInput): HeirGuide {
  const name = beneficiaryLabel?.trim() || "you";
  const quietPeriod = formatGuideDays(timeoutSeconds);
  const countdown = formatGuideDays(claimDelaySeconds);
  const earliestRequestAt = lastHeartbeat + timeoutSeconds;
  const earliestExecutionAt = earliestRequestAt + claimDelaySeconds;

  const facts: HeirGuideFact[] = [
    {
      label: "The vault belongs to",
      value: ownerAddress,
      mono: true,
      note: "You will be asked for this address. It identifies the vault.",
    },
    {
      label: "It can only be claimed by",
      value: beneficiaryAddress,
      mono: true,
      note: "Only this wallet can claim. No other wallet will work, and nobody can change that for you.",
    },
    { label: "Network", value: chainName },
    { label: "Contract", value: contractAddress, mono: true },
    {
      label: "Held in the vault",
      value: balanceLabel,
      note: "As of the date this page was written. The owner can add or withdraw at any time.",
    },
    {
      label: "Quiet period",
      value: quietPeriod,
      note: "How long the owner must be silent before a claim can start.",
    },
    {
      label: "Claim countdown",
      value: countdown,
      note: "How long after a claim starts before the funds can be moved.",
    },
  ];

  const steps: HeirGuideStep[] = [
    {
      title: "Wait for the quiet period to pass",
      body: `Nothing can be claimed while the owner is still checking in. Every check-in resets the clock. The vault becomes claimable only after ${quietPeriod} of complete silence.`,
    },
    {
      title: "Get access to the wallet named above",
      body: `You need the wallet at ${beneficiaryAddress}. If that wallet is a phone app or a browser extension, you need whatever unlocks it. Without this wallet nothing else on this page will work, so confirm you can open it before you need it.`,
    },
    {
      title: "Open the vault page",
      // A guide printed today may be read years from now, when the website has
      // gone. The vault has not gone: it is the contract, and it can be
      // operated directly. Saying so here is the difference between an
      // inheritance that survives this project and one that does not.
      body:
        (claimUrl
          ? `Go to ${claimUrl}. Connect the wallet above, and make sure the network is set to ${chainName}.`
          : `Open the Mortal Vault app, connect the wallet above, switch the network to ${chainName}, and look up the owner's address.`) +
        ` If that page will not open, nothing is lost. The vault is the contract at ${contractAddress} on ${chainName}, and it can be used directly from a block explorer's contract tab — call requestClaim with the owner's address, wait, then executeClaim. Any developer can do this for you; none of it is secret, and none of it needs permission from anyone.`,
    },
    {
      title: "Start the claim",
      body: `Choose to request the claim. This starts a ${countdown} countdown and costs a small network fee. The owner can still cancel it by checking in — that is deliberate, and it is what protects them if they are alive and simply unreachable.`,
    },
    {
      title: `Finish the claim after ${countdown}`,
      body: "Return once the countdown has finished and complete the claim. The balance moves to your wallet, or to another address you choose at that moment. Nothing happens automatically: someone has to press the button.",
    },
  ];

  const warnings = [
    "If the owner is alive, stop. Claiming a vault from a living owner may be theft where you live, and tax authorities may treat it as a gift you have to pay for. The waiting periods exist so that a mistake can still be corrected.",
    "This page does not decide who legally inherits. Local inheritance law still applies, other relatives may have claims against you, and a court can order you to hand back what you receive. Talk to a lawyer before spending it.",
    "This software is unaudited beta software and can contain mistakes.",
    "Nobody can recover the wallet above for you. Not the owner, not the developers. There is no support line and no password reset.",
  ];

  return {
    heading: "If I go quiet, this is what to do",
    intro: `This page explains how ${name} can claim a Mortal Vault after its owner stops checking in. It was written by the owner, for one specific person, and it only works with the exact wallet named below. Keep it somewhere ${name} will find it.`,
    facts,
    timing: {
      earliestRequest: formatGuideDate(earliestRequestAt),
      earliestExecution: formatGuideDate(earliestExecutionAt),
      caveat: `These dates assume the owner never checks in again. Every check-in pushes both dates later by the full ${quietPeriod}, which is exactly what should happen while they are well.`,
    },
    steps,
    warnings,
    footer: explorerUrl
      ? `Written on ${formatGuideDate(generatedAt)}. Anyone can verify the contract at ${explorerUrl}/address/${contractAddress}. If the owner changes the plan, this page is out of date and should be printed again.`
      : `Written on ${formatGuideDate(generatedAt)}. If the owner changes the plan, this page is out of date and should be printed again.`,
  };
}

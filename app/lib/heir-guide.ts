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
      note: "As of the date this page was written. The owner can add or withdraw funds while the vault remains active or a claim is pending, before execution.",
    },
    {
      label: "Quiet period",
      value: quietPeriod,
      note: "How long the owner must be silent before a claim can start.",
    },
    {
      label: "Claim countdown",
      value: countdown,
      note: "How long after a claim request is confirmed before the beneficiary can execute it.",
    },
  ];

  const steps: HeirGuideStep[] = [
    {
      title: "Wait for the quiet period to pass",
      body: `A successful check-in resets the clock. After ${quietPeriod} without owner activity, you can request a claim. Inactivity alone does not let you execute it or move any funds.`,
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
        ` If that page will not open, the vault is still the contract at ${contractAddress} on ${chainName}. From a block explorer's contract tab, use the beneficiary wallet to call requestClaim with the owner's address, wait for the claim delay, then call executeClaim in a separate transaction. A developer can explain the steps, but both transactions require the beneficiary wallet.`,
    },
    {
      title: "Start the claim",
      body: `Send a claim-request transaction from the beneficiary wallet. Its confirmation starts a ${countdown} countdown and costs a network fee. A successful owner check-in cancels the pending claim before execution.`,
    },
    {
      title: `Finish the claim after ${countdown}`,
      body: "After the countdown, recheck the vault and send a separate execution transaction from the beneficiary wallet. If it succeeds, the balance moves to your wallet or another address you choose. After the delay, the first valid transaction confirmed on-chain wins: the owner's cancellation or your execution. Nothing transfers automatically.",
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
      caveat: `Earliest possible dates: no further owner activity, and a request as soon as the ${quietPeriod} quiet period passes. The ${countdown} delay starts when the request is confirmed; requesting later postpones execution. The beneficiary must still send an execution transaction.`,
    },
    steps,
    warnings,
    footer: explorerUrl
      ? `Written on ${formatGuideDate(generatedAt)}. Anyone can verify the contract at ${explorerUrl}/address/${contractAddress}. If the owner changes the plan, this page is out of date and should be printed again.`
      : `Written on ${formatGuideDate(generatedAt)}. If the owner changes the plan, this page is out of date and should be printed again.`,
  };
}

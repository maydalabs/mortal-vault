import type { Constellation } from "@/lib/constellation";

type LandingProps = {
  busy: boolean;
  chainName: string | null;
  constellation: Constellation | null;
  onConnect: () => void;
};

// TODO: point this at your verified contract (Etherscan) or public repo to show
// the "read the contract" trust link. Leave empty to hide it.
const CONTRACT_URL = "";

const TRUST = ["Non-custodial", "Time-locked", "Cancel anytime", "You hold the keys"] as const;

const STEPS = [
  {
    title: "Create a vault, check in when you like",
    description:
      "Deposit, name a beneficiary, and set your own rhythm. A check-in is one quick signed action — it proves you're still around and resets the clock.",
  },
  {
    title: "If you go quiet, they can start a claim",
    description:
      "Only after your chosen quiet period passes can your beneficiary begin — and it opens a countdown, not an instant transfer.",
  },
  {
    title: "One check-in from you cancels everything",
    description:
      "Through the whole countdown the vault still answers to you. Funds move only if you never come back.",
  },
] as const;

const GUARANTEES = [
  {
    title: "We can never touch your funds",
    description:
      "The vault is a smart contract you alone control — no admin keys, no backdoor, no custody by us.",
  },
  {
    title: "No surprise claims",
    description:
      "A beneficiary can only begin after your quiet period, and it's a cancellable countdown — never an instant transfer.",
  },
  {
    title: "You stay in control",
    description:
      "Any check-in resets the timer. Nothing moves unless you truly, permanently go dark.",
  },
] as const;

export function Landing({ busy, chainName, constellation, onConnect }: LandingProps) {
  const stars = constellation?.stars ?? [];

  return (
    <div className="relative mx-auto flex w-full max-w-[880px] flex-col gap-14 px-6 pb-16 pt-8 text-center md:pt-12">
      {/* Beta / testnet notice — surfaced, not buried in the footer */}
      <div className="rise rise-1 mx-auto flex items-center gap-2 rounded-full border border-hairline-strong bg-panel/60 px-3.5 py-1.5 text-[11px] tracking-[0.03em] text-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" />
        Unaudited beta on testnets — test funds only. Not a legal will.
      </div>

      {/* Hero */}
      <div className="relative isolate flex flex-col items-center gap-6">
        {/* legibility wash so the copy lifts off the starfield */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[150%] w-[150%] -translate-x-1/2 -translate-y-1/2"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(6,9,15,0.78) 0%, rgba(6,9,15,0.45) 46%, transparent 74%)",
          }}
        />
        <div className="rise rise-1 font-mono text-[11px] font-medium tracking-[0.3em] text-gold">
          SELF-CUSTODIAL CONTINUITY
        </div>
        <h1 className="rise rise-2 font-serif text-3xl font-light leading-[1.2] text-parchment md:text-[42px]">
          What you keep safe shouldn&apos;t die with your keys.
        </h1>
        <p className="rise rise-3 max-w-[560px] text-base leading-relaxed text-muted">
          The chain is immortal. You are not. Mortal Vault keeps a light burning for
          you — and passes it to someone you trust only if you stop checking in.
        </p>
        <p className="rise rise-3 max-w-[600px] text-[15px] leading-relaxed text-parchment/85">
          In plain terms: deposit crypto, name a beneficiary, and check in on your own
          schedule. If you ever go dark past a delay{" "}
          <span className="text-parchment">you</span> choose, they can start a timed
          claim — and a single check-in from you cancels it.
        </p>

        {/* Dual CTA — connect, or learn first */}
        <div className="rise rise-4 mt-1 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={onConnect}
            disabled={busy}
            className="inline-flex h-[48px] items-center rounded-full bg-safe px-9 text-[15px] font-semibold text-on-accent transition hover:brightness-110 disabled:opacity-50"
            style={{ boxShadow: "0 0 34px rgba(92, 224, 161, 0.35)" }}
          >
            Connect a wallet to begin
          </button>
          <button
            type="button"
            onClick={() =>
              document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" })
            }
            className="inline-flex h-[48px] items-center rounded-full border border-hairline-strong px-6 text-[15px] font-medium text-ink-soft transition hover:border-parchment/40 hover:text-parchment"
          >
            See how it works
          </button>
        </div>

        {/* Trust row — the reassurance a "hold my crypto" product lives or dies on */}
        <div className="rise rise-5 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 font-mono text-[11px] tracking-[0.08em] text-faint">
          {TRUST.map((label, index) => (
            <span key={label} className="flex items-center gap-2.5">
              {index > 0 && (
                <span aria-hidden="true" className="text-faint/50">
                  ·
                </span>
              )}
              {label}
            </span>
          ))}
        </div>

        {stars.length > 0 && chainName && (
          <p className="rise rise-5 font-mono text-[11.5px] tracking-[0.08em] text-faint">
            {stars.length} {stars.length === 1 ? "light" : "lights"} burning on{" "}
            {chainName} · every one is someone&apos;s promise
          </p>
        )}
      </div>

      {/* divider */}
      <div
        className="rise rise-6 relative -my-2 flex items-center justify-center gap-4"
        aria-hidden="true"
      >
        <div className="h-px w-16 bg-hairline-strong" />
        <div className="h-1.5 w-1.5 rotate-45 bg-gold/70" />
        <div className="h-px w-16 bg-hairline-strong" />
      </div>

      {/* Steps */}
      <div
        id="how-it-works"
        className="rise rise-6 relative grid scroll-mt-24 grid-cols-1 gap-4 text-left sm:grid-cols-3"
      >
        {STEPS.map((step, index) => (
          <div
            key={step.title}
            className="flex flex-col gap-2.5 rounded-2xl border border-hairline bg-panel/40 p-5"
          >
            <div className="flex h-[30px] w-[30px] items-center justify-center rounded-full border border-hairline-strong font-mono text-[13px] text-gold">
              {index + 1}
            </div>
            <div className="text-[14.5px] font-semibold text-ink">{step.title}</div>
            <div className="text-[13px] leading-relaxed text-muted">{step.description}</div>
          </div>
        ))}
      </div>

      {/* Your guarantees — directly answers "can I trust this with real money?" */}
      <div className="rise rise-6 flex flex-col gap-5">
        <div className="font-mono text-[11px] font-medium tracking-[0.3em] text-gold">
          YOUR GUARANTEES
        </div>
        <div className="grid grid-cols-1 gap-5 text-left sm:grid-cols-3">
          {GUARANTEES.map((item) => (
            <div key={item.title} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 text-[13.5px] font-semibold text-parchment">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#5ce0a1"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="flex-shrink-0"
                >
                  <path d="M4 12.5l5 5L20 6.5" />
                </svg>
                {item.title}
              </div>
              <div className="text-[12.5px] leading-relaxed text-muted">{item.description}</div>
            </div>
          ))}
        </div>
        {CONTRACT_URL && (
          <a
            href={CONTRACT_URL}
            target="_blank"
            rel="noreferrer"
            className="text-[12px] text-faint underline decoration-hairline-strong underline-offset-4 transition hover:text-parchment"
          >
            Open-source — read the contract yourself →
          </a>
        )}
      </div>
    </div>
  );
}

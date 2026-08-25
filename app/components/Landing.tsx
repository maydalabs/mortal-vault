type LandingProps = {
  busy: boolean;
  onConnect: () => void;
};

const STEPS = [
  {
    title: "Create a vault, check in when you like",
    description:
      "Deposit, name a beneficiary, and prove you're around with a simple check-in. Every action counts as one.",
  },
  {
    title: "If you go quiet, they can start a claim",
    description:
      "Only after your chosen quiet period passes can your beneficiary begin — and it opens a countdown, not a transfer.",
  },
  {
    title: "One check-in from you cancels everything",
    description:
      "During the whole countdown the vault still answers to you. Funds move only if you never come back.",
  },
] as const;

export function Landing({ busy, onConnect }: LandingProps) {
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-10 px-6 pb-12 pt-10 text-center md:pt-16">
      <div className="flex flex-col items-center gap-5">
        <div className="rise rise-1 text-[11px] font-semibold tracking-[0.2em] text-gold">
          SELF-CUSTODIAL CONTINUITY
        </div>
        <h1 className="rise rise-2 font-serif text-5xl font-medium leading-[1.08] text-parchment md:text-6xl">
          What you keep safe shouldn&apos;t die with your keys.
        </h1>
        <p className="rise rise-3 max-w-[560px] text-base leading-relaxed text-muted">
          Mortal Vault holds your crypto while you stay in control, and passes
          it to someone you trust only after you stop checking in — with a
          waiting period you can always cancel.
        </p>
        <button
          type="button"
          onClick={onConnect}
          disabled={busy}
          className="rise rise-4 mt-1 inline-flex h-[48px] items-center rounded-[10px] bg-safe px-8 text-[15px] font-semibold text-on-accent transition hover:brightness-110 disabled:opacity-50"
        >
          Connect a wallet to begin
        </button>
      </div>

      <div className="rise rise-5 flex items-center justify-center gap-4" aria-hidden="true">
        <div className="h-px w-16 bg-hairline-strong" />
        <div className="h-1.5 w-1.5 rotate-45 bg-gold/70" />
        <div className="h-px w-16 bg-hairline-strong" />
      </div>

      <div className="rise rise-6 grid grid-cols-1 gap-6 text-left sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <div key={step.title} className="flex flex-col gap-2.5">
            <div className="flex h-[30px] w-[30px] items-center justify-center rounded-full border border-hairline-strong font-serif text-[15px] text-gold">
              {index + 1}
            </div>
            <div className="text-[14.5px] font-semibold text-ink">{step.title}</div>
            <div className="text-[13px] leading-relaxed text-muted">{step.description}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

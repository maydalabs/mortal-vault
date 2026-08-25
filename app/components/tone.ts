export type Tone = "neutral" | "safe" | "warn" | "danger";

/** Paper-ledger palette: deep inks that read on the cream ground. */
export const TONE_HEX: Record<Tone, string> = {
  neutral: "#6e6355",
  safe: "#3e6e54",
  warn: "#9a6b10",
  danger: "#b3261e",
};

/** Text color sitting on top of a solid tone-colored button. */
export const TONE_BUTTON_TEXT: Record<Tone, string> = {
  neutral: "#f7f3e8",
  safe: "#f7f3e8",
  warn: "#f7f3e8",
  danger: "#f7f3e8",
};

/** Track color behind the countdown ring's arc. */
export const RING_TRACK = "rgba(28, 25, 23, 0.09)";

export function toneTint(tone: Tone, alpha: number): string {
  const hex = TONE_HEX[tone];
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

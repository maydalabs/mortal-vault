export type Tone = "neutral" | "safe" | "warn" | "danger";

/** The Vigil palette: aurora for alive, solar amber for warnings, ember for claims. */
export const TONE_HEX: Record<Tone, string> = {
  neutral: "#8b92a6",
  safe: "#5ce0a1",
  warn: "#e6b34d",
  danger: "#ee6a4d",
};

/** Text color sitting on top of a solid tone-colored button. */
export const TONE_BUTTON_TEXT: Record<Tone, string> = {
  neutral: "#06090f",
  safe: "#04120b",
  warn: "#140e02",
  danger: "#160804",
};

/** Track color behind the countdown arc. */
export const RING_TRACK = "rgba(238, 241, 248, 0.08)";

export function toneTint(tone: Tone, alpha: number): string {
  const hex = TONE_HEX[tone];
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

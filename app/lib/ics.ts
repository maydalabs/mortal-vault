const SECONDS_PER_DAY = 86_400;

/**
 * RFC 5545 escaping for TEXT values. Backslash first, or it would escape the
 * backslashes the later rules add.
 *
 * Note that `";"` must be written `"\\;"` in a JavaScript string. `"\;"` is
 * not an escape sequence, so it collapses to a bare semicolon and silently
 * does nothing — which is what this used to do.
 */
const escapeText = (value: string): string =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");

const stamp = (unixSeconds: number): string => {
  const date = new Date(unixSeconds * 1000);
  const two = (part: number) => String(part).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${two(date.getUTCMonth() + 1)}${two(date.getUTCDate())}` +
    `T${two(date.getUTCHours())}${two(date.getUTCMinutes())}${two(date.getUTCSeconds())}Z`
  );
};

/** Seconds before the deadline at which the calendar event is placed. */
export const CHECK_IN_LEAD_SECONDS = 3 * SECONDS_PER_DAY;

export type CheckInIcsOptions = {
  /** When the quiet period currently ends, in unix seconds. */
  dueAt: number;
  url: string;
  /**
   * The vault's quiet period. Given one, the reminder repeats on that cadence
   * instead of firing once and vanishing.
   */
  intervalSeconds?: number;
  /**
   * Stable identity for this vault, normally the owner's address. Calendars key
   * on UID, so a stable one means a re-downloaded file updates the existing
   * reminder rather than stacking another copy beside it.
   */
  vaultId?: string;
  now?: number;
};

/**
 * An iCalendar reminder to check in, placed a few days before the quiet period
 * ends and repeating for as long as the vault exists.
 *
 * The repetition is the point. A single event is consumed by the first
 * check-in: the deadline moves a whole quiet period into the future and the
 * calendar, having already fired, says nothing ever again. On a mechanism that
 * decides whether the vault stays with its owner, a reminder that works once
 * is barely better than no reminder.
 *
 * The recurrence drifts if the owner checks in early or late, so the series is
 * an approximation of the deadline rather than the deadline itself. It is
 * still strictly better than silence, and the app remains the authority.
 */
export function buildCheckInIcs({
  dueAt,
  url,
  intervalSeconds,
  vaultId,
  now: nowOption,
}: CheckInIcsOptions): string {
  const now = nowOption ?? Math.floor(Date.now() / 1000);
  const eventAt = Math.max(now, dueAt - CHECK_IN_LEAD_SECONDS);
  const dueText = new Date(dueAt * 1000).toUTCString();

  const intervalDays =
    intervalSeconds && intervalSeconds >= SECONDS_PER_DAY
      ? Math.round(intervalSeconds / SECONDS_PER_DAY)
      : null;

  const description = intervalDays
    ? `Your quiet period ends ${dueText}. One check-in resets it, and moves this reminder on by about ${intervalDays} days: ${url}`
    : `Your quiet period ends ${dueText}. One check-in resets it: ${url}`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Mortal Vault//Check-in//EN",
    "BEGIN:VEVENT",
    `UID:mortal-vault-checkin-${vaultId ?? "vault"}@mortalvault`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(eventAt)}`,
    `DTEND:${stamp(eventAt + 1800)}`,
  ];

  // RRULE is a structured value, not TEXT, so its semicolons are separators
  // and must not be escaped.
  if (intervalDays) lines.push(`RRULE:FREQ=DAILY;INTERVAL=${intervalDays}`);

  lines.push(
    `SUMMARY:${escapeText("Mortal Vault — time to check in")}`,
    `DESCRIPTION:${escapeText(description)}`,
    `URL:${url}`,
    "END:VEVENT",
    "END:VCALENDAR",
  );

  return lines.join("\r\n");
}

const escapeText = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

const stamp = (unixSeconds: number): string => {
  const date = new Date(unixSeconds * 1000);
  const two = (part: number) => String(part).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${two(date.getUTCMonth() + 1)}${two(date.getUTCDate())}` +
    `T${two(date.getUTCHours())}${two(date.getUTCMinutes())}${two(date.getUTCSeconds())}Z`
  );
};

/** Seconds before the deadline at which the calendar event is placed. */
export const CHECK_IN_LEAD_SECONDS = 3 * 86_400;

/**
 * A single-event iCalendar file reminding the owner to check in, placed a few
 * days before the quiet period actually ends.
 */
export function buildCheckInIcs(options: {
  dueAt: number;
  url: string;
  now?: number;
}): string {
  const { dueAt, url } = options;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const eventAt = Math.max(now, dueAt - CHECK_IN_LEAD_SECONDS);
  const dueText = new Date(dueAt * 1000).toUTCString();

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Mortal Vault//Check-in//EN",
    "BEGIN:VEVENT",
    `UID:mortal-vault-checkin-${dueAt}@mortalvault`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(eventAt)}`,
    `DTEND:${stamp(eventAt + 1800)}`,
    "SUMMARY:Mortal Vault — time to check in",
    `DESCRIPTION:${escapeText(`Your quiet period ends ${dueText}. One check-in resets it: ${url}`)}`,
    `URL:${url}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

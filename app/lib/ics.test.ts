import { describe, expect, it } from "vitest";

import { CHECK_IN_LEAD_SECONDS, buildCheckInIcs } from "./ics";

const DAY = 86_400;

describe("buildCheckInIcs", () => {
  const dueAt = Date.UTC(2026, 10, 24, 21, 30, 0) / 1000;
  const now = dueAt - 20 * DAY;
  const url = "https://vault.example/?action=checkin";

  it("produces a VEVENT placed before the deadline", () => {
    const ics = buildCheckInIcs({ dueAt, url, now });
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("DTSTART:20261121T213000Z");
    expect(ics).toContain("SUMMARY:Mortal Vault — time to check in");
    expect(ics).toContain(url);
    expect(ics.endsWith("END:VCALENDAR")).toBe(true);
    expect(ics.split("\r\n").length).toBeGreaterThan(1);
  });

  it("never schedules the reminder in the past", () => {
    const ics = buildCheckInIcs({ dueAt, url, now: dueAt - 3600 });
    expect(ics).toContain("DTSTART:20261124T203000Z");
  });

  it("repeats on the quiet period so a check-in does not consume it", () => {
    const ics = buildCheckInIcs({ dueAt, url, now, intervalSeconds: 180 * DAY });
    expect(ics).toContain("RRULE:FREQ=DAILY;INTERVAL=180");
    expect(ics).toContain("about 180 days");
  });

  it("leaves RRULE unescaped, because its semicolons are separators", () => {
    const ics = buildCheckInIcs({ dueAt, url, now, intervalSeconds: 30 * DAY });
    expect(ics).toContain("RRULE:FREQ=DAILY;INTERVAL=30");
    expect(ics).not.toContain("FREQ=DAILY\\;");
  });

  it("omits the recurrence when no interval or an unusable one is given", () => {
    expect(buildCheckInIcs({ dueAt, url, now })).not.toContain("RRULE");
    expect(
      buildCheckInIcs({ dueAt, url, now, intervalSeconds: 3600 }),
    ).not.toContain("RRULE");
  });

  it("keeps the UID stable as the deadline moves, so re-downloads update one entry", () => {
    const first = buildCheckInIcs({ dueAt, url, now, vaultId: "0xabc" });
    const later = buildCheckInIcs({
      dueAt: dueAt + 180 * DAY,
      url,
      now,
      vaultId: "0xabc",
    });

    const uidOf = (ics: string) =>
      ics.split("\r\n").find((line) => line.startsWith("UID:"));

    expect(uidOf(first)).toBe("UID:mortal-vault-checkin-0xabc@mortalvault");
    expect(uidOf(later)).toBe(uidOf(first));
  });

  it("gives different vaults different UIDs", () => {
    const a = buildCheckInIcs({ dueAt, url, now, vaultId: "0xaaa" });
    const b = buildCheckInIcs({ dueAt, url, now, vaultId: "0xbbb" });
    expect(a).toContain("UID:mortal-vault-checkin-0xaaa@mortalvault");
    expect(b).toContain("UID:mortal-vault-checkin-0xbbb@mortalvault");
  });

  it("escapes every character RFC 5545 reserves in a TEXT value", () => {
    const ics = buildCheckInIcs({
      dueAt,
      url: "https://x.example/a,b;c\\d",
      now,
    });
    const description = ics
      .split("\r\n")
      .find((line) => line.startsWith("DESCRIPTION:"))!;

    // Written as a raw string so the assertion cannot repeat the original bug,
    // where "\;" collapsed to ";" and the test passed against no escaping.
    expect(description).toContain(String.raw`a\,b\;c\\d`);
    expect(description).not.toContain(String.raw`a,b;c`);
  });

  it("escapes the comma the due date always contains", () => {
    const description = buildCheckInIcs({ dueAt, url, now })
      .split("\r\n")
      .find((line) => line.startsWith("DESCRIPTION:"))!;
    // toUTCString renders "Tue, 24 Nov 2026 …"; that comma must be escaped.
    expect(description).toMatch(/[A-Z][a-z]{2}\\, \d{2}/);
  });

  it("keeps the lead constant sane", () => {
    expect(CHECK_IN_LEAD_SECONDS).toBe(259_200);
  });
});

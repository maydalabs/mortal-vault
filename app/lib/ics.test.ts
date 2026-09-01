import { describe, expect, it } from "vitest";

import { CHECK_IN_LEAD_SECONDS, buildCheckInIcs } from "./ics";

describe("buildCheckInIcs", () => {
  const dueAt = Date.UTC(2026, 10, 24, 21, 30, 0) / 1000;
  const now = dueAt - 20 * 86_400;

  it("produces a single VEVENT placed before the deadline", () => {
    const ics = buildCheckInIcs({ dueAt, url: "https://vault.example/?action=checkin", now });
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("DTSTART:20261121T213000Z");
    expect(ics).toContain("SUMMARY:Mortal Vault — time to check in");
    expect(ics).toContain("https://vault.example/?action=checkin");
    expect(ics.endsWith("END:VCALENDAR")).toBe(true);
  });

  it("never schedules the reminder in the past", () => {
    const lateNow = dueAt - 3600;
    const ics = buildCheckInIcs({ dueAt, url: "https://x.example", now: lateNow });
    expect(ics).toContain(`DTSTART:20261124T203000Z`);
  });

  it("escapes description punctuation", () => {
    const ics = buildCheckInIcs({ dueAt, url: "https://x.example/a,b;c", now });
    expect(ics).toContain("a\\,b\;c");
  });

  it("keeps the lead constant sane", () => {
    expect(CHECK_IN_LEAD_SECONDS).toBe(259_200);
  });
});

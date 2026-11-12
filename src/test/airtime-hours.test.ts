import { describe, expect, it } from "vitest";
import { isGuestAirtimeClosed } from "@/lib/airtimeHours";

const at = (hour: number, minute = 0) => new Date(Date.UTC(2026, 10, 12, hour, minute));

describe("isGuestAirtimeClosed", () => {
  it.each([22, 23, 0, 3, 6])("is closed at %s:00 Ghana time", (hour) => {
    expect(isGuestAirtimeClosed(at(hour))).toBe(true);
  });

  it.each([7, 12, 21])("is open at %s:00 Ghana time", (hour) => {
    expect(isGuestAirtimeClosed(at(hour))).toBe(false);
  });

  it("opens at exactly 7:00 and closes at exactly 22:00", () => {
    expect(isGuestAirtimeClosed(at(6, 59))).toBe(true);
    expect(isGuestAirtimeClosed(at(7, 0))).toBe(false);
    expect(isGuestAirtimeClosed(at(21, 59))).toBe(false);
    expect(isGuestAirtimeClosed(at(22, 0))).toBe(true);
  });
});

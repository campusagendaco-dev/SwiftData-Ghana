import { describe, expect, it } from "vitest";
import { isComboPackage, normalizeNetwork, normalizeSize } from "../../supabase/functions/_shared/margin_match";

describe("margin watchdog bundle matching", () => {
  it("keeps MTN Mash Up separate from plain MTN", () => {
    expect(normalizeNetwork("MTN")).toBe("MTN");
    expect(normalizeNetwork("MTN Mash Up")).toBe("MTN_MASHUP");
    expect(normalizeNetwork("mtn mashup")).toBe("MTN_MASHUP");
    expect(normalizeNetwork("Telecel")).toBe("TELECEL");
    expect(normalizeNetwork("AT")).toBe("AT_PREMIUM");
  });

  it("recognises data + minutes combos, which are never plain data", () => {
    expect(isComboPackage("6GB + 353 Mins")).toBe(true);
    expect(isComboPackage("MTN MashUp ₵63")).toBe(true);
    expect(isComboPackage("6gb + 700 Mins")).toBe(true);
    expect(isComboPackage("6GB")).toBe(false);
    expect(isComboPackage("6.00GB")).toBe(false);
  });

  it("reads sizes as before", () => {
    expect(normalizeSize("6GB")).toBe("6GB");
    expect(normalizeSize("6.00GB")).toBe("6GB");
    expect(normalizeSize("500MB")).toBe("500MB");
    expect(normalizeSize("", 15)).toBe("15GB");
  });
});

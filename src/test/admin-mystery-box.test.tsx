import { describe, it, expect } from "vitest";
import { oddsPercent } from "@/lib/mysteryBox";

describe("oddsPercent", () => {
  it("shares odds across active prizes only, to one decimal", () => {
    expect(oddsPercent([
      { weight: 1, is_active: true },
      { weight: 9, is_active: true },
      { weight: 5, is_active: false },
    ])).toEqual([10, 90, 0]);
    expect(oddsPercent([{ weight: 1, is_active: true }, { weight: 2, is_active: true }])).toEqual([33.3, 66.7]);
  });
  it("handles an empty or all-inactive pool", () => {
    expect(oddsPercent([])).toEqual([]);
    expect(oddsPercent([{ weight: 3, is_active: false }])).toEqual([0]);
  });
});

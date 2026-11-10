import { GHANA_TOWNS } from "../../supabase/functions/_shared/ghana_towns";
const CAPITALS = ["Accra","Kumasi","Sekondi-Takoradi","Cape Coast","Koforidua","Ho","Dambai","Tamale","Damongo","Nalerigu","Bolgatanga","Wa","Sunyani","Techiman","Goaso","Sefwi Wiawso"];
const find = (n: string) => GHANA_TOWNS.find((t) => t.name === n);

it("includes all 16 regional capitals", () => { for (const c of CAPITALS) expect(find(c), c).toBeDefined(); });
it("picks the real city when villages share the name", () => {
  expect(find("Kumasi")!.lat).toBeCloseTo(6.69, 1);
  expect(find("Accra")!.lng).toBeCloseTo(-0.2, 1);
  expect(find("Koforidua")!.lat).toBeCloseTo(6.09, 1);
});
it("has unique keys and coordinates inside Ghana", () => {
  expect(new Set(GHANA_TOWNS.map((t) => t.key)).size).toBe(GHANA_TOWNS.length);
  for (const t of GHANA_TOWNS) { expect(t.lat).toBeGreaterThan(4.5); expect(t.lat).toBeLessThan(11.5); expect(t.lng).toBeGreaterThan(-3.5); expect(t.lng).toBeLessThan(1.5); }
});
it("has Bolga as an alias of Bolgatanga", () => { expect(find("Bolgatanga")!.aliases).toContain("Bolga"); });
it("uses common Ghanaian spellings, keeping GeoNames spellings as aliases", () => {
  expect(find("Obuasi")).toBeDefined();
  expect(find("Wenchi")).toBeDefined();
  expect(find("Madina")).toBeDefined();
  expect(find("Obuase")).toBeUndefined();
  expect(find("Obuasi")!.aliases).toContain("Obuase");
});

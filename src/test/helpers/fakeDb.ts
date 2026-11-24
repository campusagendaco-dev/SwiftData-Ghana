// Minimal in-memory stand-in for the supabase-js service client, for testing shared Deno
// modules. Supports the chains our agent code uses: select/insert/update/upsert with
// eq/neq/in/gte/lte/not(col,"is",null)/order/limit, then maybeSingle/single or await.
// Every write is recorded in `writes` so tests can assert exactly what changed.

type Row = Record<string, any>;
export type Write = { table: string; op: "insert" | "update" | "upsert"; values: any; filters: string[] };

export function fakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const writes: Write[] = [];
  const failNextUpdateOn = new Set<string>();

  function from(table: string) {
    tables[table] ??= [];
    let op: "select" | "insert" | "update" | "upsert" = "select";
    let values: any = null;
    let returning = false;
    let limitN = Infinity;
    const preds: ((r: Row) => boolean)[] = [];
    const filters: string[] = [];

    const rows = () => tables[table].filter((r) => preds.every((p) => p(r)));
    const run = () => {
      if (op === "select") return { data: rows().slice(0, limitN), error: null };
      if (op === "insert" || op === "upsert") {
        const list = (Array.isArray(values) ? values : [values]).map((v: Row) => ({ id: v.id ?? `id-${Math.random().toString(36).slice(2)}`, ...v }));
        tables[table].push(...list);
        writes.push({ table, op, values, filters });
        return { data: returning ? list : null, error: null };
      }
      // update: conditional on the filters, like Postgres
      if (failNextUpdateOn.has(table)) {
        failNextUpdateOn.delete(table);
        return { data: null, error: { message: "update failed" } };
      }
      const hit = rows();
      hit.forEach((r) => Object.assign(r, values));
      writes.push({ table, op, values, filters });
      return { data: returning ? hit.map((r) => ({ ...r })) : null, error: null };
    };

    const q: any = {
      select: () => { if (op !== "select") returning = true; return q; },
      insert: (v: any) => { op = "insert"; values = v; return q; },
      upsert: (v: any) => { op = "upsert"; values = v; return q; },
      update: (v: any) => { op = "update"; values = v; return q; },
      eq: (c: string, v: any) => { preds.push((r) => r[c] === v); filters.push(`${c}=${v}`); return q; },
      neq: (c: string, v: any) => { preds.push((r) => r[c] !== v); filters.push(`${c}!=${v}`); return q; },
      in: (c: string, v: any[]) => { preds.push((r) => v.includes(r[c])); filters.push(`${c} in ${v.join(",")}`); return q; },
      gte: (c: string, v: any) => { preds.push((r) => r[c] >= v); return q; },
      lte: (c: string, v: any) => { preds.push((r) => r[c] <= v); return q; },
      gt: (c: string, v: any) => { preds.push((r) => r[c] > v); return q; },
      not: (c: string, _o: string, _v: null) => { preds.push((r) => r[c] != null); return q; },
      is: (c: string, v: null) => { preds.push((r) => (r[c] ?? null) === v); filters.push(`${c} is ${v}`); return q; },
      order: () => q,
      limit: (n: number) => { limitN = n; return q; },
      maybeSingle: async () => { const r = run(); const d = Array.isArray(r.data) ? r.data[0] ?? null : r.data; return { data: d, error: r.error }; },
      single: async () => { const r = run(); const d = Array.isArray(r.data) ? r.data[0] ?? null : r.data; return { data: d, error: r.error }; },
      then: (ok: any, bad: any) => Promise.resolve(run()).then(ok, bad),
    };
    return q;
  }

  return { from, tables, writes, failNextUpdateOn };
}

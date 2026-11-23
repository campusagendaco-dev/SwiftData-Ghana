import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) } }));

const rpc = vi.fn();
const from = vi.fn((table: string) => {
  throw new Error(`the Database Space page must not read tables directly (tried ${table})`);
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), from: (t: string) => from(t) } }));

import { formatBytes, addDeleted, COMPACT_SQL } from "@/lib/dbSpace";
import AdminDatabaseSpace from "@/pages/AdminDatabaseSpace";

const MB = 1024 * 1024;
const space = {
  database_bytes: 2615 * MB,
  tables: [
    { target: "public.sms_logs", label: "SMS logs", keep_days: 90, rule: "Older than 90 days", total_bytes: 325 * MB, approx_rows: 472106 },
    { target: "cron.job_run_details", label: "Scheduled job history", keep_days: 7, rule: "Runs older than 7 days", total_bytes: 1018 * MB, approx_rows: 101108 },
  ],
  last_run: {
    started_at: "2026-11-23T03:20:00Z",
    finished_at: "2026-11-23T03:21:00Z",
    source: "nightly",
    deleted: { "public.sms_logs": 1200, "cron.job_run_details": 300 },
    more_remaining: false,
  },
};

const spaceCalls = () => rpc.mock.calls.filter((c) => c[0] === "admin_db_space").length;

beforeEach(() => {
  rpc.mockReset();
  from.mockClear();
  toastError.mockReset();
  toastSuccess.mockReset();
});
afterEach(() => cleanup());

describe("dbSpace helpers", () => {
  it("formats sizes like the Supabase report", () => {
    expect(formatBytes(1018 * MB)).toBe("1018 MB");
    expect(formatBytes(2615 * MB)).toBe("2.55 GB");
    expect(formatBytes(8088 * 1024)).toBe("7.9 MB");
    expect(formatBytes(512 * 1024)).toBe("512 kB");
    expect(formatBytes(0)).toBe("0 kB");
  });
  it("adds deleted counts per table", () => {
    expect(addDeleted({ a: 1, b: 2 }, { b: 3, c: 4 })).toEqual({ a: 1, b: 5, c: 4 });
  });
  it("compacts exactly the six cleaned tables", () => {
    expect(COMPACT_SQL.match(/VACUUM FULL/g)).toHaveLength(6);
    expect(COMPACT_SQL).toContain("VACUUM FULL cron.job_run_details;");
    expect(COMPACT_SQL).not.toMatch(/orders|wallet|profiles/);
  });
});

describe("AdminDatabaseSpace", () => {
  it("shows the total, each table (biggest first) and the last cleanup", async () => {
    rpc.mockResolvedValue({ data: space, error: null });
    render(<AdminDatabaseSpace />);
    expect(await screen.findByText("2.55 GB")).toBeInTheDocument();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Scheduled job history");
    expect(rows[0]).toHaveTextContent("1018 MB");
    expect(rows[1]).toHaveTextContent("SMS logs");
    expect(screen.getByText(/Nightly/)).toBeInTheDocument();
    expect(screen.getByText(/1,500 rows removed/)).toBeInTheDocument();
    expect(from).not.toHaveBeenCalled();
  });

  it("Clean now keeps going until nothing is left, then reloads the sizes", async () => {
    const cleanups = [
      { data: { deleted: { "public.sms_logs": 5000 }, more_remaining: true }, error: null },
      { data: { deleted: { "public.sms_logs": 1500, "public.system_logs": 500 }, more_remaining: false }, error: null },
    ];
    rpc.mockImplementation(async (name: string) => (name === "admin_db_space" ? { data: space, error: null } : cleanups.shift()));
    render(<AdminDatabaseSpace />);
    fireEvent.click(await screen.findByRole("button", { name: /Clean now/ }));
    expect(await screen.findByText("Deleted 7,000 old rows")).toBeInTheDocument();
    expect(rpc.mock.calls.filter((c) => c[0] === "admin_db_cleanup_now")).toHaveLength(2);
    await waitFor(() => expect(spaceCalls()).toBe(2));
    expect(toastError).not.toHaveBeenCalled();
  });

  it("shows an error, keeps what was deleted so far, and still reloads", async () => {
    const cleanups = [
      { data: { deleted: { "public.sms_logs": 2000 }, more_remaining: true }, error: null },
      { data: null, error: { message: "not_authorized" } },
    ];
    rpc.mockImplementation(async (name: string) => (name === "admin_db_space" ? { data: space, error: null } : cleanups.shift()));
    render(<AdminDatabaseSpace />);
    fireEvent.click(await screen.findByRole("button", { name: /Clean now/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0][0])).toMatch(/2FA|admin/i);
    expect(await screen.findByText("Deleted 2,000 old rows")).toBeInTheDocument();
    await waitFor(() => expect(spaceCalls()).toBe(2));
  });
});

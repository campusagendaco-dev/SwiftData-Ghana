import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const invoke = vi.fn();
const confirm = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));
vi.mock("@/components/admin/ConfirmActionProvider", () => ({ useConfirmedCall: () => ({ confirm: (...a: unknown[]) => confirm(...a) }) }));

import AgentApprovalQueue from "@/components/admin/AgentApprovalQueue";
import { agentConfirmKind } from "@/lib/agentConfirmKind";

const task = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  agent_name: "threat_hunter",
  task_type: "suspend_cluster",
  priority: "critical",
  status: "awaiting_approval",
  title: "Threat Hunter: suspend 3 accounts on IP 1.2.3.4",
  reasoning: "Same IP, 3 new accounts in an hour",
  payload: { user_ids: ["a", "b", "c"], ip: "1.2.3.4" },
  created_at: "2026-11-24T10:00:00Z",
  ...over,
});

describe("Agent approval queue", () => {
  beforeEach(() => {
    invoke.mockReset();
    confirm.mockReset();
  });
  afterEach(cleanup);

  it("does nothing when the admin cancels the confirmation", async () => {
    confirm.mockResolvedValue(false);
    render(<AgentApprovalQueue tasks={[task()]} onDecided={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(invoke).not.toHaveBeenCalled();
  });

  it("approves through ai-task-decide after the admin confirms", async () => {
    confirm.mockResolvedValue(true);
    invoke.mockResolvedValue({ data: { ok: true, status: "executed" }, error: null });
    const onDecided = vi.fn();
    render(<AgentApprovalQueue tasks={[task()]} onDecided={onDecided} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("ai-task-decide", { body: { task_id: "t1", approve: true } }));
    await waitFor(() => expect(onDecided).toHaveBeenCalled());
  });

  it("shows the account count and asks with the account warning", async () => {
    confirm.mockResolvedValue(false);
    render(<AgentApprovalQueue tasks={[task()]} onDecided={() => {}} />);
    expect(screen.getByText("3 accounts")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ kind: "account", confirmLabel: "Approve", title: task().title })));
  });

  it("says so when another admin already decided", async () => {
    confirm.mockResolvedValue(true);
    invoke.mockResolvedValue({ data: null, error: { message: "Edge Function returned a non-2xx status code", context: { status: 409 } } });
    const onDecided = vi.fn();
    render(<AgentApprovalQueue tasks={[task()]} onDecided={onDecided} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("Already decided by another admin")).toBeInTheDocument();
    expect(onDecided).toHaveBeenCalled();
  });

  it("rejects without a confirmation box", async () => {
    invoke.mockResolvedValue({ data: { ok: true, status: "rejected" }, error: null });
    render(<AgentApprovalQueue tasks={[task()]} onDecided={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("ai-task-decide", { body: { task_id: "t1", approve: false } }));
    expect(confirm).not.toHaveBeenCalled();
  });

  it("shows an empty state", () => {
    render(<AgentApprovalQueue tasks={[]} onDecided={() => {}} />);
    expect(screen.getByText("Nothing waiting for approval.")).toBeInTheDocument();
  });
});

describe("what the approval box shows", () => {
  beforeEach(() => {
    invoke.mockReset();
    confirm.mockReset();
    confirm.mockResolvedValue(false);
  });
  afterEach(cleanup);

  it("lists the account names from the database", async () => {
    render(<AgentApprovalQueue tasks={[task({ payload: { user_ids: ["a", "b"], display: { accounts: [{ id: "a", name: "Ama Mensah" }, { id: "b", name: "Kofi Boateng" }] } } })]} onDecided={() => {}} />);
    expect(screen.getByText("Ama Mensah, Kofi Boateng")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(confirm.mock.calls[0][0].description).toContain("Ama Mensah, Kofi Boateng"));
  });

  it("shows how many agents get the outage text, and the exact text", async () => {
    const sms = "SwiftData Alert: We have detected instability with the MTN network.";
    render(<AgentApprovalQueue tasks={[task({ task_type: "broadcast_outage", payload: { network: "MTN", display: { network: "MTN", recipients: 1204, sms_text: sms } } })]} onDecided={() => {}} />);
    expect(screen.getByText("1204 agents get this SMS")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ kind: "message", orders: 1204 })));
    expect(confirm.mock.calls[0][0].description).toContain(sms);
  });

  it("shows the order amount in GH₵", async () => {
    render(<AgentApprovalQueue tasks={[task({ task_type: "quarantine_order", payload: { order_id: "o1", display: { order: { id: "o1", amount: 25, status: "processing" } } } })]} onDecided={() => {}} />);
    expect(screen.getByText("Order o1 (GH₵25.00, processing) will be marked failed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ amountGhs: 25 })));
  });

  it("says a cashout freeze only records an alert", () => {
    render(<AgentApprovalQueue tasks={[task({ task_type: "freeze_cashouts", payload: { agent_id: "k", display: { accounts: [{ id: "k", name: "Kofi" }] } } })]} onDecided={() => {}} />);
    expect(screen.getByText(/does not block cashouts/)).toBeInTheDocument();
  });
});

describe("confirm kind mirror", () => {
  it("matches the backend policy for each kind", () => {
    expect(agentConfirmKind("switch_priority")).toBe("ops");
    expect(agentConfirmKind("quarantine_order")).toBe("ops");
    expect(agentConfirmKind("broadcast_outage")).toBe("message");
    expect(agentConfirmKind("blacklist_ip")).toBe("account");
    expect(agentConfirmKind("suspend_cluster")).toBe("account");
  });
});

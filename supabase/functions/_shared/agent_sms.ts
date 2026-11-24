// Real SMS sender for the agent runner (agent_actions.ts takes it as `AgentSms`).
// Kept separate because sms.ts imports from esm.sh, which unit tests can't load.
import { dispatchUnifiedBulkSms, dispatchUnifiedSms, getSmsConfig } from "./sms.ts";
import type { AgentSms } from "./agent_actions.ts";

export const agentSms: AgentSms = {
  async sendAdmin(db: any, message: string): Promise<boolean> {
    try {
      const { data: admins } = await db.from("profiles").select("phone").eq("role", "admin").not("phone", "is", null).limit(1);
      const phone = admins?.[0]?.phone;
      if (!phone) return false;
      const cfg = await getSmsConfig(db);
      if (!cfg?.apiKey) return false;
      await dispatchUnifiedSms(cfg.gateway, cfg.apiKey, cfg.senderId, phone, message, "custom");
      return true;
    } catch (err) {
      console.error("[agent_sms] admin SMS failed:", err);
      return false;
    }
  },
  async sendBulk(db: any, phones: string[], message: string): Promise<boolean> {
    try {
      const cfg = await getSmsConfig(db);
      if (!cfg?.apiKey) return false;
      await dispatchUnifiedBulkSms(cfg.gateway, cfg.apiKey, cfg.senderId, phones, message, "broadcast");
      return true;
    } catch (err) {
      console.error("[agent_sms] bulk SMS failed:", err);
      return false;
    }
  },
};

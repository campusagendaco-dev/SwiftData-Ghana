declare const Deno: any;

/**
 * Send a WhatsApp message via WaSender API.
 *
 * @param to    – Recipient phone number
 * @param text  – Message body
 * @param apiKey – Optional per-agent API key. Falls back to the global WHATSAPP_API_KEY secret.
 */
export async function sendWhatsAppMessage(to: string, text: string, apiKey?: string) {
  const WHATSAPP_API_URL = Deno.env.get("WHATSAPP_API_URL") || "https://www.wasenderapi.com/api/send-message";
  const resolvedKey = apiKey || Deno.env.get("WHATSAPP_API_KEY") || "";

  if (!resolvedKey) {
    console.warn("[WhatsApp] No API key available. Message not sent:", text.slice(0, 80));
    return;
  }

  console.log(`[WhatsApp] Sending message using key: ${resolvedKey.slice(0, 4)}...${resolvedKey.slice(-4)}`);

  // Ensure E.164 format (Ghana-focused)
  let formattedTo = to.replace(/\s+/g, "").replace(/-/g, "");
  if (formattedTo.startsWith("0") && formattedTo.length === 10) {
    formattedTo = "+233" + formattedTo.slice(1);
  }
  if (formattedTo.startsWith("233") && !formattedTo.startsWith("+")) {
    formattedTo = "+" + formattedTo;
  }
  if (!formattedTo.startsWith("+")) {
    formattedTo = "+" + formattedTo;
  }

  try {
    const res = await fetch(WHATSAPP_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${resolvedKey}`,
      },
      body: JSON.stringify({ to: formattedTo, text }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error("[WhatsApp] Send failed:", res.status, errBody);
    } else {
      console.log("[WhatsApp] Sent to", formattedTo);
    }
  } catch (error) {
    console.error("[WhatsApp] Error:", error);
  }
}

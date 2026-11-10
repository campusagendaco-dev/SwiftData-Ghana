import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { callLocationCheck, requestPosition, LOCATION_CONSENT_VERSION } from "@/lib/locationAlerts";

type Status = {
  eligible: boolean;
  is_admin: boolean;
  has_phone: boolean;
  status: "unset" | "granted" | "declined";
  sms_opt_out: boolean;
};
type Saved = { ok: boolean };

const LOCATION_LABEL = "Tell me when SwiftData is in a new town I visit";
const PROMO_LABEL = "Promotional SMS";

export function LocationAlertSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [locationOn, setLocationOn] = useState(false);
  const [promoOn, setPromoOn] = useState(true);
  const [savingLocation, setSavingLocation] = useState(false);
  const [savingPromo, setSavingPromo] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await callLocationCheck<Status>({ action: "status" });
      if (cancelled || !s) return;
      setStatus(s);
      setLocationOn(s.status === "granted");
      setPromoOn(!s.sms_opt_out);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status || status.is_admin) return null;
  const showLocation = status.status === "granted" || status.has_phone;

  const onLocationChange = async (next: boolean) => {
    setLocationOn(next);
    setSavingLocation(true);
    const res = await callLocationCheck<Saved>({
      action: "set_consent",
      choice: next ? "yes" : "no",
      version: LOCATION_CONSENT_VERSION,
    });
    if (res?.ok !== true) {
      setLocationOn(!next);
      setSavingLocation(false);
      toast.error("Could not save your choice. Please try again.");
      return;
    }
    setSavingLocation(false);
    if (next) {
      const position = await requestPosition();
      if (position) await callLocationCheck({ action: "check", ...position });
    }
  };

  const onPromoChange = async (next: boolean) => {
    setPromoOn(next);
    setSavingPromo(true);
    const res = await callLocationCheck<Saved>({ action: "set_sms_opt_out", value: !next });
    if (res?.ok !== true) {
      setPromoOn(!next);
      toast.error("Could not save your choice. Please try again.");
    }
    setSavingPromo(false);
  };

  return (
    <Card className="border-none bg-card shadow-sm mt-8">
      <CardHeader>
        <CardTitle className="text-lg font-bold">SMS preferences</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {showLocation && (
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-foreground">{LOCATION_LABEL}</span>
            <Switch
              aria-label={LOCATION_LABEL}
              checked={locationOn}
              disabled={savingLocation}
              onCheckedChange={onLocationChange}
            />
          </div>
        )}
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-foreground">{PROMO_LABEL}</span>
          <Switch
            aria-label={PROMO_LABEL}
            checked={promoOn}
            disabled={savingPromo}
            onCheckedChange={onPromoChange}
          />
        </div>
        <p className="text-xs text-muted-foreground">Order and payment messages are not affected.</p>
      </CardContent>
    </Card>
  );
}

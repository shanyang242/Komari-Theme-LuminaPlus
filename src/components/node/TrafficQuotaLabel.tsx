import { Database } from "lucide-react";
import type { TrafficResetDisplay } from "@/utils/trafficReset";

export function TrafficQuotaLabel({
  remainingLabel,
  reset,
}: {
  remainingLabel: string;
  reset: TrafficResetDisplay | null;
}) {
  const compactRemaining = remainingLabel.replace(
    /^(\d+(?:\.\d+)?)\s+([KMGTPE]?)B$/,
    (_, value: string, unit: string) => `${Number(value)}${unit || "B"}`,
  );

  return (
    <span className="traffic-quota-label">
      <span className="traffic-quota-summary">
        <Database size={13} strokeWidth={2} />
        <span>剩余</span>
        <span>
          <strong className="traffic-quota-remain" title={remainingLabel}>{compactRemaining}</strong>
          {reset && (
            <span className="traffic-quota-reset" title={reset.title}>
              {" ·"}{reset.label}
            </span>
          )}
        </span>
      </span>
    </span>
  );
}

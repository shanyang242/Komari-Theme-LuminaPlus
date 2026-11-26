import { HealthBars, type HealthBarsProps } from "./HealthBars";

export function LatencyBars(props: HealthBarsProps) {
  return <HealthBars kind="latency" {...props} />;
}

import { HealthBars, type HealthBarsProps } from "./HealthBars";

export function QualityBars(props: HealthBarsProps) {
  return <HealthBars kind="loss" {...props} />;
}

export const opportunityMetricDirections = {
  DEMO_ADDRESSABLE_UNITS: "higher_is_better",
} as const satisfies Record<
  string,
  "higher_is_better" | "lower_is_better"
>;

export function opportunityMetricDirection(
  metricCode: string,
): "higher_is_better" | "lower_is_better" | null {
  if (metricCode in opportunityMetricDirections) {
    return opportunityMetricDirections[
      metricCode as keyof typeof opportunityMetricDirections
    ];
  }

  return null;
}

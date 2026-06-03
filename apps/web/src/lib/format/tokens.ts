const plainNumberFormatter = new Intl.NumberFormat("en-US");

const tokenUnits = [
  { value: 1_000_000_000_000, suffix: "T" },
  { value: 1_000_000_000, suffix: "B" },
  { value: 1_000_000, suffix: "M" },
  { value: 1_000, suffix: "K" },
];

export function formatTokenAmount(value: number) {
  const absoluteValue = Math.abs(value);
  const unit = tokenUnits.find((candidate) => absoluteValue >= candidate.value);

  if (!unit) {
    return plainNumberFormatter.format(value);
  }

  const scaled = value / unit.value;

  return `${scaled.toFixed(1)}${unit.suffix}`;
}

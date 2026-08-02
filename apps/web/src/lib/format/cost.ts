// 금액 표기. 값이 근사치라는 걸 숨기지 않으려고 앞에 ≈를 붙인다 — 실제 청구서가
// 아니라 공개 요율로 환산한 값이다.

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// 1센트에 못 미치는 금액은 $0.00으로 보이면 "안 썼다"로 읽힌다.
const SMALLEST_SHOWN_USD = 0.005;

export function formatUSD(value: number): string {
  if (value > 0 && value < SMALLEST_SHOWN_USD) {
    return "<$0.01";
  }
  return usdFormatter.format(value);
}

export function formatApproxUSD(value: number): string {
  return `≈${formatUSD(value)}`;
}

/**
 * 부분 금액들을 2자리로 반올림하되, 합이 전체 금액의 반올림값과 정확히 같도록
 * 최대잔여법으로 맞춘다. 각자 반올림하면 $10.30 + $14.35 = $24.65인데 총액은
 * $24.66으로 찍히는, 눈에 바로 띄는 어긋남이 생긴다.
 */
export function roundSharesToTotal(values: number[], total: number): number[] {
  const CENTS = 100;
  const targetCents = Math.round(total * CENTS);
  const scaled = values.map((value) => value * CENTS);
  const floored = scaled.map((value) => Math.floor(value));
  const deficit = targetCents - floored.reduce((sum, value) => sum + value, 0);

  // 잔여분을 소수부가 큰 순서대로 1센트씩 나눠 준다.
  const order = scaled
    .map((value, index) => ({ index, remainder: value - floored[index] }))
    .sort((a, b) => b.remainder - a.remainder);

  const result = [...floored];
  for (let i = 0; i < Math.abs(deficit) && order.length > 0; i += 1) {
    const target = order[i % order.length].index;
    result[target] += deficit > 0 ? 1 : -1;
  }
  return result.map((cents) => cents / CENTS);
}

export function formatCostSharePercent(value: number, total: number): string {
  if (total <= 0) {
    return "0";
  }
  const pct = (value / total) * 100;
  if (pct > 0 && pct < 1) {
    return "<1";
  }
  return Math.round(pct).toString();
}

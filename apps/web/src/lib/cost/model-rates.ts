// API 환산 금액 계산.
//
// 금액은 어디에도 저장하지 않는다. 사용량 행에는 토큰만 담고, 읽는 시점에
// model_rates 테이블과 조인해 계산한다. 그래서 아직 요율이 등록되지 않은 모델도
// 행 하나만 추가하면 과거 사용량까지 소급해서 금액이 채워진다. 재파싱이 필요 없다.

export type ModelRate = {
  provider: string;
  model: string;
  effectiveFrom: string;
  contextTier: string;
  speed: string;
  inputPerMTok: number;
  cacheWrite5mPerMTok: number | null;
  cacheWrite1hPerMTok: number | null;
  cacheReadPerMTok: number;
  outputPerMTok: number;
};

export type ModelRateRow = {
  provider: string;
  model: string;
  effective_from: string;
  context_tier: string;
  speed: string;
  input_per_mtok: number | string;
  cache_write_5m_per_mtok: number | string | null;
  cache_write_1h_per_mtok: number | string | null;
  cache_read_per_mtok: number | string;
  output_per_mtok: number | string;
};

// 요율 계산에 필요한 토큰 분해. 세션·에이전트 행이 그대로 이 모양이다.
export type CostBuckets = {
  inputRawTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheTokens: number;
  outputTokens: number;
};

const PER_MTOK = 1_000_000;

// numeric 컬럼은 supabase-js가 문자열로 넘겨줄 수 있어 한 번 정규화한다.
function toNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toModelRate(row: ModelRateRow): ModelRate | null {
  const inputPerMTok = toNumber(row.input_per_mtok);
  const cacheReadPerMTok = toNumber(row.cache_read_per_mtok);
  const outputPerMTok = toNumber(row.output_per_mtok);
  if (
    inputPerMTok === null || cacheReadPerMTok === null || outputPerMTok === null
  ) {
    return null;
  }
  return {
    provider: row.provider,
    model: row.model,
    effectiveFrom: row.effective_from,
    contextTier: row.context_tier,
    speed: row.speed,
    inputPerMTok,
    cacheWrite5mPerMTok: toNumber(row.cache_write_5m_per_mtok),
    cacheWrite1hPerMTok: toNumber(row.cache_write_1h_per_mtok),
    cacheReadPerMTok,
    outputPerMTok,
  };
}

/**
 * 요율표를 `provider|model|speed` 키로 묶고, 각 묶음을 effective_from 내림차순으로
 * 정렬해 둔다. 조회는 "사용 날짜 이하인 첫 행"이면 끝난다.
 *
 * 요율 변경은 update가 아니라 새 행이라, 과거 사용량은 실제로 지불한 가격을
 * 그대로 유지한다. 미래 날짜 행도 그대로 담아 두고 그날이 되면 자동으로 넘어간다.
 */
export class ModelRateTable {
  private readonly byKey: Map<string, ModelRate[]>;

  constructor(rates: ModelRate[]) {
    this.byKey = new Map();
    for (const rate of rates) {
      // long tier는 요청 하나의 입력 토큰 수로 결정되는데, 세션·에이전트 행은
      // 이미 합산된 값이라 그 판단을 할 수 없다. short만 사용한다.
      if (rate.contextTier !== "short") continue;
      const key = rateKey(rate.provider, rate.model, rate.speed);
      const list = this.byKey.get(key);
      if (list) {
        list.push(rate);
      } else {
        this.byKey.set(key, [rate]);
      }
    }
    for (const list of this.byKey.values()) {
      list.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
    }
  }

  find(
    provider: string,
    model: string,
    speed: string,
    usageDate: string,
  ): ModelRate | null {
    const exact = this.byKey.get(rateKey(provider, model, speed));
    const found = pickEffective(exact, usageDate);
    if (found) return found;
    // fast 요율이 없는 모델은 standard로 청구된다(예: fast를 지원하지 않는 모델).
    if (speed !== "standard") {
      return pickEffective(
        this.byKey.get(rateKey(provider, model, "standard")),
        usageDate,
      );
    }
    return null;
  }

  get size(): number {
    return this.byKey.size;
  }
}

function rateKey(provider: string, model: string, speed: string): string {
  return `${provider}|${model}|${speed}`;
}

function pickEffective(
  rates: ModelRate[] | undefined,
  usageDate: string,
): ModelRate | null {
  if (!rates) return null;
  return rates.find((rate) => rate.effectiveFrom <= usageDate) ?? null;
}

/**
 * 요율이 없으면 null. 0이 아니다 — "무료"와 "모르는 값"은 다르고, UI는 후자일 때
 * 금액 자체를 감춘다.
 *
 * 캐시 쓰기 요율이 비어 있는 모델(공개 가격이 없는 경우)은 그 토큰을 입력 요율로
 * 계산한다. 캐시 쓰기는 항상 입력보다 비싸므로 과소 계상은 되어도 과대는 아니다.
 */
export function computeCostUSD(
  buckets: CostBuckets,
  rate: ModelRate | null,
): number | null {
  if (!rate) return null;
  const write5m = rate.cacheWrite5mPerMTok ?? rate.inputPerMTok;
  const write1h = rate.cacheWrite1hPerMTok ?? write5m;
  const total = buckets.inputRawTokens * rate.inputPerMTok +
    buckets.cacheWrite5mTokens * write5m +
    buckets.cacheWrite1hTokens * write1h +
    buckets.cacheTokens * rate.cacheReadPerMTok +
    buckets.outputTokens * rate.outputPerMTok;
  return total / PER_MTOK;
}

export function addBuckets(a: CostBuckets, b: CostBuckets): CostBuckets {
  return {
    inputRawTokens: a.inputRawTokens + b.inputRawTokens,
    cacheWrite5mTokens: a.cacheWrite5mTokens + b.cacheWrite5mTokens,
    cacheWrite1hTokens: a.cacheWrite1hTokens + b.cacheWrite1hTokens,
    cacheTokens: a.cacheTokens + b.cacheTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}

export const EMPTY_BUCKETS: CostBuckets = {
  inputRawTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
  cacheTokens: 0,
  outputTokens: 0,
};

export function bucketTotalTokens(buckets: CostBuckets): number {
  return buckets.inputRawTokens + buckets.cacheWrite5mTokens +
    buckets.cacheWrite1hTokens + buckets.cacheTokens + buckets.outputTokens;
}

// 사용 시각을 KST 기준 날짜(YYYY-MM-DD)로. 요율표의 effective_from과 같은 축이다.
const KOREA_OFFSET_MS = 9 * 60 * 60 * 1000;

export function usageDateOf(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return "1970-01-01";
  }
  return new Date(parsed.getTime() + KOREA_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

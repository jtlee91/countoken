// 세션 하나의 금액과 모델별 분해.
//
// 에이전트 행은 각각 소스 파일 하나에 대응하고 모델·속도를 하나씩 들고 있어서,
// 모델별 분해의 유일한 원천이다. 다만 에이전트 행이 세션 전체를 덮지 못하는
// 경우가 있어(라벨만 있는 스텁, 병합 과정에서 생긴 차이), 덮이지 않은 나머지는
// 세션의 대표 모델 요율로 계산해 더한다. 그래야 모델별 합이 항상 세션 총액과 같다.

import {
  addBuckets,
  bucketTotalTokens,
  computeCostUSD,
  EMPTY_BUCKETS,
  ModelRateTable,
  usageDateOf,
  type CostBuckets,
} from "./model-rates.ts";

export type ModelCostShare = {
  model: string;
  llmCalls: number;
  tokens: number;
  costUSD: number | null;
};

export type SessionCost = {
  // 요율을 하나도 못 찾으면 null이고, UI는 금액 표기 자체를 생략한다.
  totalUSD: number | null;
  // 일부 모델만 요율이 있을 때 true. 총액이 실제보다 작다는 뜻이다.
  partial: boolean;
  models: ModelCostShare[];
};

type CostInput = {
  provider: string;
  model: string;
  speed: string;
  startedAt: string;
  buckets: CostBuckets;
  llmCalls: number;
};

export type AgentCostInput = CostInput;

export function computeAgentCost(
  agent: CostInput,
  rates: ModelRateTable,
): number | null {
  if (!agent.model) return null;
  return computeCostUSD(
    agent.buckets,
    rates.find(
      agent.provider,
      agent.model,
      agent.speed,
      usageDateOf(agent.startedAt),
    ),
  );
}

export function computeSessionCost(
  session: CostInput,
  agents: AgentCostInput[],
  rates: ModelRateTable,
): SessionCost {
  const usageDate = usageDateOf(session.startedAt);

  // 모델별로 묶는다. 같은 모델이라도 속도가 다르면 요율이 다르므로 따로 계산하고,
  // 표시할 때만 모델 이름으로 합친다.
  const groups = new Map<
    string,
    { model: string; speed: string; buckets: CostBuckets; llmCalls: number }
  >();
  let covered = EMPTY_BUCKETS;

  for (const agent of agents) {
    if (!agent.model) continue;
    const key = `${agent.model}|${agent.speed}`;
    const existing = groups.get(key);
    if (existing) {
      existing.buckets = addBuckets(existing.buckets, agent.buckets);
      existing.llmCalls += agent.llmCalls;
    } else {
      groups.set(key, {
        model: agent.model,
        speed: agent.speed,
        buckets: agent.buckets,
        llmCalls: agent.llmCalls,
      });
    }
    covered = addBuckets(covered, agent.buckets);
  }

  // 에이전트가 덮지 못한 나머지를 세션 대표 모델로 돌린다. 음수가 나오면(에이전트
  // 합이 세션보다 큰 경우) 0으로 눌러 이중 계상을 막는다.
  const residual = clampNonNegative(subtractBuckets(session.buckets, covered));
  const residualCalls = Math.max(
    session.llmCalls -
      agents.reduce((sum, agent) => sum + (agent.model ? agent.llmCalls : 0), 0),
    0,
  );
  if (session.model && bucketTotalTokens(residual) > 0) {
    const key = `${session.model}|${session.speed}`;
    const existing = groups.get(key);
    if (existing) {
      existing.buckets = addBuckets(existing.buckets, residual);
      existing.llmCalls += residualCalls;
    } else {
      groups.set(key, {
        model: session.model,
        speed: session.speed,
        buckets: residual,
        llmCalls: residualCalls,
      });
    }
  }

  const byModel = new Map<string, ModelCostShare>();
  let total = 0;
  let priced = 0;
  let unpriced = 0;

  for (const group of groups.values()) {
    const rate = rates.find(
      session.provider,
      group.model,
      group.speed,
      usageDate,
    );
    const cost = computeCostUSD(group.buckets, rate);
    const tokens = bucketTotalTokens(group.buckets);
    if (cost === null) {
      unpriced += 1;
    } else {
      priced += 1;
      total += cost;
    }

    const existing = byModel.get(group.model);
    if (existing) {
      existing.llmCalls += group.llmCalls;
      existing.tokens += tokens;
      existing.costUSD = sumNullable(existing.costUSD, cost);
    } else {
      byModel.set(group.model, {
        model: group.model,
        llmCalls: group.llmCalls,
        tokens,
        costUSD: cost,
      });
    }
  }

  const models = [...byModel.values()].sort((a, b) => b.tokens - a.tokens);

  return {
    totalUSD: priced > 0 ? total : null,
    partial: priced > 0 && unpriced > 0,
    models,
  };
}

// 둘 다 null이면 null(요율 없음), 한쪽만 있으면 있는 쪽만 더한다.
function sumNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a + b;
}

function subtractBuckets(a: CostBuckets, b: CostBuckets): CostBuckets {
  return {
    inputRawTokens: a.inputRawTokens - b.inputRawTokens,
    cacheWrite5mTokens: a.cacheWrite5mTokens - b.cacheWrite5mTokens,
    cacheWrite1hTokens: a.cacheWrite1hTokens - b.cacheWrite1hTokens,
    cacheTokens: a.cacheTokens - b.cacheTokens,
    outputTokens: a.outputTokens - b.outputTokens,
  };
}

function clampNonNegative(buckets: CostBuckets): CostBuckets {
  return {
    inputRawTokens: Math.max(buckets.inputRawTokens, 0),
    cacheWrite5mTokens: Math.max(buckets.cacheWrite5mTokens, 0),
    cacheWrite1hTokens: Math.max(buckets.cacheWrite1hTokens, 0),
    cacheTokens: Math.max(buckets.cacheTokens, 0),
    outputTokens: Math.max(buckets.outputTokens, 0),
  };
}

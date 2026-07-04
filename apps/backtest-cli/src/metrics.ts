import { add, cmp, div, sub, toDecimalString } from "@brighten/decision-core/math";

import type { BacktestMetrics, RDistributionBin } from "./types.js";

// Aggregate a sequence of net R-multiples into honest, cost-aware metrics.
// Headline: expectancy (net) + max drawdown + R distribution + equity curve.
// Win rate is emitted as `winRateReference` only — never a headline number.
export function computeMetrics(netRs: readonly string[]): BacktestMetrics {
  const tradeCount = netRs.length;

  if (tradeCount === 0) {
    return {
      tradeCount: 0,
      expectancy: "0",
      maxDrawdown: "0",
      rDistribution: [],
      equityCurve: [],
      winRateReference: "0"
    };
  }

  const equityCurve: string[] = [];
  let cumulative = "0";
  let peak = "0";
  let maxDrawdown = "0";
  let sum = "0";
  let wins = 0;

  for (const netR of netRs) {
    sum = add(sum, netR);
    cumulative = add(cumulative, netR);
    equityCurve.push(cumulative);

    if (cmp(cumulative, peak) > 0) {
      peak = cumulative;
    }
    const drawdown = sub(peak, cumulative);
    if (cmp(drawdown, maxDrawdown) > 0) {
      maxDrawdown = drawdown;
    }

    if (cmp(netR, "0") > 0) {
      wins += 1;
    }
  }

  return {
    tradeCount,
    expectancy: toDecimalString(div(sum, String(tradeCount))),
    maxDrawdown: toDecimalString(maxDrawdown),
    rDistribution: buildDistribution(netRs),
    equityCurve,
    winRateReference: toDecimalString(div(String(wins), String(tradeCount)))
  };
}

// Deterministic distribution: group by exact net-R value, sorted ascending.
function buildDistribution(netRs: readonly string[]): readonly RDistributionBin[] {
  const counts = new Map<string, number>();
  for (const netR of netRs) {
    counts.set(netR, (counts.get(netR) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([r, count]) => ({ r, count }))
    .sort((left, right) => cmp(left.r, right.r));
}

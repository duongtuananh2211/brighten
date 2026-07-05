import {
  MARKET_SNAPSHOT_SCHEMA_VERSION,
  createTier0,
  createTier1,
  createTier2,
  createTier3
} from "@brighten/decision-core";
import type {
  IngestionPort,
  MarketSnapshot,
  MarketSnapshotRequest,
  Result,
  Tier
} from "@brighten/decision-core";
import type { Tier1AssetClass } from "@brighten/decision-core";
import type { ConfigSnapshot } from "@brighten/config";

import { computeMetrics } from "./metrics.js";
import { replay } from "./replay.js";
import { simulate } from "./simulate.js";
import type { BacktestMetrics, BacktestRun, BacktestStrategyInput, SimulatedTrade } from "./types.js";

export interface RunBacktestDeps {
  readonly ingestion: IngestionPort;
  readonly request: MarketSnapshotRequest;
  readonly strategyInput: BacktestStrategyInput;
  readonly configSnapshot: ConfigSnapshot;
  readonly assetClass: Tier1AssetClass;
  // Defaults to the real epic-1 tier stack; tests may inject overrides.
  readonly tiers?: readonly Tier[];
}

// The same real decision-core tier stack runs live and in backtest.
export function defaultTiers(assetClass: Tier1AssetClass): readonly Tier[] {
  return [createTier0(), createTier1(assetClass), createTier2(), createTier3()];
}

export interface SegmentEvaluation {
  readonly metrics: BacktestMetrics;
  readonly simulated: readonly SimulatedTrade[];
}

export function evaluateSegment(
  snapshot: MarketSnapshot,
  strategyInput: BacktestStrategyInput,
  configSnapshot: ConfigSnapshot,
  assetClass: Tier1AssetClass,
  tiers: readonly Tier[] = defaultTiers(assetClass)
): SegmentEvaluation {
  const emitted = replay(snapshot, strategyInput, configSnapshot, tiers);
  const simulated = simulate(emitted, snapshot, configSnapshot);
  const metrics = computeMetrics(simulated.map((trade) => trade.netR));
  return { metrics, simulated };
}

// Orchestrate replay → simulate → metrics into a reproducible BacktestRun.
// Accounting is fully deterministic (fixed clock, shared decimal precision),
// so identical data + config version + strategy input yields an identical run.
export async function runBacktest(deps: RunBacktestDeps): Promise<Result<BacktestRun>> {
  const snapshotResult = await deps.ingestion.getMarketSnapshot(deps.request);
  if (!snapshotResult.ok) {
    return snapshotResult;
  }

  const snapshot = snapshotResult.value;
  const tiers = deps.tiers ?? defaultTiers(deps.assetClass);
  const { metrics } = evaluateSegment(snapshot, deps.strategyInput, deps.configSnapshot, deps.assetClass, tiers);

  return {
    ok: true,
    value: {
      metrics,
      configSnapshot: deps.configSnapshot,
      dataRange: {
        pair: snapshot.pair,
        timeframe: snapshot.timeframe,
        fromEpochMillis: deps.request.fromEpochMillis,
        toEpochMillis: deps.request.toEpochMillis,
        klineCount: snapshot.klines.length
      },
      snapshotSchemaVersion: MARKET_SNAPSHOT_SCHEMA_VERSION
    }
  };
}

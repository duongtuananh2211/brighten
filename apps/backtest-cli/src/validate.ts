import { MARKET_SNAPSHOT_SCHEMA_VERSION } from "@brighten/decision-core";
import type {
  IngestionPort,
  MarketSnapshot,
  MarketSnapshotRequest,
  Result,
  Tier,
  Tier1AssetClass
} from "@brighten/decision-core";
import type { ConfigSnapshot } from "@brighten/config";

import { bootstrapExpectancyCI } from "./bootstrap.js";
import { assessLiveEligibility } from "./eligibility.js";
import { enforceParamCap } from "./param-cap.js";
import { evaluateSegment, defaultTiers } from "./run.js";
import { reindexStrategyInput, sliceSnapshot } from "./slice.js";
import type {
  BacktestStrategyInput,
  IndexRange,
  SegmentReport,
  ValidationMode,
  ValidationReport,
  WalkForwardSpec
} from "./types.js";
import { splitWalkForward } from "./walk-forward.js";

export interface RunValidationDeps {
  readonly ingestion: IngestionPort;
  readonly request: MarketSnapshotRequest;
  readonly strategyInput: BacktestStrategyInput;
  readonly configSnapshot: ConfigSnapshot;
  readonly assetClass: Tier1AssetClass;
  readonly spec: WalkForwardSpec;
  readonly bootstrap: {
    readonly resamples: number;
    readonly seed: number;
  };
  readonly tunedParamNames: readonly string[];
  readonly paperTradeCompleted: boolean;
  readonly mode: ValidationMode;
  readonly tiers?: readonly Tier[];
}

export async function runValidation(deps: RunValidationDeps): Promise<Result<ValidationReport>> {
  const snapshotResult = await deps.ingestion.getMarketSnapshot(deps.request);
  if (!snapshotResult.ok) {
    return snapshotResult;
  }

  const snapshot = snapshotResult.value;
  const split = splitWalkForward(snapshot, deps.spec);
  if (!split.ok) {
    return { ok: false, error: split.error };
  }

  const tiers = deps.tiers ?? defaultTiers(deps.assetClass);
  const walkForward = split.folds.map((fold) => ({
    inSample: fold.inSample,
    outOfSample: evaluateRange(snapshot, fold.outOfSample, deps.strategyInput, deps.configSnapshot, deps.assetClass, tiers)
  }));
  const holdout = evaluateRange(snapshot, split.holdout, deps.strategyInput, deps.configSnapshot, deps.assetClass, tiers);
  const oosNetRs = walkForward.flatMap((fold) => fold.outOfSample.trades.map((trade) => trade.netR));
  const ciInput = oosNetRs.length > 0 ? oosNetRs : holdout.trades.map((trade) => trade.netR);
  const expectancyCI = bootstrapExpectancyCI(ciInput, deps.bootstrap);
  if (!expectancyCI.ok) {
    return { ok: false, error: expectancyCI.error };
  }

  const paramCap = enforceParamCap(
    deps.tunedParamNames,
    deps.configSnapshot.params.max_tunable_params
  );
  const liveEligibility = assessLiveEligibility({
    holdoutExpectancy: holdout.metrics.expectancy,
    ciLower: expectancyCI.value.lower,
    paperTradeCompleted: deps.paperTradeCompleted
  });

  return {
    ok: true,
    value: {
      mode: deps.mode,
      spec: deps.spec,
      walkForward,
      holdout,
      expectancyCI: expectancyCI.value,
      liveEligibility,
      paramCap,
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

function evaluateRange(
  snapshot: MarketSnapshot,
  range: IndexRange,
  strategyInput: BacktestStrategyInput,
  configSnapshot: ConfigSnapshot,
  assetClass: Tier1AssetClass,
  tiers: readonly Tier[]
): SegmentReport {
  const segmentSnapshot = sliceSnapshot(snapshot, range);
  const segmentInput = reindexStrategyInput(strategyInput, range);
  const evaluated = evaluateSegment(segmentSnapshot, segmentInput, configSnapshot, assetClass, tiers);

  return {
    range,
    metrics: evaluated.metrics,
    trades: evaluated.simulated
  };
}

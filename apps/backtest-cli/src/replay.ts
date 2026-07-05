import { runPipeline } from "@brighten/decision-core";
import type {
  AccountState,
  BehavioralState,
  MarketSnapshot,
  PipelineBaseContext,
  Tier
} from "@brighten/decision-core";
import type { ConfigSnapshot } from "@brighten/config";

import { fixedClock } from "./clock.js";
import type { BacktestStrategyInput, EmittedTrade } from "./types.js";

// Walk the historical snapshot tick-by-tick through the SAME decision-core
// pipeline used live (AD-3). The driver only builds context, runs the pipeline,
// and records emitted suggestions — it never re-implements a decision rule.
export function replay(
  snapshot: MarketSnapshot,
  strategyInput: BacktestStrategyInput,
  configSnapshot: ConfigSnapshot,
  tiers: readonly Tier[]
): readonly EmittedTrade[] {
  const signalsByTick = new Map<number, BacktestStrategyInput["signals"][number]>();
  for (const signal of strategyInput.signals) {
    signalsByTick.set(signal.tickIndex, signal);
  }

  const emitted: EmittedTrade[] = [];

  for (const [tickIndex, kline] of snapshot.klines.entries()) {
    const signal = signalsByTick.get(tickIndex);
    if (signal === undefined) {
      continue;
    }

    const state: BehavioralState = signal?.state ?? strategyInput.state;
    const account: AccountState = signal?.account ?? strategyInput.account;

    const base: PipelineBaseContext = {
      input: windowAt(snapshot, tickIndex),
      state,
      config: configSnapshot,
      ...(account ? { account } : {})
    };

    const result = runPipeline(tiers, base, fixedClock(kline.openTime));

    if (result.outcome === "suggestion" && result.sizing !== undefined) {
      emitted.push({
        entryTickIndex: tickIndex,
        entryEpochMillis: kline.openTime,
        sizing: result.sizing
      });
    }
  }

  return emitted;
}

function windowAt(snapshot: MarketSnapshot, tickIndex: number): MarketSnapshot {
  const kline = snapshot.klines[tickIndex];
  return {
    ...snapshot,
    klines: snapshot.klines.slice(0, tickIndex + 1),
    atEpochMillis: kline?.openTime ?? snapshot.atEpochMillis
  };
}

import {
  computeRoundTripCost,
  evaluateWinStreakDampening,
  runPipeline,
  sizeTrade
} from "@brighten/decision-core";
import type {
  AccountState,
  BehavioralState,
  CostEstimate,
  MarketSnapshot,
  PipelineBaseContext,
  SizingResult,
  Tier,
  TradeCandidate
} from "@brighten/decision-core";
import { mul } from "@brighten/decision-core/math";
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
    const candidate = signal?.candidate;
    const expectedEdge = signal?.expectedEdge;
    const state: BehavioralState = signal?.state ?? strategyInput.state;
    const account: AccountState = signal?.account ?? strategyInput.account;

    // Recompute sizing with the exact core functions Tier 3 uses so the cost
    // estimate (and later accounting) match the pipeline's decision.
    const sizing = deriveSizing(candidate, account, state, configSnapshot);
    const cost = sizing === undefined ? undefined : estimateCost(sizing, configSnapshot);

    const base: PipelineBaseContext = {
      input: windowAt(snapshot, tickIndex),
      state,
      config: configSnapshot,
      ...(candidate ? { candidate } : {}),
      ...(account ? { account } : {}),
      ...(expectedEdge !== undefined ? { expectedEdge } : {}),
      ...(cost ? { cost } : {})
    };

    const result = runPipeline(tiers, base, fixedClock(kline.openTime));

    if (result.outcome === "suggestion" && sizing !== undefined) {
      emitted.push({
        entryTickIndex: tickIndex,
        entryEpochMillis: kline.openTime,
        sizing
      });
    }
  }

  return emitted;
}

// Mirror Tier 3's own sequence: win-streak dampening → sizeTrade. Returns the
// authoritative sizing when the trade would be sized, otherwise undefined (the
// real pipeline will veto and no trade is emitted).
function deriveSizing(
  candidate: TradeCandidate | undefined,
  account: AccountState | undefined,
  state: BehavioralState,
  configSnapshot: ConfigSnapshot
): SizingResult | undefined {
  if (candidate === undefined || account === undefined) {
    return undefined;
  }

  const dampening = evaluateWinStreakDampening({
    winStreak: state.winStreak,
    threshold: configSnapshot.params.win_streak_threshold,
    sizeDampening: configSnapshot.params.size_dampening,
    riskPct: configSnapshot.params.risk_pct
  });
  if (!dampening.ok) {
    return undefined;
  }

  const sizing = sizeTrade({
    equity: account.equity,
    candidate,
    riskPct: dampening.effectiveRiskPct,
    minRr: configSnapshot.params.min_rr
  });

  return sizing.ok ? sizing : undefined;
}

// Cost-hurdle gate input: estimated round-trip fee from estimated notional
// (volume × entry), without funding (funding is only known after the fill).
function estimateCost(sizing: SizingResult, configSnapshot: ConfigSnapshot): CostEstimate | undefined {
  const notional = mul(sizing.volume, sizing.entry);
  const roundTrip = computeRoundTripCost({
    notional,
    feeRate: configSnapshot.params.fee_rate,
    spread: configSnapshot.params.spread,
    slippage: configSnapshot.params.slippage
  });

  return roundTrip.ok ? { roundTripFee: roundTrip.cost } : undefined;
}

function windowAt(snapshot: MarketSnapshot, tickIndex: number): MarketSnapshot {
  const kline = snapshot.klines[tickIndex];
  return {
    ...snapshot,
    klines: snapshot.klines.slice(0, tickIndex + 1),
    atEpochMillis: kline?.openTime ?? snapshot.atEpochMillis
  };
}

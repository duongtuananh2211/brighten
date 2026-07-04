import { computeRoundTripCost } from "@brighten/decision-core";
import type { FundingPoint, Kline, MarketSnapshot } from "@brighten/decision-core";
import { cmp, div, mul, sub, toDecimalString } from "@brighten/decision-core/math";
import type { ConfigSnapshot } from "@brighten/config";

import type { EmittedTrade, ExitReason, SimulatedTrade } from "./types.js";

interface Exit {
  readonly tickIndex: number;
  readonly epochMillis: number;
  readonly price: string;
  readonly reason: ExitReason;
}

// Deterministically walk klines AFTER entry until stop or target is touched,
// then subtract the REAL round-trip cost (fee + spread + slippage + funding held
// over the window) from the gross R-multiple. Pure, no IO, decimal-only.
export function simulate(
  emitted: readonly EmittedTrade[],
  snapshot: MarketSnapshot,
  configSnapshot: ConfigSnapshot
): readonly SimulatedTrade[] {
  const funding = snapshot.funding ?? [];
  return emitted.map((trade) => simulateOne(trade, snapshot.klines, funding, configSnapshot));
}

function simulateOne(
  trade: EmittedTrade,
  klines: readonly Kline[],
  funding: readonly FundingPoint[],
  configSnapshot: ConfigSnapshot
): SimulatedTrade {
  const { sizing } = trade;
  const exit = findExit(trade, klines);

  const grossR = computeGrossR(sizing.direction, sizing.entry, exit.price, sizing.stopDistance);

  const notional = mul(sizing.volume, sizing.entry);
  const heldFunding = funding.filter(
    (point) => point.fundingTime >= trade.entryEpochMillis && point.fundingTime <= exit.epochMillis
  );
  const cost = computeRoundTripCost({
    notional,
    feeRate: configSnapshot.params.fee_rate,
    spread: configSnapshot.params.spread,
    slippage: configSnapshot.params.slippage,
    fundingPoints: heldFunding.map((point) => ({ fundingRate: point.fundingRate }))
  });

  // Invariant: notional is volume × entry (both already validated by core sizing)
  // and cost params are validated config, so this cannot reject in practice.
  const realizedCost = cost.ok ? cost.cost : "0";
  const netR = toDecimalString(sub(grossR, div(realizedCost, sizing.riskAmount)));

  return {
    entryTickIndex: trade.entryTickIndex,
    exitTickIndex: exit.tickIndex,
    entryEpochMillis: trade.entryEpochMillis,
    exitEpochMillis: exit.epochMillis,
    exitReason: exit.reason,
    grossR: toDecimalString(grossR),
    realizedCost,
    netR
  };
}

// Convention (deterministic, documented): scan candles strictly after entry;
// on a candle that touches BOTH stop and target, the stop wins (honest, no rosy
// assumption). If no candle touches either level, close at the last candle's
// close. If there is no candle after entry, close at the entry candle's close.
function findExit(trade: EmittedTrade, klines: readonly Kline[]): Exit {
  const { direction, entry, stop, target } = trade.sizing;

  for (let index = trade.entryTickIndex + 1; index < klines.length; index += 1) {
    const kline = klines[index];
    if (kline === undefined) {
      continue;
    }

    const stopHit =
      direction === "long" ? cmp(kline.low, stop) <= 0 : cmp(kline.high, stop) >= 0;
    const targetHit =
      direction === "long" ? cmp(kline.high, target) >= 0 : cmp(kline.low, target) <= 0;

    if (stopHit) {
      return { tickIndex: index, epochMillis: kline.closeTime, price: stop, reason: "stop" };
    }
    if (targetHit) {
      return { tickIndex: index, epochMillis: kline.closeTime, price: target, reason: "target" };
    }
  }

  // No level touched — close at the last available candle's close.
  const lastIndex = Math.max(trade.entryTickIndex, klines.length - 1);
  const lastKline = klines[lastIndex];
  const entryKline = klines[trade.entryTickIndex];
  const closePrice = lastKline?.close ?? entryKline?.close ?? entry;
  const closeEpoch = lastKline?.closeTime ?? entryKline?.closeTime ?? trade.entryEpochMillis;

  return { tickIndex: lastIndex, epochMillis: closeEpoch, price: closePrice, reason: "close" };
}

function computeGrossR(
  direction: "long" | "short",
  entry: string,
  exitPrice: string,
  stopDistance: string
): string {
  const signedMove = direction === "long" ? sub(exitPrice, entry) : sub(entry, exitPrice);
  return div(signedMove, stopDistance);
}

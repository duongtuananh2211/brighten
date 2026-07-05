import type { ConfigParams } from "@brighten/config";
import { cmp, div, sub, toDecimal } from "../../math/decimal.js";
import type { CoreError, Kline, MarketSnapshot, TradeDirection } from "../../types/index.js";

export type FxSweepSide = "high" | "low";

export interface FxRegimeSignals {
  readonly swingHigh: string;
  readonly swingLow: string;
  readonly range: string;
  readonly highPenetration: string;
  readonly lowPenetration: string;
  readonly sweepSide: FxSweepSide;
}

export interface FxRegimeInput {
  readonly snapshot: MarketSnapshot;
  readonly params: ConfigParams;
}

export interface FxRegimePass {
  readonly ok: true;
  readonly direction: TradeDirection;
  readonly signals: FxRegimeSignals;
}

export interface FxRegimeRejection {
  readonly ok: false;
  readonly error: CoreError;
}

export type FxRegimeOutcome = FxRegimePass | FxRegimeRejection;

interface ParsedKlinePrice {
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
}

export function evaluateFxRegime(input: FxRegimeInput): FxRegimeOutcome {
  const params = validateFxParams(input.params);
  if (!params.ok) {
    return params;
  }

  const { klines } = input.snapshot;
  const requiredKlines = Math.max(params.value.fxMinDataPoints, params.value.fxSwingLookback + 1);
  if (klines.length < requiredKlines) {
    return reject("insufficient_data", {
      requiredKlines,
      klineCount: klines.length,
      message: "Tier1 FX regime requires enough klines for swing window plus candidate"
    });
  }

  const candidate = klines[klines.length - 1];
  if (candidate === undefined) {
    return reject("insufficient_data", {
      requiredKlines,
      klineCount: klines.length,
      message: "Tier1 FX regime requires a candidate kline"
    });
  }

  const windowStart = klines.length - 1 - params.value.fxSwingLookback;
  const swingWindow = klines.slice(windowStart, klines.length - 1);
  const swing = calculateSwing(swingWindow);
  if (!swing.ok) {
    return swing;
  }

  const range = sub(swing.swingHigh, swing.swingLow);
  if (cmp(range, "0") === 0) {
    return reject("insufficient_data", {
      swingHigh: swing.swingHigh,
      swingLow: swing.swingLow,
      message: "Tier1 FX swing range is zero"
    });
  }

  const candidatePrice = parseKlinePrice(candidate, klines.length - 1);
  if (!candidatePrice.ok) {
    return candidatePrice;
  }

  const highPenetration = div(sub(candidatePrice.value.high, swing.swingHigh), range);
  const lowPenetration = div(sub(swing.swingLow, candidatePrice.value.low), range);
  const highSweep =
    cmp(candidatePrice.value.high, swing.swingHigh) > 0 &&
    cmp(candidatePrice.value.close, swing.swingHigh) < 0 &&
    cmp(highPenetration, params.value.fxSweepMinPenetration) >= 0;
  const lowSweep =
    cmp(candidatePrice.value.low, swing.swingLow) < 0 &&
    cmp(candidatePrice.value.close, swing.swingLow) > 0 &&
    cmp(lowPenetration, params.value.fxSweepMinPenetration) >= 0;

  if (highSweep && lowSweep) {
    return reject("conflicting_signals", {
      swingHigh: swing.swingHigh,
      swingLow: swing.swingLow,
      highPenetration,
      lowPenetration,
      message: "FX candidate swept both swing high and swing low"
    });
  }

  if (!highSweep && !lowSweep) {
    return reject("no_liquidity_sweep", {
      swingHigh: swing.swingHigh,
      swingLow: swing.swingLow,
      highPenetration,
      lowPenetration,
      message: "FX candidate did not sweep liquidity with reversal"
    });
  }

  const sweepSide: FxSweepSide = highSweep ? "high" : "low";
  return {
    ok: true,
    direction: sweepSide === "high" ? "short" : "long",
    signals: {
      swingHigh: swing.swingHigh,
      swingLow: swing.swingLow,
      range,
      highPenetration,
      lowPenetration,
      sweepSide
    }
  };
}

function validateFxParams(params: ConfigParams):
  | {
      readonly ok: true;
      readonly value: {
        readonly fxSwingLookback: number;
        readonly fxSweepMinPenetration: string;
        readonly fxMinDataPoints: number;
      };
    }
  | FxRegimeRejection {
  if (!Number.isInteger(params.fx_swing_lookback) || params.fx_swing_lookback < 1) {
    return invalidTier1Param("fx_swing_lookback", "Expected integer >= 1");
  }

  if (!Number.isInteger(params.fx_min_data_points) || params.fx_min_data_points < 1) {
    return invalidTier1Param("fx_min_data_points", "Expected integer >= 1");
  }

  const fxSweepMinPenetration = parseParamDecimal(params.fx_sweep_min_penetration, "fx_sweep_min_penetration");
  if (!fxSweepMinPenetration.ok) {
    return fxSweepMinPenetration;
  }
  if (cmp(fxSweepMinPenetration.value, "0") < 0) {
    return invalidTier1Param("fx_sweep_min_penetration", "Expected decimal string >= 0");
  }

  return {
    ok: true,
    value: {
      fxSwingLookback: params.fx_swing_lookback,
      fxSweepMinPenetration: fxSweepMinPenetration.value,
      fxMinDataPoints: params.fx_min_data_points
    }
  };
}

function calculateSwing(klines: readonly Kline[]):
  | {
      readonly ok: true;
      readonly swingHigh: string;
      readonly swingLow: string;
    }
  | FxRegimeRejection {
  let swingHigh: string | undefined;
  let swingLow: string | undefined;

  for (const [index, kline] of klines.entries()) {
    const price = parseKlinePrice(kline, index);
    if (!price.ok) {
      return price;
    }

    swingHigh = swingHigh === undefined || cmp(price.value.high, swingHigh) > 0 ? price.value.high : swingHigh;
    swingLow = swingLow === undefined || cmp(price.value.low, swingLow) < 0 ? price.value.low : swingLow;
  }

  if (swingHigh === undefined || swingLow === undefined) {
    return reject("insufficient_data", {
      message: "Tier1 FX swing window is empty"
    });
  }

  return { ok: true, swingHigh, swingLow };
}

function parseKlinePrice(kline: Kline, index: number):
  | { readonly ok: true; readonly value: ParsedKlinePrice }
  | FxRegimeRejection {
  const open = parseSignalDecimal(kline.open, "open", index);
  if (!open.ok) {
    return open;
  }

  const high = parseSignalDecimal(kline.high, "high", index);
  if (!high.ok) {
    return high;
  }

  const low = parseSignalDecimal(kline.low, "low", index);
  if (!low.ok) {
    return low;
  }

  const close = parseSignalDecimal(kline.close, "close", index);
  if (!close.ok) {
    return close;
  }

  return {
    ok: true,
    value: {
      open: open.value,
      high: high.value,
      low: low.value,
      close: close.value
    }
  };
}

function parseParamDecimal(value: string, field: string): { readonly ok: true; readonly value: string } | FxRegimeRejection {
  try {
    return { ok: true, value: toDecimal(value) };
  } catch {
    return invalidTier1Param(field, "Expected finite decimal string");
  }
}

function parseSignalDecimal(
  value: string,
  field: string,
  index: number
): { readonly ok: true; readonly value: string } | FxRegimeRejection {
  try {
    return { ok: true, value: toDecimal(value) };
  } catch {
    return reject("invalid_decimal_string", {
      field,
      index,
      message: "Expected finite decimal string"
    });
  }
}

function invalidTier1Param(field: string, message: string): FxRegimeRejection {
  return reject("invalid_tier1_param", { field, message });
}

function reject(code: string, context: Readonly<Record<string, unknown>>): FxRegimeRejection {
  return {
    ok: false,
    error: {
      code,
      source: "tier1.fx_regime",
      context
    }
  };
}

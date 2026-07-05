import type { ConfigParams } from "@brighten/config";
import { add, cmp, mul, sub, toDecimal } from "../../math/decimal.js";
import type { CoreError, Kline, MarketSnapshot, TradeCandidate, TradeDirection } from "../../types/index.js";

const source = "tier2.entry_zone";

export interface EntryZoneSignals {
  readonly swingHigh: string;
  readonly swingLow: string;
  readonly range: string;
}

export interface EntryZoneInput {
  readonly direction: TradeDirection;
  readonly snapshot: MarketSnapshot;
  readonly params: ConfigParams;
}

export interface EntryZonePass {
  readonly ok: true;
  readonly candidate: TradeCandidate;
  readonly signals: EntryZoneSignals;
}

export interface EntryZoneRejection {
  readonly ok: false;
  readonly error: CoreError;
}

export type EntryZoneOutcome = EntryZonePass | EntryZoneRejection;

interface ParsedKlinePrice {
  readonly high: string;
  readonly low: string;
  readonly close: string;
}

export function evaluateEntryZone(input: EntryZoneInput): EntryZoneOutcome {
  const params = validateTier2Params(input.params);
  if (!params.ok) {
    return params;
  }

  const { klines } = input.snapshot;
  const requiredKlines = Math.max(params.value.tier2MinDataPoints, params.value.tier2SwingLookback + 1);
  if (klines.length < requiredKlines) {
    return reject("insufficient_data", "Tier2 entry zone requires enough klines for swing window", {
      requiredKlines,
      klineCount: klines.length
    });
  }

  const window = klines.slice(klines.length - params.value.tier2SwingLookback);
  const swing = calculateSwing(window, klines.length - window.length);
  if (!swing.ok) {
    return swing;
  }

  const range = sub(swing.swingHigh, swing.swingLow);
  if (cmp(range, "0") === 0) {
    return reject("insufficient_data", "Tier2 swing range is zero", {
      swingHigh: swing.swingHigh,
      swingLow: swing.swingLow
    });
  }

  const last = klines[klines.length - 1];
  if (last === undefined) {
    return reject("insufficient_data", "Tier2 entry zone requires a latest kline", {
      requiredKlines,
      klineCount: klines.length
    });
  }

  const lastPrice = parseKlinePrice(last, klines.length - 1);
  if (!lastPrice.ok) {
    return lastPrice;
  }

  const stopDistance = mul(params.value.tier2StopBuffer, range);
  if (cmp(stopDistance, "0") === 0) {
    return reject("no_setup", "Tier2 stop distance is zero", {
      tier2StopBuffer: params.value.tier2StopBuffer,
      range
    });
  }

  const candidate = buildCandidate(input.direction, swing.swingHigh, swing.swingLow, stopDistance);
  if (input.direction === "long" && cmp(lastPrice.value.close, candidate.target) >= 0) {
    return reject("no_setup", "Long setup has already reached target", {
      lastClose: lastPrice.value.close,
      target: candidate.target
    });
  }

  if (input.direction === "short" && cmp(lastPrice.value.close, candidate.target) <= 0) {
    return reject("no_setup", "Short setup has already reached target", {
      lastClose: lastPrice.value.close,
      target: candidate.target
    });
  }

  return {
    ok: true,
    candidate,
    signals: {
      swingHigh: swing.swingHigh,
      swingLow: swing.swingLow,
      range
    }
  };
}

function validateTier2Params(params: ConfigParams):
  | {
      readonly ok: true;
      readonly value: {
        readonly tier2SwingLookback: number;
        readonly tier2StopBuffer: string;
        readonly tier2MinDataPoints: number;
      };
    }
  | EntryZoneRejection {
  if (!Number.isInteger(params.tier2_swing_lookback) || params.tier2_swing_lookback < 1) {
    return invalidTier2Param("tier2_swing_lookback", "Expected integer >= 1");
  }

  if (!Number.isInteger(params.tier2_min_data_points) || params.tier2_min_data_points < 1) {
    return invalidTier2Param("tier2_min_data_points", "Expected integer >= 1");
  }

  const tier2StopBuffer = parseParamDecimal(params.tier2_stop_buffer, "tier2_stop_buffer");
  if (!tier2StopBuffer.ok) {
    return tier2StopBuffer;
  }
  if (cmp(tier2StopBuffer.value, "0") < 0) {
    return invalidTier2Param("tier2_stop_buffer", "Expected decimal string >= 0");
  }

  return {
    ok: true,
    value: {
      tier2SwingLookback: params.tier2_swing_lookback,
      tier2StopBuffer: tier2StopBuffer.value,
      tier2MinDataPoints: params.tier2_min_data_points
    }
  };
}

function calculateSwing(klines: readonly Kline[], indexOffset: number):
  | { readonly ok: true; readonly swingHigh: string; readonly swingLow: string }
  | EntryZoneRejection {
  let swingHigh: string | undefined;
  let swingLow: string | undefined;

  for (const [offset, kline] of klines.entries()) {
    const price = parseKlinePrice(kline, indexOffset + offset);
    if (!price.ok) {
      return price;
    }

    swingHigh = swingHigh === undefined || cmp(price.value.high, swingHigh) > 0 ? price.value.high : swingHigh;
    swingLow = swingLow === undefined || cmp(price.value.low, swingLow) < 0 ? price.value.low : swingLow;
  }

  if (swingHigh === undefined || swingLow === undefined) {
    return reject("insufficient_data", "Tier2 swing window is empty", {});
  }

  return { ok: true, swingHigh, swingLow };
}

function buildCandidate(
  direction: TradeDirection,
  swingHigh: string,
  swingLow: string,
  stopDistance: string
): TradeCandidate {
  if (direction === "long") {
    return {
      direction,
      entry: swingLow,
      stop: sub(swingLow, stopDistance),
      target: swingHigh
    };
  }

  return {
    direction,
    entry: swingHigh,
    stop: add(swingHigh, stopDistance),
    target: swingLow
  };
}

function parseKlinePrice(kline: Kline, index: number):
  | { readonly ok: true; readonly value: ParsedKlinePrice }
  | EntryZoneRejection {
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

  return { ok: true, value: { high: high.value, low: low.value, close: close.value } };
}

function parseParamDecimal(value: string, field: string): { readonly ok: true; readonly value: string } | EntryZoneRejection {
  try {
    return { ok: true, value: toDecimal(value) };
  } catch {
    return invalidTier2Param(field, "Expected finite decimal string");
  }
}

function parseSignalDecimal(
  value: string,
  field: string,
  index: number
): { readonly ok: true; readonly value: string } | EntryZoneRejection {
  try {
    return { ok: true, value: toDecimal(value) };
  } catch {
    return reject("invalid_decimal_string", "Expected finite decimal string", { field, index });
  }
}

function invalidTier2Param(field: string, message: string): EntryZoneRejection {
  return reject("invalid_tier2_param", message, { field });
}

function reject(
  code: string,
  message: string,
  context: Readonly<Record<string, unknown>>
): EntryZoneRejection {
  return {
    ok: false,
    error: {
      code,
      source,
      context: {
        ...context,
        message
      }
    }
  };
}

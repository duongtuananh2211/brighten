import type { ConfigParams } from "@brighten/config";
import { cmp, div, sub, toDecimal } from "../../math/decimal.js";
import type { CoreError, MarketSnapshot, TradeDirection } from "../../types/index.js";
import { accumulateCvd } from "./cvd.js";

export type CryptoRegimeVote = TradeDirection | "neutral";

export interface CryptoRegimeSignals {
  readonly fundingRate: string;
  readonly longShortRatio: string;
  readonly cvd: string;
  readonly oiDeltaRatio: string;
  readonly fundingVote: CryptoRegimeVote;
  readonly longShortVote: CryptoRegimeVote;
  readonly cvdVote: CryptoRegimeVote;
}

export interface CryptoRegimeInput {
  readonly snapshot: MarketSnapshot;
  readonly params: ConfigParams;
}

export interface CryptoRegimePass {
  readonly ok: true;
  readonly direction: TradeDirection;
  readonly signals: CryptoRegimeSignals;
}

export interface CryptoRegimeRejection {
  readonly ok: false;
  readonly error: CoreError;
}

export type CryptoRegimeOutcome = CryptoRegimePass | CryptoRegimeRejection;

export function evaluateCryptoRegime(input: CryptoRegimeInput): CryptoRegimeOutcome {
  const params = validateTier1Params(input.params);
  if (!params.ok) {
    return params;
  }

  const { snapshot } = input;
  if (
    snapshot.funding === undefined ||
    snapshot.openInterest === undefined ||
    snapshot.longShortRatio === undefined ||
    snapshot.funding.length < input.params.tier1_min_data_points ||
    snapshot.openInterest.length < input.params.tier1_min_data_points ||
    snapshot.longShortRatio.length < input.params.tier1_min_data_points ||
    snapshot.klines.length < input.params.tier1_min_data_points
  ) {
    return reject("insufficient_data", {
      minDataPoints: input.params.tier1_min_data_points,
      fundingCount: snapshot.funding?.length ?? 0,
      openInterestCount: snapshot.openInterest?.length ?? 0,
      longShortRatioCount: snapshot.longShortRatio?.length ?? 0,
      klineCount: snapshot.klines.length,
      message: "Tier1 crypto regime requires enough funding, open interest, long/short ratio, and kline data"
    });
  }

  const fundingPoint = snapshot.funding[snapshot.funding.length - 1];
  const lsrPoint = snapshot.longShortRatio[snapshot.longShortRatio.length - 1];
  const firstOpenInterestPoint = snapshot.openInterest[0];
  const lastOpenInterestPoint = snapshot.openInterest[snapshot.openInterest.length - 1];
  if (
    fundingPoint === undefined ||
    lsrPoint === undefined ||
    firstOpenInterestPoint === undefined ||
    lastOpenInterestPoint === undefined
  ) {
    return reject("insufficient_data", {
      message: "Tier1 crypto regime requires first and last data points"
    });
  }

  const fundingRate = parseSignalDecimal(fundingPoint.fundingRate, "fundingRate");
  if (!fundingRate.ok) {
    return fundingRate;
  }

  const longShortRatio = parseSignalDecimal(lsrPoint.longShortRatio, "longShortRatio");
  if (!longShortRatio.ok) {
    return longShortRatio;
  }

  const firstOpenInterest = parseSignalDecimal(firstOpenInterestPoint.sumOpenInterest, "sumOpenInterest");
  if (!firstOpenInterest.ok) {
    return firstOpenInterest;
  }
  if (cmp(firstOpenInterest.value, "0") === 0) {
    return reject("invalid_decimal_string", {
      field: "sumOpenInterest",
      message: "Expected non-zero decimal string"
    });
  }

  const lastOpenInterest = parseSignalDecimal(lastOpenInterestPoint.sumOpenInterest, "sumOpenInterest");
  if (!lastOpenInterest.ok) {
    return lastOpenInterest;
  }

  const cvd = accumulateCvd(snapshot.klines);
  if (!cvd.ok) {
    return cvd;
  }

  const oiDeltaRatio = div(sub(lastOpenInterest.value, firstOpenInterest.value), firstOpenInterest.value);
  const fundingVote = voteFunding(fundingRate.value, params.value.fundingExtremeThreshold);
  const longShortVote = voteLongShort(longShortRatio.value, params.value.longShortExtremeRatio);
  const cvdVote = voteCvd(cvd.cvd);
  const votes = [fundingVote, longShortVote, cvdVote] as const;
  const nonNeutralVotes = votes.filter((vote): vote is TradeDirection => vote !== "neutral");

  if (nonNeutralVotes.length === 0) {
    return reject("no_edge_below_threshold", {
      fundingRate: fundingRate.value,
      longShortRatio: longShortRatio.value,
      cvd: cvd.cvd,
      message: "All tier1 crypto votes are neutral"
    });
  }

  const direction = nonNeutralVotes[0];
  if (direction === undefined) {
    return reject("no_edge_below_threshold", {
      message: "All tier1 crypto votes are neutral"
    });
  }

  if (nonNeutralVotes.some((vote) => vote !== direction)) {
    return reject("conflicting_signals", {
      fundingVote,
      longShortVote,
      cvdVote,
      message: "Tier1 crypto votes conflict"
    });
  }

  if (cmp(oiDeltaRatio, params.value.oiConfirmationMin) < 0) {
    return reject("oi_unconfirmed", {
      oiDeltaRatio,
      oiConfirmationMin: params.value.oiConfirmationMin,
      message: "Open interest did not increase enough to confirm direction"
    });
  }

  return {
    ok: true,
    direction,
    signals: {
      fundingRate: fundingRate.value,
      longShortRatio: longShortRatio.value,
      cvd: cvd.cvd,
      oiDeltaRatio,
      fundingVote,
      longShortVote,
      cvdVote
    }
  };
}

function validateTier1Params(params: ConfigParams):
  | {
      readonly ok: true;
      readonly value: {
        readonly fundingExtremeThreshold: string;
        readonly longShortExtremeRatio: string;
        readonly oiConfirmationMin: string;
      };
    }
  | CryptoRegimeRejection {
  const fundingExtremeThreshold = parseParamDecimal(params.funding_extreme_threshold, "funding_extreme_threshold");
  if (!fundingExtremeThreshold.ok) {
    return fundingExtremeThreshold;
  }
  if (cmp(fundingExtremeThreshold.value, "0") < 0) {
    return invalidTier1Param("funding_extreme_threshold", "Expected decimal string >= 0");
  }

  const longShortExtremeRatio = parseParamDecimal(params.long_short_extreme_ratio, "long_short_extreme_ratio");
  if (!longShortExtremeRatio.ok) {
    return longShortExtremeRatio;
  }
  if (cmp(longShortExtremeRatio.value, "1") <= 0) {
    return invalidTier1Param("long_short_extreme_ratio", "Expected decimal string > 1");
  }

  const oiConfirmationMin = parseParamDecimal(params.oi_confirmation_min, "oi_confirmation_min");
  if (!oiConfirmationMin.ok) {
    return oiConfirmationMin;
  }
  if (cmp(oiConfirmationMin.value, "0") < 0) {
    return invalidTier1Param("oi_confirmation_min", "Expected decimal string >= 0");
  }

  if (!Number.isInteger(params.tier1_min_data_points) || params.tier1_min_data_points < 1) {
    return invalidTier1Param("tier1_min_data_points", "Expected integer >= 1");
  }

  return {
    ok: true,
    value: {
      fundingExtremeThreshold: fundingExtremeThreshold.value,
      longShortExtremeRatio: longShortExtremeRatio.value,
      oiConfirmationMin: oiConfirmationMin.value
    }
  };
}

function voteFunding(fundingRate: string, fundingExtremeThreshold: string): CryptoRegimeVote {
  if (cmp(fundingRate, fundingExtremeThreshold) >= 0) {
    return "short";
  }

  if (cmp(fundingRate, sub("0", fundingExtremeThreshold)) <= 0) {
    return "long";
  }

  return "neutral";
}

function voteLongShort(longShortRatio: string, longShortExtremeRatio: string): CryptoRegimeVote {
  if (cmp(longShortRatio, longShortExtremeRatio) >= 0) {
    return "short";
  }

  if (cmp(longShortRatio, div("1", longShortExtremeRatio)) <= 0) {
    return "long";
  }

  return "neutral";
}

function voteCvd(cvd: string): CryptoRegimeVote {
  const comparedToZero = cmp(cvd, "0");
  if (comparedToZero > 0) {
    return "long";
  }

  if (comparedToZero < 0) {
    return "short";
  }

  return "neutral";
}

function parseParamDecimal(value: string, field: string): { readonly ok: true; readonly value: string } | CryptoRegimeRejection {
  try {
    return { ok: true, value: toDecimal(value) };
  } catch {
    return invalidTier1Param(field, "Expected finite decimal string");
  }
}

function parseSignalDecimal(value: string, field: string): { readonly ok: true; readonly value: string } | CryptoRegimeRejection {
  try {
    return { ok: true, value: toDecimal(value) };
  } catch {
    return reject("invalid_decimal_string", {
      field,
      message: "Expected finite decimal string"
    });
  }
}

function invalidTier1Param(field: string, message: string): CryptoRegimeRejection {
  return reject("invalid_tier1_param", { field, message });
}

function reject(code: string, context: Readonly<Record<string, unknown>>): CryptoRegimeRejection {
  return {
    ok: false,
    error: {
      code,
      source: "tier1.crypto_regime",
      context
    }
  };
}

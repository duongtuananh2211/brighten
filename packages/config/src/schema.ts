export interface ConfigError {
  readonly code: string;
  readonly source: "config.validation";
  readonly context: Readonly<Record<string, unknown>>;
}

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ConfigError };

export interface NewsBlackoutWindow {
  readonly startsAt: number;
  readonly endsAt: number;
  readonly reason?: string;
  readonly pairs?: readonly string[];
}

export interface ConfigParams {
  readonly cooldown_after_loss: number;
  readonly win_streak_threshold: number;
  readonly size_dampening: string;
  readonly daily_loss_limit: string;
  readonly max_trades_per_day: number;
  readonly max_tunable_params: number;
  readonly funding_extreme_threshold: string;
  readonly long_short_extreme_ratio: string;
  readonly oi_confirmation_min: string;
  readonly tier1_min_data_points: number;
  readonly fx_swing_lookback: number;
  readonly fx_sweep_min_penetration: string;
  readonly fx_min_data_points: number;
  readonly tier2_swing_lookback: number;
  readonly tier2_stop_buffer: string;
  readonly tier2_min_data_points: number;
  readonly min_rr: string;
  readonly risk_pct: string;
  readonly cost_hurdle_x: string;
  readonly overtrade_cost_ratio_limit: string;
  readonly fee_rate: string;
  readonly spread: string;
  readonly slippage: string;
  readonly news_blackout_buffer_before_ms: number;
  readonly news_blackout_buffer_after_ms: number;
  readonly news_blackout: readonly NewsBlackoutWindow[];
  readonly trading_day_boundary: string;
  readonly drift_min_samples: number;
  readonly drift_window: number;
  readonly override_cooldown_ms: number;
  readonly override_ttl_ms: number;
}

export const DEFAULT_PARAMS: ConfigParams = {
  cooldown_after_loss: 300_000,
  win_streak_threshold: 3,
  size_dampening: "0.5",
  daily_loss_limit: "100",
  max_trades_per_day: 5,
  max_tunable_params: 5,
  funding_extreme_threshold: "0.0005",
  long_short_extreme_ratio: "2",
  oi_confirmation_min: "0.01",
  tier1_min_data_points: 2,
  fx_swing_lookback: 20,
  fx_sweep_min_penetration: "0.0005",
  fx_min_data_points: 21,
  tier2_swing_lookback: 20,
  tier2_stop_buffer: "0.1",
  tier2_min_data_points: 21,
  min_rr: "1.5",
  risk_pct: "1",
  cost_hurdle_x: "1",
  overtrade_cost_ratio_limit: "0.3",
  fee_rate: "0.0004",
  spread: "0.0001",
  slippage: "0.0002",
  news_blackout_buffer_before_ms: 1_800_000,
  news_blackout_buffer_after_ms: 1_800_000,
  news_blackout: [],
  trading_day_boundary: "UTC 00:00",
  drift_min_samples: 20,
  drift_window: 50,
  override_cooldown_ms: 60_000,
  override_ttl_ms: 300_000
};

const decimalPattern = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const tradingDayBoundaryPattern = /^UTC(?:[+-](?:0\d|1[0-4]):[0-5]\d| (?:[01]\d|2[0-3]):[0-5]\d)$/;

export function validateParams(input: unknown): Result<ConfigParams> {
  if (!isRecord(input)) {
    return invalid("invalid_config_params", "params", "Config params must be an object");
  }

  const fieldNames = [
    "cooldown_after_loss",
    "win_streak_threshold",
    "size_dampening",
    "daily_loss_limit",
    "max_trades_per_day",
    "max_tunable_params",
    "funding_extreme_threshold",
    "long_short_extreme_ratio",
    "oi_confirmation_min",
    "tier1_min_data_points",
    "fx_swing_lookback",
    "fx_sweep_min_penetration",
    "fx_min_data_points",
    "tier2_swing_lookback",
    "tier2_stop_buffer",
    "tier2_min_data_points",
    "min_rr",
    "risk_pct",
    "cost_hurdle_x",
    "overtrade_cost_ratio_limit",
    "fee_rate",
    "spread",
    "slippage",
    "news_blackout_buffer_before_ms",
    "news_blackout_buffer_after_ms",
    "news_blackout",
    "trading_day_boundary",
    "drift_min_samples",
    "drift_window",
    "override_cooldown_ms",
    "override_ttl_ms"
  ] as const;

  for (const fieldName of fieldNames) {
    if (!(fieldName in input)) {
      return invalid("missing_config_param", fieldName, "Config param is required");
    }
  }

  const cooldownAfterLoss = input.cooldown_after_loss;
  if (!isNonNegativeInteger(cooldownAfterLoss)) {
    return invalid("invalid_non_negative_integer", "cooldown_after_loss", "Expected integer >= 0");
  }

  const winStreakThreshold = input.win_streak_threshold;
  if (!isPositiveInteger(winStreakThreshold)) {
    return invalid("invalid_positive_integer", "win_streak_threshold", "Expected integer >= 1");
  }

  const maxTradesPerDay = input.max_trades_per_day;
  if (!isPositiveInteger(maxTradesPerDay)) {
    return invalid("invalid_positive_integer", "max_trades_per_day", "Expected integer >= 1");
  }

  const maxTunableParams = input.max_tunable_params;
  if (!isPositiveInteger(maxTunableParams)) {
    return invalid("invalid_positive_integer", "max_tunable_params", "Expected integer >= 1");
  }

  const newsBlackoutBufferBeforeMs = input.news_blackout_buffer_before_ms;
  if (!isNonNegativeInteger(newsBlackoutBufferBeforeMs)) {
    return invalid("invalid_non_negative_integer", "news_blackout_buffer_before_ms", "Expected integer >= 0");
  }

  const newsBlackoutBufferAfterMs = input.news_blackout_buffer_after_ms;
  if (!isNonNegativeInteger(newsBlackoutBufferAfterMs)) {
    return invalid("invalid_non_negative_integer", "news_blackout_buffer_after_ms", "Expected integer >= 0");
  }
  if (newsBlackoutBufferBeforeMs + newsBlackoutBufferAfterMs <= 0) {
    return invalid(
      "invalid_news_blackout_buffer",
      "news_blackout_buffer_after_ms",
      "before+after must be > 0"
    );
  }

  const tier1MinDataPoints = input.tier1_min_data_points;
  if (!isPositiveInteger(tier1MinDataPoints)) {
    return invalid("invalid_positive_integer", "tier1_min_data_points", "Expected integer >= 1");
  }

  const fxSwingLookback = input.fx_swing_lookback;
  if (!isPositiveInteger(fxSwingLookback)) {
    return invalid("invalid_positive_integer", "fx_swing_lookback", "Expected integer >= 1");
  }

  const fxMinDataPoints = input.fx_min_data_points;
  if (!isPositiveInteger(fxMinDataPoints)) {
    return invalid("invalid_positive_integer", "fx_min_data_points", "Expected integer >= 1");
  }

  const tier2SwingLookback = input.tier2_swing_lookback;
  if (!isPositiveInteger(tier2SwingLookback)) {
    return invalid("invalid_positive_integer", "tier2_swing_lookback", "Expected integer >= 1");
  }

  const tier2MinDataPoints = input.tier2_min_data_points;
  if (!isPositiveInteger(tier2MinDataPoints)) {
    return invalid("invalid_positive_integer", "tier2_min_data_points", "Expected integer >= 1");
  }

  const fundingExtremeThreshold = validateNonNegativeDecimalField(
    "funding_extreme_threshold",
    input.funding_extreme_threshold
  );
  if (!fundingExtremeThreshold.ok) {
    return fundingExtremeThreshold;
  }

  const longShortExtremeRatio = validateDecimalField("long_short_extreme_ratio", input.long_short_extreme_ratio);
  if (!longShortExtremeRatio.ok) {
    return longShortExtremeRatio;
  }
  if (compareNonNegativeDecimalStrings(longShortExtremeRatio.value, "1") <= 0) {
    return invalid("invalid_tier1_param", "long_short_extreme_ratio", "Expected decimal string > 1");
  }

  const oiConfirmationMin = validateNonNegativeDecimalField("oi_confirmation_min", input.oi_confirmation_min);
  if (!oiConfirmationMin.ok) {
    return oiConfirmationMin;
  }

  const fxSweepMinPenetration = validateNonNegativeDecimalField(
    "fx_sweep_min_penetration",
    input.fx_sweep_min_penetration
  );
  if (!fxSweepMinPenetration.ok) {
    return fxSweepMinPenetration;
  }

  const tier2StopBuffer = validateNonNegativeDecimalField("tier2_stop_buffer", input.tier2_stop_buffer);
  if (!tier2StopBuffer.ok) {
    return tier2StopBuffer;
  }

  const sizeDampening = validateDecimalField("size_dampening", input.size_dampening);
  if (!sizeDampening.ok) {
    return sizeDampening;
  }

  const dailyLossLimit = validateDecimalField("daily_loss_limit", input.daily_loss_limit);
  if (!dailyLossLimit.ok) {
    return dailyLossLimit;
  }

  const minRr = validateDecimalField("min_rr", input.min_rr);
  if (!minRr.ok) {
    return minRr;
  }

  const riskPct = validateDecimalField("risk_pct", input.risk_pct);
  if (!riskPct.ok) {
    return riskPct;
  }

  const costHurdleX = validateDecimalField("cost_hurdle_x", input.cost_hurdle_x);
  if (!costHurdleX.ok) {
    return costHurdleX;
  }

  const overtradeCostRatioLimit = validateDecimalField(
    "overtrade_cost_ratio_limit",
    input.overtrade_cost_ratio_limit
  );
  if (!overtradeCostRatioLimit.ok) {
    return overtradeCostRatioLimit;
  }

  const feeRate = validateNonNegativeDecimalField("fee_rate", input.fee_rate);
  if (!feeRate.ok) {
    return feeRate;
  }

  const spread = validateNonNegativeDecimalField("spread", input.spread);
  if (!spread.ok) {
    return spread;
  }

  const slippage = validateNonNegativeDecimalField("slippage", input.slippage);
  if (!slippage.ok) {
    return slippage;
  }

  if (decimalToNumber(riskPct.value) >= 100) {
    return invalid("invalid_risk_pct", "risk_pct", "Expected decimal string > 0 and < 100");
  }

  const newsBlackoutResult = validateNewsBlackout(input.news_blackout);
  if (!newsBlackoutResult.ok) {
    return newsBlackoutResult;
  }

  const tradingDayBoundary = input.trading_day_boundary;
  if (typeof tradingDayBoundary !== "string" || !tradingDayBoundaryPattern.test(tradingDayBoundary)) {
    return invalid(
      "invalid_trading_day_boundary",
      "trading_day_boundary",
      "Expected UTC HH:mm or UTC+HH:mm/UTC-HH:mm"
    );
  }

  const driftMinSamples = input.drift_min_samples;
  if (!isPositiveInteger(driftMinSamples)) {
    return invalid("invalid_positive_integer", "drift_min_samples", "Expected integer >= 1");
  }

  const driftWindow = input.drift_window;
  if (!isPositiveInteger(driftWindow)) {
    return invalid("invalid_positive_integer", "drift_window", "Expected integer >= 1");
  }

  const overrideCooldownMs = input.override_cooldown_ms;
  if (!isNonNegativeInteger(overrideCooldownMs)) {
    return invalid("invalid_non_negative_integer", "override_cooldown_ms", "Expected integer >= 0");
  }

  const overrideTtlMs = input.override_ttl_ms;
  if (!isPositiveInteger(overrideTtlMs)) {
    return invalid("invalid_positive_integer", "override_ttl_ms", "Expected integer >= 1");
  }

  return {
    ok: true,
    value: {
      cooldown_after_loss: cooldownAfterLoss,
      win_streak_threshold: winStreakThreshold,
      size_dampening: sizeDampening.value,
      daily_loss_limit: dailyLossLimit.value,
      max_trades_per_day: maxTradesPerDay,
      max_tunable_params: maxTunableParams,
      funding_extreme_threshold: fundingExtremeThreshold.value,
      long_short_extreme_ratio: longShortExtremeRatio.value,
      oi_confirmation_min: oiConfirmationMin.value,
      tier1_min_data_points: tier1MinDataPoints,
      fx_swing_lookback: fxSwingLookback,
      fx_sweep_min_penetration: fxSweepMinPenetration.value,
      fx_min_data_points: fxMinDataPoints,
      tier2_swing_lookback: tier2SwingLookback,
      tier2_stop_buffer: tier2StopBuffer.value,
      tier2_min_data_points: tier2MinDataPoints,
      min_rr: minRr.value,
      risk_pct: riskPct.value,
      cost_hurdle_x: costHurdleX.value,
      overtrade_cost_ratio_limit: overtradeCostRatioLimit.value,
      fee_rate: feeRate.value,
      spread: spread.value,
      slippage: slippage.value,
      news_blackout_buffer_before_ms: newsBlackoutBufferBeforeMs,
      news_blackout_buffer_after_ms: newsBlackoutBufferAfterMs,
      news_blackout: newsBlackoutResult.value,
      trading_day_boundary: tradingDayBoundary,
      drift_min_samples: driftMinSamples,
      drift_window: driftWindow,
      override_cooldown_ms: overrideCooldownMs,
      override_ttl_ms: overrideTtlMs
    }
  };
}

function validateNewsBlackout(value: unknown): Result<readonly NewsBlackoutWindow[]> {
  if (!Array.isArray(value)) {
    return invalid("invalid_news_blackout", "news_blackout", "Expected an array");
  }

  const windows: NewsBlackoutWindow[] = [];
  for (const [index, window] of value.entries()) {
    if (!isRecord(window)) {
      return invalid("invalid_news_blackout_window", "news_blackout", "Window must be an object", { index });
    }

    if (!isNonNegativeInteger(window.startsAt) || !isNonNegativeInteger(window.endsAt)) {
      return invalid("invalid_news_blackout_window_time", "news_blackout", "Window times must be epoch-ms integers", {
        index
      });
    }

    if (window.endsAt <= window.startsAt) {
      return invalid("invalid_news_blackout_window_range", "news_blackout", "Window end must be after start", {
        index
      });
    }

    if ("reason" in window && typeof window.reason !== "string") {
      return invalid("invalid_news_blackout_window_reason", "news_blackout", "Window reason must be a string", {
        index
      });
    }

    if ("pairs" in window && !isStringArray(window.pairs)) {
      return invalid("invalid_news_blackout_window_pairs", "news_blackout", "Window pairs must be strings", {
        index
      });
    }

    const validatedWindow: NewsBlackoutWindow = {
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      ...(typeof window.reason === "string" ? { reason: window.reason } : {}),
      ...(isStringArray(window.pairs) ? { pairs: window.pairs } : {})
    };
    windows.push(validatedWindow);
  }

  return { ok: true, value: windows };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 1;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isPositiveDecimalString(value: unknown): value is string {
  return typeof value === "string" && decimalPattern.test(value) && decimalToNumber(value) > 0;
}

function isNonNegativeDecimalString(value: unknown): value is string {
  return typeof value === "string" && decimalPattern.test(value) && decimalToNumber(value) >= 0;
}

function validateDecimalField(fieldName: string, value: unknown): Result<string> {
  if (!isPositiveDecimalString(value)) {
    return invalid("invalid_positive_decimal_string", fieldName, "Expected decimal string > 0");
  }

  return { ok: true, value };
}

function validateNonNegativeDecimalField(fieldName: string, value: unknown): Result<string> {
  if (!isNonNegativeDecimalString(value)) {
    return invalid("invalid_non_negative_decimal_string", fieldName, "Expected decimal string >= 0");
  }

  return { ok: true, value };
}

function decimalToNumber(value: string): number {
  return Number(value);
}

function compareNonNegativeDecimalStrings(left: string, right: string): number {
  const [leftInteger = "", leftFraction = ""] = left.split(".");
  const [rightInteger = "", rightFraction = ""] = right.split(".");
  const normalizedLeftInteger = leftInteger.replace(/^0+(?=\d)/, "");
  const normalizedRightInteger = rightInteger.replace(/^0+(?=\d)/, "");

  if (normalizedLeftInteger.length !== normalizedRightInteger.length) {
    return normalizedLeftInteger.length > normalizedRightInteger.length ? 1 : -1;
  }

  if (normalizedLeftInteger !== normalizedRightInteger) {
    return normalizedLeftInteger > normalizedRightInteger ? 1 : -1;
  }

  const maxFractionLength = Math.max(leftFraction.length, rightFraction.length);
  const normalizedLeftFraction = leftFraction.padEnd(maxFractionLength, "0");
  const normalizedRightFraction = rightFraction.padEnd(maxFractionLength, "0");

  if (normalizedLeftFraction === normalizedRightFraction) {
    return 0;
  }

  return normalizedLeftFraction > normalizedRightFraction ? 1 : -1;
}

function invalid(
  code: string,
  field: string,
  message: string,
  extraContext: Readonly<Record<string, unknown>> = {}
): Result<never> {
  return {
    ok: false,
    error: {
      code,
      source: "config.validation",
      context: {
        field,
        message,
        ...extraContext
      }
    }
  };
}

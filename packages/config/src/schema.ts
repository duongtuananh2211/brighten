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
}

export interface ConfigParams {
  readonly cooldown_after_loss: number;
  readonly win_streak_threshold: number;
  readonly size_dampening: string;
  readonly daily_loss_limit: string;
  readonly max_trades_per_day: number;
  readonly min_rr: string;
  readonly risk_pct: string;
  readonly cost_hurdle_x: string;
  readonly news_blackout: readonly NewsBlackoutWindow[];
  readonly trading_day_boundary: string;
}

export const DEFAULT_PARAMS: ConfigParams = {
  cooldown_after_loss: 300_000,
  win_streak_threshold: 3,
  size_dampening: "0.5",
  daily_loss_limit: "100",
  max_trades_per_day: 5,
  min_rr: "1.5",
  risk_pct: "1",
  cost_hurdle_x: "1",
  news_blackout: [],
  trading_day_boundary: "UTC 00:00"
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
    "min_rr",
    "risk_pct",
    "cost_hurdle_x",
    "news_blackout",
    "trading_day_boundary"
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

  return {
    ok: true,
    value: {
      cooldown_after_loss: cooldownAfterLoss,
      win_streak_threshold: winStreakThreshold,
      size_dampening: sizeDampening.value,
      daily_loss_limit: dailyLossLimit.value,
      max_trades_per_day: maxTradesPerDay,
      min_rr: minRr.value,
      risk_pct: riskPct.value,
      cost_hurdle_x: costHurdleX.value,
      news_blackout: newsBlackoutResult.value,
      trading_day_boundary: tradingDayBoundary
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

    windows.push(
      typeof window.reason === "string"
        ? { startsAt: window.startsAt, endsAt: window.endsAt, reason: window.reason }
        : { startsAt: window.startsAt, endsAt: window.endsAt }
    );
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

function isPositiveDecimalString(value: unknown): value is string {
  return typeof value === "string" && decimalPattern.test(value) && decimalToNumber(value) > 0;
}

function validateDecimalField(fieldName: string, value: unknown): Result<string> {
  if (!isPositiveDecimalString(value)) {
    return invalid("invalid_positive_decimal_string", fieldName, "Expected decimal string > 0");
  }

  return { ok: true, value };
}

function decimalToNumber(value: string): number {
  return Number(value);
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

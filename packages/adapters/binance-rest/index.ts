import type {
  IngestionPort,
  Kline,
  MarketSnapshot,
  MarketSnapshotRequest,
  Result,
  SnapshotWarning
} from "@brighten/decision-core";
import {
  normalizeFunding,
  normalizeKlines,
  normalizeLongShort,
  normalizeOpenInterest
} from "./normalize.js";

const source = "adapter.binance_rest";
const defaultBaseUrl = "https://fapi.binance.com";
const klineLimit = 1500;
const optionalFeedLimit = 500;

export type FetchResponseLike = {
  readonly ok: boolean;
  readonly status: number;
  readonly json: () => Promise<unknown>;
};

export type FetchLike = (url: string) => Promise<FetchResponseLike>;

export interface BinanceRestDeps {
  readonly fetchFn?: FetchLike;
  readonly fapiBaseUrl?: string;
  readonly futuresDataBaseUrl?: string;
  readonly logger?: (warning: SnapshotWarning) => void;
}

export function createBinanceRestIngestion(deps: BinanceRestDeps = {}): IngestionPort {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const fapiBaseUrl = deps.fapiBaseUrl ?? defaultBaseUrl;
  const futuresDataBaseUrl = deps.futuresDataBaseUrl ?? fapiBaseUrl;
  const logger = deps.logger ?? (() => undefined);

  return {
    async getMarketSnapshot(request) {
      const interval = mapTimeframeToInterval(request.timeframe);
      if (interval === undefined) {
        return failure("invalid_timeframe", "Unsupported Binance kline interval", { timeframe: request.timeframe });
      }

      const klinesResult = await fetchKlines(request, interval, fetchFn, fapiBaseUrl);
      if (!klinesResult.ok) {
        return klinesResult;
      }
      if (klinesResult.value.length === 0) {
        return failure("empty_required_feed", "Klines feed returned no records", { pair: request.pair });
      }

      const warnings: SnapshotWarning[] = [];
      const optionalFeeds = await Promise.all([
        fetchOptionalFeed("funding", request, fetchFn, `${fapiBaseUrl}/fapi/v1/fundingRate`, normalizeFunding),
        fetchPeriodOptionalFeed("openInterest", request, fetchFn, `${futuresDataBaseUrl}/futures/data/openInterestHist`, normalizeOpenInterest),
        fetchPeriodOptionalFeed(
          "longShortRatio",
          request,
          fetchFn,
          `${futuresDataBaseUrl}/futures/data/globalLongShortAccountRatio`,
          normalizeLongShort
        )
      ]);

      const [fundingResult, openInterestResult, longShortRatioResult] = optionalFeeds;
      for (const result of optionalFeeds) {
        if (!result.ok) {
          warnings.push(result.warning);
          logger(result.warning);
        }
      }

      const snapshot: MarketSnapshot = {
        pair: request.pair,
        timeframe: request.timeframe,
        atEpochMillis: request.toEpochMillis,
        klines: klinesResult.value,
        ...(fundingResult.ok ? { funding: fundingResult.value } : {}),
        ...(openInterestResult.ok ? { openInterest: openInterestResult.value } : {}),
        ...(longShortRatioResult.ok ? { longShortRatio: longShortRatioResult.value } : {}),
        warnings
      };

      return { ok: true, value: snapshot };
    }
  };
}

export function mapTimeframeToInterval(timeframe: string): string | undefined {
  return new Set(["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d"]).has(timeframe)
    ? timeframe
    : undefined;
}

export function mapTimeframeToPeriod(timeframe: string): string | undefined {
  return new Set(["5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d"]).has(timeframe)
    ? timeframe
    : undefined;
}

async function fetchKlines(
  request: MarketSnapshotRequest,
  interval: string,
  fetchFn: FetchLike,
  baseUrl: string
): Promise<Result<Kline[]>> {
  const klines: Kline[] = [];
  let startTime = request.fromEpochMillis;

  while (startTime < request.toEpochMillis) {
    const url = buildUrl(`${baseUrl}/fapi/v1/klines`, {
      symbol: request.pair,
      interval,
      startTime,
      endTime: request.toEpochMillis,
      limit: klineLimit
    });
    const payload = await fetchJson(fetchFn, url);
    if (!payload.ok) {
      return payload;
    }

    const normalized = normalizeKlines(payload.value);
    if (!normalized.ok) {
      return normalized;
    }
    klines.push(...normalized.value);

    if (normalized.value.length < klineLimit) {
      break;
    }

    const last = normalized.value[normalized.value.length - 1];
    if (last === undefined) {
      break;
    }
    startTime = last.closeTime + 1;
  }

  return { ok: true, value: klines };
}

type OptionalResult<T> =
  | { readonly ok: true; readonly value: T[] }
  | { readonly ok: false; readonly warning: SnapshotWarning };

async function fetchPeriodOptionalFeed<T>(
  feed: string,
  request: MarketSnapshotRequest,
  fetchFn: FetchLike,
  endpoint: string,
  normalize: (raw: unknown) => Result<T[]>
): Promise<OptionalResult<T>> {
  const period = mapTimeframeToPeriod(request.timeframe);
  if (period === undefined) {
    return warning("invalid_timeframe", "Unsupported Binance futures data period", { feed, timeframe: request.timeframe });
  }

  return fetchOptionalFeed(feed, request, fetchFn, endpoint, normalize, { period });
}

async function fetchOptionalFeed<T>(
  feed: string,
  request: MarketSnapshotRequest,
  fetchFn: FetchLike,
  endpoint: string,
  normalize: (raw: unknown) => Result<T[]>,
  extraParams: Readonly<Record<string, string>> = {}
): Promise<OptionalResult<T>> {
  const url = buildUrl(endpoint, {
    symbol: request.pair,
    startTime: request.fromEpochMillis,
    endTime: request.toEpochMillis,
    limit: optionalFeedLimit,
    ...extraParams
  });
  const payload = await fetchJson(fetchFn, url);
  if (!payload.ok) {
    return warning(payload.error.code, String(payload.error.context?.message ?? "Optional feed fetch failed"), {
      feed,
      ...payload.error.context
    });
  }

  const normalized = normalize(payload.value);
  if (!normalized.ok) {
    return warning(normalized.error.code, String(normalized.error.context?.message ?? "Optional feed payload invalid"), {
      feed,
      ...normalized.error.context
    });
  }
  if (normalized.value.length === 0) {
    return warning(feed === "funding" ? "empty_optional_feed" : "unavailable_out_of_retention", "Optional feed returned no records", {
      feed
    });
  }

  return { ok: true, value: normalized.value };
}

async function fetchJson(fetchFn: FetchLike, url: string): Promise<Result<unknown>> {
  let response: FetchResponseLike;
  try {
    response = await fetchFn(url);
  } catch (error) {
    return failure("network_error", "Fetch failed", { url, detail: error instanceof Error ? error.message : String(error) });
  }

  if (!response.ok) {
    return failure("http_error", "Binance endpoint returned non-2xx status", { url, status: response.status });
  }

  try {
    return { ok: true, value: await response.json() };
  } catch (error) {
    return failure("invalid_payload", "Failed to parse JSON payload", {
      url,
      detail: error instanceof Error ? error.message : String(error)
    });
  }
}

function buildUrl(endpoint: string, params: Readonly<Record<string, string | number>>): string {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function failure(code: string, message: string, context: Readonly<Record<string, unknown>>): Result<never> {
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

function warning(code: string, message: string, context: Readonly<Record<string, unknown>>): OptionalResult<never> {
  return {
    ok: false,
    warning: {
      code,
      source,
      context: {
        ...context,
        message
      }
    }
  };
}

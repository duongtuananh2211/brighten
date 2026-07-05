import { DEFAULT_PARAMS, createConfigVersion, snapshot } from "@brighten/config";
import type { ConfigParams, ConfigSnapshot } from "@brighten/config";
import type {
  FundingPoint,
  IngestionPort,
  Kline,
  LongShortRatioPoint,
  MarketSnapshot,
  OpenInterestPoint,
  Result
} from "@brighten/decision-core";

// Shared, deterministic fixtures for the backtest engine tests. Not a test suite
// itself (excluded from the build); imported by the *.test.ts files.

const step = 60_000;

export interface KlineOverrides {
  readonly openTime?: number;
  readonly open?: string;
  readonly high?: string;
  readonly low?: string;
  readonly close?: string;
}

// index-based kline: openTime = 1_000 + index*60_000; OHLC overridable.
export function makeKline(index: number, overrides: KlineOverrides = {}): Kline {
  const openTime = overrides.openTime ?? 1_000 + index * step;
  return {
    openTime,
    open: overrides.open ?? "100",
    high: overrides.high ?? "100",
    low: overrides.low ?? "100",
    close: overrides.close ?? "100",
    volume: "1",
    closeTime: openTime + step - 1,
    quoteVolume: "100",
    numberOfTrades: 1,
    takerBuyBaseVolume: "0.5",
    takerBuyQuoteVolume: "50"
  };
}

export interface SnapshotOverrides {
  readonly pair?: string;
  readonly timeframe?: string;
  readonly klines: readonly Kline[];
  readonly funding?: readonly FundingPoint[];
  readonly openInterest?: readonly OpenInterestPoint[];
  readonly longShortRatio?: readonly LongShortRatioPoint[];
}

export function makeSnapshot(overrides: SnapshotOverrides): MarketSnapshot {
  const lastKline = overrides.klines[overrides.klines.length - 1];
  return {
    pair: overrides.pair ?? "BTCUSDT",
    timeframe: overrides.timeframe ?? "1m",
    atEpochMillis: lastKline?.closeTime ?? 0,
    klines: overrides.klines,
    ...(overrides.funding ? { funding: overrides.funding } : {}),
    ...(overrides.openInterest ? { openInterest: overrides.openInterest } : {}),
    ...(overrides.longShortRatio ? { longShortRatio: overrides.longShortRatio } : {}),
    warnings: []
  };
}

export function makeFxPipelineSnapshot(): MarketSnapshot {
  return makeSnapshot({
    pair: "EURUSD",
    klines: [
      makeKline(0, { high: "1.1050", low: "1.1010", close: "1.1030" }),
      makeKline(1, { high: "1.1080", low: "1.1000", close: "1.1040" }),
      makeKline(2, { high: "1.1060", low: "1.1020", close: "1.1050" }),
      makeKline(3, { high: "1.1090", low: "1.1030", close: "1.1075" }),
      makeKline(4, { high: "1.1080", low: "1.0990", close: "1.1000" })
    ]
  });
}

export function makeRealPipelineConfig(overrides: Partial<ConfigParams> = {}, previousVersion = 0): ConfigSnapshot {
  return makeConfigSnapshot({
    fx_swing_lookback: 3,
    fx_sweep_min_penetration: "0.125",
    fx_min_data_points: 4,
    tier2_swing_lookback: 3,
    tier2_stop_buffer: "0.1",
    tier2_min_data_points: 4,
    ...overrides
  }, previousVersion);
}

export function makeConfigSnapshot(overrides: Partial<ConfigParams> = {}, previousVersion = 0): ConfigSnapshot {
  return snapshot(createConfigVersion({ ...DEFAULT_PARAMS, ...overrides }, previousVersion, 0));
}

// Fake ingestion returning a fixed snapshot — never touches the network.
export function fakeIngestion(snapshotValue: MarketSnapshot): IngestionPort {
  return {
    getMarketSnapshot(): Promise<Result<MarketSnapshot>> {
      return Promise.resolve({ ok: true, value: snapshotValue });
    }
  };
}

export function failingIngestion(): IngestionPort {
  return {
    getMarketSnapshot(): Promise<Result<MarketSnapshot>> {
      return Promise.resolve({
        ok: false,
        error: { code: "empty_required_feed", source: "adapter.binance_rest", context: {} }
      });
    }
  };
}

import type { MarketSnapshot, Result } from "../types/index.js";

export interface MarketSnapshotRequest {
  readonly pair: string;
  readonly timeframe: string;
  readonly fromEpochMillis: number;
  readonly toEpochMillis: number;
}

export interface IngestionPort {
  readonly getMarketSnapshot: (request: MarketSnapshotRequest) => Promise<Result<MarketSnapshot>>;
}

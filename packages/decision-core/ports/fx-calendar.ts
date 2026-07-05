import type { NewsBlackoutWindow } from "@brighten/config";
import type { SnapshotWarning } from "../types/index.js";

export interface FxCalendarRequest {
  readonly fromEpochMillis: number;
  readonly toEpochMillis: number;
  readonly pairs: readonly string[];
  readonly blackoutBufferBeforeMs: number;
  readonly blackoutBufferAfterMs: number;
}

export interface FxCalendarResult {
  readonly windows: readonly NewsBlackoutWindow[];
  readonly warnings: readonly SnapshotWarning[];
}

export interface FxCalendarPort {
  readonly getNewsBlackout: (request: FxCalendarRequest) => Promise<FxCalendarResult>;
}

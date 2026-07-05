import type { ConfigSnapshot } from "@brighten/config";
import type { AuditEvent, BehavioralState, Result, Suggestion } from "../types/index.js";
import type { LiveDriftStatus } from "../tiers/tier0/live-drift.js";
import type { OverrideGrant } from "../tiers/tier0/override.js";
import type { ClosedTrade } from "./account.js";

export interface PersistencePort {
  readonly readBehavioralState: () => Promise<Result<BehavioralState>>;
  readonly readConfigSnapshot: (version?: number) => Promise<Result<ConfigSnapshot>>;
  readonly appendAuditEvent: (event: AuditEvent) => Promise<Result<void>>;
  readonly saveSuggestion: (suggestion: Suggestion) => Promise<Result<void>>;
  /** Sole write-path for behavioral state (AD-6). Only state-owner drivers call this. */
  readonly writeBehavioralState: (state: BehavioralState) => Promise<Result<void>>;
  // ── Feedback dedup + attribution (3.4) ────────────────────────────────────
  /** Check whether a fill has already been processed (idempotent probe). */
  readonly hasProcessedFill: (fillId: string) => Promise<Result<boolean>>;
  /** Record a processed fill so it won't be double-counted. */
  readonly recordProcessedFill: (trade: ClosedTrade) => Promise<Result<void>>;
  /** Record a user attribution linking a fill to a suggestion. Append-only. */
  readonly recordAttribution: (input: { readonly fillId: string; readonly suggestionId: string; readonly result: "win" | "loss" }) => Promise<Result<void>>;
  // ── Live drift (3.5) ────────────────────────────────────────────────────
  readonly readDriftBaseline: () => Promise<Result<DriftBaseline | null>>;
  readonly setDriftBaseline: (baseline: DriftBaseline) => Promise<Result<void>>;
  readonly readLiveRSeries: (window: number) => Promise<Result<readonly string[]>>;
  readonly writeDriftMetric: (status: LiveDriftStatus & { readonly atEpochMillis: number }) => Promise<Result<void>>;
  // ── Override friction (3.6) ──────────────────────────────────────────────
  readonly recordOverrideGrant: (input: { readonly grant: OverrideGrant; readonly typedConfirmation: string }) => Promise<Result<void>>;
  readonly readActiveOverrideGrants: (nowEpochMillis: number) => Promise<Result<readonly OverrideGrant[]>>;
}

export interface DriftBaseline {
  readonly lower: string;
  readonly median: string;
  readonly upper: string;
  readonly configVersion?: number | undefined;
}

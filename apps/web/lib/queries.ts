import type { SupabaseClient } from "@supabase/supabase-js";
import type { BehavioralState, Suggestion } from "@brighten/decision-core";

// SAFETY (AD-10): Every function in this file ONLY calls .select().
// No insert/update/delete/rpc-write. Enforced by RLS + guard test.

type Json = Record<string, unknown>;

function parseJsonb(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return null; }
  }
  return null;
}

export async function getLatestSuggestion(client: SupabaseClient): Promise<Suggestion | null> {
  const { data } = await client
    .from("suggestions")
    .select("payload, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data === null) return null;
  const payload = parseJsonb(data.payload);
  if (payload === null) return null;
  return payload as unknown as Suggestion;
}

export async function getBehavioralState(client: SupabaseClient): Promise<BehavioralState | null> {
  const { data } = await client
    .from("behavioral_state")
    .select("win_streak, daily_loss, last_loss_epoch_millis, trade_count_today, trading_day_start_epoch_millis")
    .eq("id", 1)
    .maybeSingle();

  if (data === null) return null;
  return {
    winStreak: data.win_streak as number,
    dailyLoss: data.daily_loss as string,
    ...(data.last_loss_epoch_millis != null ? { lastLossEpochMillis: data.last_loss_epoch_millis as number } : {}),
    tradeCountToday: data.trade_count_today as number,
    ...(data.trading_day_start_epoch_millis != null ? { tradingDayStartEpochMillis: data.trading_day_start_epoch_millis as number } : {}),
  };
}

export async function getLatestDriftMetric(client: SupabaseClient): Promise<{ liveExpectancy: string; drifting: boolean; sampleCount: number; baselineLower: string; atEpochMillis: number } | null> {
  const { data } = await client
    .from("drift_metrics")
    .select("live_expectancy, drifting, sample_count, baseline_lower, at_epoch_millis")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data === null) return null;
  return {
    liveExpectancy: data.live_expectancy as string,
    drifting: data.drifting as boolean,
    sampleCount: data.sample_count as number,
    baselineLower: data.baseline_lower as string,
    atEpochMillis: data.at_epoch_millis as number,
  };
}

export async function getRecentAuditEvents(client: SupabaseClient, limit = 20): Promise<readonly Json[]> {
  const { data } = await client
    .from("audit_events")
    .select("type, at_epoch_millis, payload, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (data === null) return [];
  return data as readonly Json[];
}

// ─── Freshness / heartbeat helpers (pure, testable) ──────────────────────────

/** Default max age for a suggestion to be considered "fresh" (ms). */
export const DEFAULT_SUGGESTION_MAX_AGE_MS = 5 * 60_000; // 5 minutes

/** Default max age for heartbeat before declaring "stale / disconnected". */
export const DEFAULT_HEARTBEAT_STALE_MS = 5 * 60_000; // 5 minutes

/**
 * Whether a suggestion is still "fresh" (actionable now).
 * Pure: no IO, deterministic.
 */
export function isSuggestionFresh(
  suggestionAtEpochMillis: number,
  nowMs: number,
  maxAgeMs: number = DEFAULT_SUGGESTION_MAX_AGE_MS,
): boolean {
  return nowMs - suggestionAtEpochMillis <= maxAgeMs;
}

/**
 * Whether the system is considered alive based on the latest drift heartbeat.
 * Pure: no IO, deterministic.
 */
export function isSystemAlive(
  driftAtEpochMillis: number | null | undefined,
  nowMs: number,
  staleMs: number = DEFAULT_HEARTBEAT_STALE_MS,
): boolean {
  if (driftAtEpochMillis == null) return false;
  return nowMs - driftAtEpochMillis <= staleMs;
}

export type PageState =
  | { readonly kind: "suggestion"; readonly suggestion: Suggestion; readonly narration?: string }
  | { readonly kind: "silence"; readonly alive: boolean };

// ─── Drift / Halt helpers (pure, display-classification only — AD-10) ─────────

export type DriftBand = "in_band" | "below_lower" | "no_baseline";

export interface DriftStatusInput {
  readonly liveExpectancy: string;
  readonly baselineLower?: string | null;
}

/**
 * Classify drift display band from stored engine values.
 * Does NOT recompute expectancy — only compares stored numbers (AD-10).
 * Pure, testable.
 */
export function driftStatus(input: DriftStatusInput): DriftBand {
  if (input.baselineLower === null || input.baselineLower === undefined) return "no_baseline";
  // Simple string comparison for display classification only
  // Engine drift uses cmp() from math/decimal; here we trust the stored flag.
  return Number(input.liveExpectancy) < Number(input.baselineLower)
    ? "below_lower"
    : "in_band";
}

export interface HaltState {
  readonly halted: boolean;
  readonly reason: string;
  readonly kind: "drift" | "cooldown" | "daily_loss" | "max_trades" | "news" | "unknown";
}

export interface HaltStateInput {
  readonly drifting?: boolean;
  readonly latestTier0BlockReason?: string | null;
}

/**
 * Determine whether the engine is in a halted state from stored signals.
 * Reads engine-computed flags only — does NOT re-evaluate tier0 rules (AD-10).
 * Pure, testable.
 */
export function haltState(input: HaltStateInput): HaltState | { halted: false; reason: string; kind: "unknown" } {
  if (input.drifting === true) {
    return { halted: true, reason: "Live drift breach — the edge may be broken", kind: "drift" };
  }

  const reason = input.latestTier0BlockReason;
  if (reason !== null && reason !== undefined && reason.length > 0) {
    const kind: HaltState["kind"] = reason.startsWith("cooldown_active") ? "cooldown"
      : reason.startsWith("daily_loss_limit") ? "daily_loss"
      : reason.startsWith("max_trades") ? "max_trades"
      : reason.startsWith("news_blackout") ? "news"
      : "unknown";
    return { halted: true, reason, kind };
  }

  return { halted: false, reason: "", kind: "unknown" };
}

// ─── Additional queries (SELECT-only) ──────────────────────────────────────

export async function getDriftBaseline(client: SupabaseClient): Promise<{ lower: string; median: string; upper: string } | null> {
  const { data } = await client.from("drift_baseline").select("lower, median, upper").eq("id", 1).maybeSingle();
  if (data === null) return null;
  return { lower: data.lower as string, median: data.median as string, upper: data.upper as string };
}

export async function getDriftHistory(client: SupabaseClient, limit = 48): Promise<readonly Json[]> {
  const { data } = await client.from("drift_metrics").select("*").order("created_at", { ascending: false }).limit(limit);
  if (data === null) return [];
  return data as readonly Json[];
}

export async function getAuditEventsPage(
  client: SupabaseClient,
  opts: { limit?: number; type?: string; cursor?: string } = {},
): Promise<readonly Json[]> {
  let query = client.from("audit_events").select("*").order("created_at", { ascending: false }).limit(opts.limit ?? 30);
  if (opts.type !== undefined) query = query.eq("type", opts.type);
  if (opts.cursor !== undefined) {
    // Simple cursor: id < cursor (older)
    query = query.lt("id", opts.cursor);
  }
  const { data } = await query;
  if (data === null) return [];
  return data as readonly Json[];
}

export async function getOverrideHistory(client: SupabaseClient, limit = 50): Promise<readonly Json[]> {
  const { data } = await client.from("override_grants").select("*").order("created_at", { ascending: false }).limit(limit);
  if (data === null) return [];
  return data as readonly Json[];
}



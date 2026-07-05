import type { TierId } from "../pipeline/runner.js";
import type { OverrideGrant } from "../tiers/tier0/override.js";
import type { AuditEvent, Suggestion } from "../types/index.js";

/**
 * Build an audit event for a trade suggestion that passed all tiers.
 *
 * Pure: no Date, no IO, no random. Input `atEpochMillis` is from tick time.
 */
export function buildSuggestionEmittedEvent(input: {
  readonly suggestion: Suggestion;
  readonly atEpochMillis: number;
}): AuditEvent {
  return {
    type: "suggestion-emitted",
    atEpochMillis: input.atEpochMillis,
    payload: {
      pair: input.suggestion.pair,
      timeframe: input.suggestion.timeframe,
      direction: input.suggestion.direction,
      candidate: input.suggestion.candidate,
      sizing: input.suggestion.sizing,
      configVersion: input.suggestion.configVersion,
      snapshotSchemaVersion: input.suggestion.snapshotSchemaVersion,
    },
  };
}

/**
 * Build an audit event for a suggestion that was blocked by a tier.
 *
 * The `reason` field already encodes the triggering signals
 * (e.g. "cooldown_active: cooldown until …", "conflicting_signals: …").
 *
 * Pure: no Date, no IO, no random.
 */
export function buildSuggestionBlockedEvent(input: {
  readonly pair: string;
  readonly timeframe: string;
  readonly atEpochMillis: number;
  readonly vetoedBy: TierId;
  readonly reason: string;
  readonly configVersion: number;
  readonly snapshotSchemaVersion: number;
}): AuditEvent {
  return {
    type: "suggestion-blocked",
    atEpochMillis: input.atEpochMillis,
    payload: {
      pair: input.pair,
      timeframe: input.timeframe,
      vetoedBy: input.vetoedBy,
      reason: input.reason,
      configVersion: input.configVersion,
      snapshotSchemaVersion: input.snapshotSchemaVersion,
    },
  };
}

/**
 * Build an audit event for a trade outcome (risk from probe or attributed from user).
 *
 * Pure: no Date, no IO, no random.
 */
export function buildTradeOutcomeEvent(input: {
  readonly fillId: string;
  readonly realizedPnl?: string | undefined;
  readonly result?: "win" | "loss" | undefined;
  readonly suggestionId?: string | undefined;
  readonly atEpochMillis: number;
}): AuditEvent {
  return {
    type: "trade-outcome",
    atEpochMillis: input.atEpochMillis,
    payload: {
      fillId: input.fillId,
      ...(input.realizedPnl !== undefined ? { realizedPnl: input.realizedPnl } : {}),
      ...(input.result !== undefined ? { result: input.result } : {}),
      ...(input.suggestionId !== undefined ? { suggestionId: input.suggestionId } : {}),
    },
  };
}

/**
 * Build an audit event for an override grant (FR-12 friction).
 *
 * Records: rule overridden, reason, typed confirmation proof, timestamps.
 * Pure: no Date, no IO, no random.
 */
export function buildOverrideRecordedEvent(input: {
  readonly grant: OverrideGrant;
  readonly typedConfirmation: string;
  readonly atEpochMillis: number;
}): AuditEvent {
  return {
    type: "override-recorded",
    atEpochMillis: input.atEpochMillis,
    payload: {
      ruleCode: input.grant.ruleCode,
      reason: input.grant.reason,
      typedConfirmation: input.typedConfirmation,
      requestedAtEpochMillis: input.grant.requestedAtEpochMillis,
      activeFromEpochMillis: input.grant.activeFromEpochMillis,
      expiresAtEpochMillis: input.grant.expiresAtEpochMillis,
    },
  };
}

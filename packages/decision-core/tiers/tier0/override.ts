import type { Result } from "../../types/index.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OverrideGrant {
  readonly ruleCode: string;
  readonly reason: string;
  readonly requestedAtEpochMillis: number;
  readonly activeFromEpochMillis: number;
  readonly expiresAtEpochMillis: number;
}

export interface BuildOverrideGrantInput {
  readonly ruleCode: string;
  readonly reason: string;
  readonly typedConfirmation: string;
  readonly requestedAtEpochMillis: number;
  readonly cooldownMs: number;
  readonly ttlMs: number;
}

// ─── Build grant (friction gates) ────────────────────────────────────────────

/**
 * Apply override friction: typed confirmation must match the rule code,
 * and reason must be non-empty.
 *
 * The grant has a cooldown before it becomes active (anti-impulse) and
 * a TTL window during which the override is honoured.
 *
 * Pure: no Date, no IO, no random.
 */
export function buildOverrideGrant(
  input: BuildOverrideGrantInput,
): Result<OverrideGrant> {
  // Friction 1: reason must be non-empty (logged as evidence)
  if (input.reason.trim().length === 0) {
    return {
      ok: false,
      error: {
        code: "override_reason_required",
        source: "tier0.override",
        context: { ruleCode: input.ruleCode },
      },
    };
  }

  // Friction 2: typed confirmation must match the rule being overridden
  if (input.typedConfirmation !== input.ruleCode) {
    return {
      ok: false,
      error: {
        code: "override_confirmation_mismatch",
        source: "tier0.override",
        context: {
          ruleCode: input.ruleCode,
          expected: input.ruleCode,
        },
      },
    };
  }

  const activeFromEpochMillis =
    input.requestedAtEpochMillis + input.cooldownMs;

  return {
    ok: true,
    value: {
      ruleCode: input.ruleCode,
      reason: input.reason,
      requestedAtEpochMillis: input.requestedAtEpochMillis,
      activeFromEpochMillis,
      expiresAtEpochMillis: activeFromEpochMillis + input.ttlMs,
    },
  };
}

// ─── Active check (per-rule) ─────────────────────────────────────────────────

/**
 * Check whether a grant is currently active for a given rule.
 *
 * A grant is active only when `activeFrom <= now < expiresAt` AND
 * its ruleCode matches.
 *
 * Pure: no Date, no IO.
 */
export function isOverrideActive(
  grants: readonly OverrideGrant[] | undefined,
  ruleCode: string,
  nowEpochMillis: number,
): boolean {
  if (grants === undefined || grants.length === 0) return false;

  return grants.some(
    (g) =>
      g.ruleCode === ruleCode &&
      g.activeFromEpochMillis <= nowEpochMillis &&
      nowEpochMillis < g.expiresAtEpochMillis,
  );
}

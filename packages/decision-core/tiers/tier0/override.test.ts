import { describe, expect, it } from "vitest";
import { buildOverrideGrant, isOverrideActive } from "./override.js";

const NOW = 1_700_000_000_000;

describe("buildOverrideGrant", () => {
  it("builds valid grant when typedConfirmation matches ruleCode", () => {
    const result = buildOverrideGrant({
      ruleCode: "cooldown_active",
      reason: "FOMC breakout opportunity",
      typedConfirmation: "cooldown_active",
      requestedAtEpochMillis: NOW,
      cooldownMs: 60_000,
      ttlMs: 300_000,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ruleCode).toBe("cooldown_active");
      expect(result.value.activeFromEpochMillis).toBe(NOW + 60_000);
      expect(result.value.expiresAtEpochMillis).toBe(NOW + 60_000 + 300_000);
      expect(result.value.reason).toBe("FOMC breakout opportunity");
    }
  });

  it("rejects when typedConfirmation does not match ruleCode", () => {
    const result = buildOverrideGrant({
      ruleCode: "cooldown_active",
      reason: "FOMC",
      typedConfirmation: "wrong_code",
      requestedAtEpochMillis: NOW,
      cooldownMs: 60_000,
      ttlMs: 300_000,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("override_confirmation_mismatch");
    }
  });

  it("rejects when reason is empty", () => {
    const result = buildOverrideGrant({
      ruleCode: "cooldown_active",
      reason: "   ",
      typedConfirmation: "cooldown_active",
      requestedAtEpochMillis: NOW,
      cooldownMs: 60_000,
      ttlMs: 300_000,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("override_reason_required");
    }
  });

  it("is deterministic: same inputs ⇒ same outputs", () => {
    const input = { ruleCode: "max_trades_reached", reason: "good setup", typedConfirmation: "max_trades_reached", requestedAtEpochMillis: NOW, cooldownMs: 60_000, ttlMs: 300_000 };
    expect(buildOverrideGrant(input)).toEqual(buildOverrideGrant(input));
  });
});

describe("isOverrideActive", () => {
  const activeGrant = {
    ruleCode: "cooldown_active",
    reason: "test",
    requestedAtEpochMillis: NOW - 120_000,
    activeFromEpochMillis: NOW - 60_000,
    expiresAtEpochMillis: NOW + 240_000,
  };

  it("returns true when grant is active (activeFrom <= now < expiresAt) and ruleCode matches", () => {
    expect(isOverrideActive([activeGrant], "cooldown_active", NOW)).toBe(true);
  });

  it("returns false when now < activeFrom (still in cooldown, not yet active)", () => {
    expect(isOverrideActive([activeGrant], "cooldown_active", NOW - 120_000)).toBe(false);
  });

  it("returns false when now >= expiresAt (expired)", () => {
    expect(isOverrideActive([activeGrant], "cooldown_active", NOW + 300_000)).toBe(false);
  });

  it("returns false when ruleCode does not match", () => {
    expect(isOverrideActive([activeGrant], "daily_loss_limit_reached", NOW)).toBe(false);
  });

  it("returns false when grants is undefined", () => {
    expect(isOverrideActive(undefined, "cooldown_active", NOW)).toBe(false);
  });

  it("returns false when grants is empty", () => {
    expect(isOverrideActive([], "cooldown_active", NOW)).toBe(false);
  });
});

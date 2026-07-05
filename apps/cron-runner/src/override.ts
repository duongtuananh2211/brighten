import {
  buildOverrideGrant,
  buildOverrideRecordedEvent,
} from "@brighten/decision-core";
import type {
  ClockPort,
  OverrideGrant,
  PersistencePort,
  Result,
} from "@brighten/decision-core";

export interface OverrideRequestInput {
  readonly ruleCode: string;
  readonly reason: string;
  readonly typedConfirmation: string;
}

export interface OverrideDeps {
  readonly persistence: PersistencePort;
  readonly clock: ClockPort;
  readonly logger?: (message: string, context?: Readonly<Record<string, unknown>>) => void;
}

export async function requestOverride(
  deps: OverrideDeps,
  input: OverrideRequestInput,
): Promise<Result<OverrideGrant>> {
  const logger = deps.logger ?? (() => undefined);

  try {
    const configResult = await deps.persistence.readConfigSnapshot();
    if (!configResult.ok) {
      return configResult;
    }

    const now = deps.clock.nowEpochMillis();
    const grantResult = buildOverrideGrant({
      ruleCode: input.ruleCode,
      reason: input.reason,
      typedConfirmation: input.typedConfirmation,
      requestedAtEpochMillis: now,
      cooldownMs: configResult.value.params.override_cooldown_ms,
      ttlMs: configResult.value.params.override_ttl_ms,
    });

    if (!grantResult.ok) {
      return grantResult;
    }

    const grant = grantResult.value;

    // Persist the grant (append-only)
    const recordResult = await deps.persistence.recordOverrideGrant({
      grant,
      typedConfirmation: input.typedConfirmation,
    });
    if (!recordResult.ok) {
      return recordResult;
    }

    // Audit (immutable evidence)
    const auditEvent = buildOverrideRecordedEvent({
      grant,
      typedConfirmation: input.typedConfirmation,
      atEpochMillis: now,
    });
    const auditResult = await deps.persistence.appendAuditEvent(auditEvent);
    if (!auditResult.ok) {
      logger("override_audit_failed", { error: auditResult.error });
    }

    return { ok: true, value: grant };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "override_error",
        source: "cron-runner.override",
        context: { detail: error instanceof Error ? error.message : String(error) },
      },
    };
  }
}

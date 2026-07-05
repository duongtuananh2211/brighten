import {
  applyRiskOutcome,
  applyAttributedOutcome,
  buildTradeOutcomeEvent,
} from "@brighten/decision-core";
import type {
  AccountPort,
  ClockPort,
  PersistencePort,
  Result,
} from "@brighten/decision-core";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FeedbackDeps {
  readonly account: AccountPort;
  readonly persistence: PersistencePort;
  readonly clock: ClockPort;
  readonly sinceLookbackMs: number;
  readonly logger?: (message: string, context?: Readonly<Record<string, unknown>>) => void;
}

export type FeedbackResult =
  | { readonly status: "processed"; readonly fillCount: number }
  | { readonly status: "skipped"; readonly reason: string };

export interface ConfirmFillDeps {
  readonly persistence: PersistencePort;
  readonly clock: ClockPort;
  readonly logger?: (message: string, context?: Readonly<Record<string, unknown>>) => void;
}

export interface ConfirmFillInput {
  readonly fillId: string;
  readonly suggestionId: string;
  readonly result: "win" | "loss";
}

// ─── runFeedback — probe → daily-loss → persist → audit (idempotent) ────────

export async function runFeedback(deps: FeedbackDeps): Promise<FeedbackResult> {
  const logger = deps.logger ?? (() => undefined);

  try {
    const nowEpochMillis = deps.clock.nowEpochMillis();
    const since = nowEpochMillis - deps.sinceLookbackMs;

    const tradesResult = await deps.account.readClosedTrades(since);
    if (!tradesResult.ok) {
      logger("feedback_trades_read_failed", { error: tradesResult.error });
      return { status: "skipped", reason: "trades_read_failed" };
    }

    const trades = tradesResult.value;
    if (trades.length === 0) {
      return { status: "processed", fillCount: 0 };
    }

    let fillCount = 0;

    for (const trade of trades) {
      const alreadyProcessed = await deps.persistence.hasProcessedFill(trade.fillId);
      if (!alreadyProcessed.ok) {
        logger("feedback_has_processed_fill_failed", { error: alreadyProcessed.error, fillId: trade.fillId });
        continue;
      }
      if (alreadyProcessed.value) {
        continue; // idempotent: skip already-processed fills
      }

      // Apply risk outcome (daily-loss from realised PnL)
      const stateResult = await deps.persistence.readBehavioralState();
      if (!stateResult.ok) {
        logger("feedback_state_read_failed", { error: stateResult.error });
        continue;
      }

      const nextState = applyRiskOutcome(stateResult.value, {
        realizedPnl: trade.realizedPnl,
        atEpochMillis: trade.closedEpochMillis,
      });

      const writeResult = await deps.persistence.writeBehavioralState(nextState);
      if (!writeResult.ok) {
        logger("feedback_state_write_failed", { error: writeResult.error });
        // Continue — the next probe will retry on the same fill if not recorded.
        continue;
      }

      // Audit the trade outcome (risk source)
      const auditEvent = buildTradeOutcomeEvent({
        fillId: trade.fillId,
        realizedPnl: trade.realizedPnl,
        atEpochMillis: trade.closedEpochMillis,
      });
      const auditResult = await deps.persistence.appendAuditEvent(auditEvent);
      if (!auditResult.ok) {
        logger("feedback_audit_failed", { error: auditResult.error });
      }

      // Record as processed (dedup)
      const recordResult = await deps.persistence.recordProcessedFill(trade);
      if (!recordResult.ok) {
        logger("feedback_record_fill_failed", { error: recordResult.error });
      }

      fillCount += 1;
    }

    return { status: "processed", fillCount };
  } catch (error) {
    logger("feedback_exception", { detail: error instanceof Error ? error.message : String(error) });
    return { status: "skipped", reason: "feedback_exception" };
  }
}

// ─── confirmFill — user attribution → win-streak → persist → audit ──────────

export async function confirmFill(
  deps: ConfirmFillDeps,
  input: ConfirmFillInput,
): Promise<Result<void>> {
  const logger = deps.logger ?? (() => undefined);

  try {
    // Record attribution (idempotent via on-conflict-do-nothing)
    const attrResult = await deps.persistence.recordAttribution({
      fillId: input.fillId,
      suggestionId: input.suggestionId,
      result: input.result,
    });
    if (!attrResult.ok) {
      return attrResult;
    }

    // Apply attributed outcome (win-streak + trade count)
    const stateResult = await deps.persistence.readBehavioralState();
    if (!stateResult.ok) {
      return stateResult;
    }

    const nextState = applyAttributedOutcome(stateResult.value, {
      result: input.result,
      atEpochMillis: deps.clock.nowEpochMillis(),
    });

    const writeResult = await deps.persistence.writeBehavioralState(nextState);
    if (!writeResult.ok) {
      logger("confirm_state_write_failed", { error: writeResult.error });
      return writeResult;
    }

    // Audit
    const auditEvent = buildTradeOutcomeEvent({
      fillId: input.fillId,
      result: input.result,
      suggestionId: input.suggestionId,
      atEpochMillis: deps.clock.nowEpochMillis(),
    });
    const auditResult = await deps.persistence.appendAuditEvent(auditEvent);
    if (!auditResult.ok) {
      logger("confirm_audit_failed", { error: auditResult.error });
    }

    return { ok: true, value: undefined };
  } catch (error) {
    logger("confirm_exception", { detail: error instanceof Error ? error.message : String(error) });
    return {
      ok: false,
      error: {
        code: "confirm_error",
        source: "cron-runner.feedback",
        context: { detail: error instanceof Error ? error.message : String(error) },
      },
    };
  }
}

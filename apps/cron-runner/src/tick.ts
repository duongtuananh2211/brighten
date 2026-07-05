import {
  MARKET_SNAPSHOT_SCHEMA_VERSION,
  applyMarketTick,
  buildSuggestionBlockedEvent,
  buildSuggestionEmittedEvent,
  createTier0,
  createTier1,
  createTier2,
  createTier3,
  evaluateLiveDrift,
  runPipeline
} from "@brighten/decision-core";
import type {
  AccountPort,
  AccountState,
  ClockPort,
  IngestionPort,
  LiveDriftStatus,
  NarratorPort,
  OverrideGrant,
  PersistencePort,
  Suggestion,
  Tier1AssetClass,
  TierId
} from "@brighten/decision-core";

export interface TickConfig {
  readonly pair: string;
  readonly timeframe: string;
  readonly assetClass: Tier1AssetClass;
  readonly lookbackMs: number;
  /** Fallback equity seam (offline/backtest). Superseded by accountPort when available. */
  readonly account?: AccountState;
}

export interface TickDeps {
  readonly ingestion: IngestionPort;
  readonly persistence: PersistencePort;
  readonly clock: ClockPort;
  readonly tickConfig: TickConfig;
  /** Live account port (AD-7). If provided, readBalance() supersedes tickConfig.account. */
  readonly accountPort?: AccountPort;
  /** LLM narrator (AD-9). Runs AFTER pipeline, before save. Non-blocking on error. */
  readonly narrator?: NarratorPort;
  readonly logger?: (message: string, context?: Readonly<Record<string, unknown>>) => void;
}

export type TickResult =
  | { readonly status: "suggestion"; readonly suggestion: Suggestion }
  | { readonly status: "silent"; readonly vetoedBy?: TierId; readonly reason?: string }
  | { readonly status: "skipped"; readonly reason: string };

export async function runTick(deps: TickDeps): Promise<TickResult> {
  const logger = deps.logger ?? (() => undefined);

  try {
    const configResult = await deps.persistence.readConfigSnapshot();
    if (!configResult.ok) {
      return skipped("config_read_failed", logger, { error: configResult.error });
    }

    const stateResult = await deps.persistence.readBehavioralState();
    if (!stateResult.ok) {
      return skipped("state_read_failed", logger, { error: stateResult.error });
    }

    const toEpochMillis = deps.clock.nowEpochMillis();

    // --- market-tick: apply day-boundary reset (state-owner) ---
    const { state: tickedState, tradingDayStartEpochMillis } = applyMarketTick(
      stateResult.value,
      {
        nowEpochMillis: toEpochMillis,
        tradingDayBoundary: configResult.value.params.trading_day_boundary,
        tradingDayStartEpochMillis: stateResult.value.tradingDayStartEpochMillis,
      }
    );

    const writeResult = await deps.persistence.writeBehavioralState({
      ...tickedState,
      tradingDayStartEpochMillis,
    });
    if (!writeResult.ok) {
      logger("state_persist_failed", { error: writeResult.error });
      // Continue with tickedState — the next tick will self-heal via idempotent reset.
    }

    // --- override grants: read active grants for tier0 to respect ---
    let overrideGrants: readonly OverrideGrant[] | undefined;
    try {
      const grantsResult = await deps.persistence.readActiveOverrideGrants(toEpochMillis);
      if (grantsResult.ok) {
        overrideGrants = grantsResult.value;
      } else {
        logger("override_grants_read_failed", { error: grantsResult.error });
      }
    } catch (overrideError) {
      logger("override_grants_exception", { detail: overrideError instanceof Error ? overrideError.message : String(overrideError) });
    }

    // --- live-drift: compute & store first-class metric, inject into pipeline ctx ---
    let liveDrift: LiveDriftStatus | undefined;
    try {
      const rsResult = await deps.persistence.readLiveRSeries(configResult.value.params.drift_window);
      if (rsResult.ok) {
        const baselineResult = await deps.persistence.readDriftBaseline();
        if (baselineResult.ok) {
          const status = evaluateLiveDrift({
            liveRs: rsResult.value,
            baselineLower: baselineResult.value?.lower,
            minSamples: configResult.value.params.drift_min_samples,
            window: configResult.value.params.drift_window,
          });
          liveDrift = status;
          // Always persist the metric (first-class indicator)
          const metricResult = await deps.persistence.writeDriftMetric({
            ...status,
            atEpochMillis: toEpochMillis,
          });
          if (!metricResult.ok) {
            logger("drift_metric_write_failed", { error: metricResult.error });
          }
        } else {
          logger("drift_baseline_read_failed", { error: baselineResult.error });
        }
      } else {
        logger("drift_r_series_read_failed", { error: rsResult.error });
      }
    } catch (driftError) {
      logger("drift_computation_failed", { detail: driftError instanceof Error ? driftError.message : String(driftError) });
    }

    const fromEpochMillis = toEpochMillis - deps.tickConfig.lookbackMs;
    const snapshotResult = await deps.ingestion.getMarketSnapshot({
      pair: deps.tickConfig.pair,
      timeframe: deps.tickConfig.timeframe,
      fromEpochMillis,
      toEpochMillis
    });

    if (!snapshotResult.ok) {
      return skipped("ingestion_failed", logger, { error: snapshotResult.error });
    }

    if (snapshotResult.value.warnings.length > 0) {
      logger("snapshot_warnings", { warnings: snapshotResult.value.warnings });
    }

    // Resolve account equity: prefer live balance probe, fall back to config seam.
    let account: AccountState | undefined = deps.tickConfig.account;
    if (deps.accountPort !== undefined) {
      const balanceResult = await deps.accountPort.readBalance();
      if (!balanceResult.ok) {
        return skipped("balance_read_failed", logger, { error: balanceResult.error });
      }
      account = { equity: balanceResult.value.equity };
    }

    const pipelineResult = runPipeline(
      [
        createTier0(),
        createTier1(deps.tickConfig.assetClass),
        createTier2(),
        createTier3()
      ],
      {
        input: snapshotResult.value,
        state: tickedState,
        config: configResult.value,
        ...(account !== undefined ? { account } : {}),
        ...(liveDrift !== undefined ? { liveDrift } : {}),
        ...(overrideGrants !== undefined ? { overrideGrants } : {}),
      },
      deps.clock
    );

    if (pipelineResult.outcome === "silent") {
      // Only log blocks with discipline value (tier0 behavioural, tier3 cost/rr).
      // tier1/tier2 "no direction/setup" = quiet market — not a meaningful block.
      if (
        pipelineResult.vetoedBy === "tier0" ||
        pipelineResult.vetoedBy === "tier3"
      ) {
        const blockEvent = buildSuggestionBlockedEvent({
          pair: snapshotResult.value.pair,
          timeframe: snapshotResult.value.timeframe,
          atEpochMillis: toEpochMillis,
          vetoedBy: pipelineResult.vetoedBy,
          reason: pipelineResult.reason ?? "vetoed",
          configVersion: configResult.value.version,
          snapshotSchemaVersion: MARKET_SNAPSHOT_SCHEMA_VERSION,
        });
        const auditResult = await deps.persistence.appendAuditEvent(blockEvent);
        if (!auditResult.ok) {
          logger("audit_append_failed", { error: auditResult.error });
        }
      }

      return {
        status: "silent",
        ...(pipelineResult.vetoedBy !== undefined ? { vetoedBy: pipelineResult.vetoedBy } : {}),
        ...(pipelineResult.reason !== undefined ? { reason: pipelineResult.reason } : {})
      };
    }

    if (
      pipelineResult.direction === undefined ||
      pipelineResult.candidate === undefined ||
      pipelineResult.sizing === undefined
    ) {
      return skipped("pipeline_suggestion_missing_decision", logger, { pipelineResult });
    }

    let suggestion: Suggestion = {
      kind: "trade",
      pair: snapshotResult.value.pair,
      timeframe: snapshotResult.value.timeframe,
      atEpochMillis: toEpochMillis,
      direction: pipelineResult.direction,
      candidate: pipelineResult.candidate,
      sizing: pipelineResult.sizing,
      configVersion: configResult.value.version,
      snapshotSchemaVersion: MARKET_SNAPSHOT_SCHEMA_VERSION,
      ...(pipelineResult.signals !== undefined ? { signals: pipelineResult.signals } : {}),
    };

    // --- narrator: generate human-readable "why" (AD-9, non-blocking) ---
    if (deps.narrator !== undefined) {
      const narrationResult = await deps.narrator.narrate({
        input: snapshotResult.value,
        state: tickedState,
        config: configResult.value,
        suggestion,
      });
      if (narrationResult.ok) {
        suggestion = { ...suggestion, narration: narrationResult.value };
      } else {
        suggestion = { ...suggestion, narrationError: { code: narrationResult.error.code, context: narrationResult.error.context } };
        logger("narrator_failed", { error: narrationResult.error });
      }
    }

    const saveResult = await deps.persistence.saveSuggestion(suggestion);
    if (!saveResult.ok) {
      logger("suggestion_save_failed", { error: saveResult.error, suggestion });
    }

    const emittedEvent = buildSuggestionEmittedEvent({
      suggestion,
      atEpochMillis: toEpochMillis,
    });
    const auditResult = await deps.persistence.appendAuditEvent(emittedEvent);
    if (!auditResult.ok) {
      logger("audit_append_failed", { error: auditResult.error });
    }

    return { status: "suggestion", suggestion };
  } catch (error) {
    return skipped("tick_exception", logger, { detail: error instanceof Error ? error.message : String(error) });
  }
}

function skipped(
  reason: string,
  logger: (message: string, context?: Readonly<Record<string, unknown>>) => void,
  context: Readonly<Record<string, unknown>>
): TickResult {
  logger(reason, context);
  return { status: "skipped", reason };
}

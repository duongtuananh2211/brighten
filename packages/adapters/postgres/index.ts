import {
  createConfigVersion,
  snapshot,
  validateParams
} from "@brighten/config";
import { div } from "@brighten/decision-core/math";
import type {
  BehavioralState,
  PersistencePort,
  Result
} from "@brighten/decision-core";

const source = "adapter.postgres";

export interface SqlQueryResult<T = unknown> {
  readonly rows: readonly T[];
}

export interface SqlClient {
  readonly query: <T = unknown>(
    text: string,
    values?: readonly unknown[]
  ) => Promise<SqlQueryResult<T>>;
}

export interface PostgresPersistenceDeps {
  readonly sql: SqlClient;
  readonly logger?: (message: string, context?: Readonly<Record<string, unknown>>) => void;
}

interface ConfigRow {
  readonly version: number;
  readonly params: unknown;
  readonly created_at?: unknown;
}

interface BehavioralStateRow {
  readonly win_streak: number;
  readonly daily_loss: string;
  readonly last_loss_epoch_millis?: number | string | null;
  readonly trade_count_today: number;
  readonly trading_day_start_epoch_millis?: number | string | null;
}

export function createPostgresPersistence(deps: PostgresPersistenceDeps): PersistencePort {
  const logger = deps.logger ?? (() => undefined);

  return {
    async readConfigSnapshot(version) {
      try {
        const result =
          version === undefined
            ? await deps.sql.query<ConfigRow>(
                "select version, params, created_at from config order by version desc limit 1"
              )
            : await deps.sql.query<ConfigRow>(
                "select version, params, created_at from config where version = $1 limit 1",
                [version]
              );
        const row = result.rows[0];
        if (row === undefined) {
          return failure("config_not_found", { version });
        }

        const paramsPayload = parseJsonb(row.params);
        if (!paramsPayload.ok) {
          return paramsPayload;
        }

        const validation = validateParams(paramsPayload.value);
        if (!validation.ok) {
          return {
            ok: false,
            error: {
              code: validation.error.code,
              source,
              context: validation.error.context
            }
          };
        }

        return {
          ok: true,
          value: snapshot(createConfigVersion(validation.value, row.version - 1, createdAtMillis(row.created_at)))
        };
      } catch (error) {
        logger("postgres_config_read_failed", { detail: detail(error) });
        return failure("db_error", { operation: "readConfigSnapshot", detail: detail(error) });
      }
    },

    async readBehavioralState() {
      try {
        const result = await deps.sql.query<BehavioralStateRow>(
          "select win_streak, daily_loss, last_loss_epoch_millis, trade_count_today, trading_day_start_epoch_millis from behavioral_state order by id asc limit 1"
        );
        const row = result.rows[0];
        if (row === undefined) {
          return failure("behavioral_state_not_found", {});
        }

        return { ok: true, value: mapBehavioralState(row) };
      } catch (error) {
        logger("postgres_state_read_failed", { detail: detail(error) });
        return failure("db_error", { operation: "readBehavioralState", detail: detail(error) });
      }
    },

    async writeBehavioralState(state) {
      try {
        await deps.sql.query(
          `update behavioral_state
           set win_streak = $1,
               daily_loss = $2,
               last_loss_epoch_millis = $3,
               trade_count_today = $4,
               trading_day_start_epoch_millis = $5,
               updated_at = now()
           where id = 1`,
          [
            state.winStreak,
            state.dailyLoss,
            state.lastLossEpochMillis ?? null,
            state.tradeCountToday,
            state.tradingDayStartEpochMillis ?? null
          ]
        );
        return { ok: true, value: undefined };
      } catch (error) {
        logger("postgres_state_write_failed", { detail: detail(error) });
        return failure("db_error", { operation: "writeBehavioralState", detail: detail(error) });
      }
    },

    async saveSuggestion(suggestion) {
      try {
        await deps.sql.query(
          "insert into suggestions (payload) values ($1)",
          [suggestion]
        );
        return { ok: true, value: undefined };
      } catch (error) {
        logger("postgres_suggestion_save_failed", { detail: detail(error) });
        return failure("db_error", { operation: "saveSuggestion", detail: detail(error) });
      }
    },

    async appendAuditEvent(event) {
      try {
        await deps.sql.query(
          "insert into audit_events (type, at_epoch_millis, payload) values ($1, $2, $3)",
          [event.type, event.atEpochMillis, event.payload]
        );
        return { ok: true, value: undefined };
      } catch (error) {
        logger("postgres_audit_insert_failed", { detail: detail(error) });
        return failure("db_error", { operation: "appendAuditEvent", detail: detail(error) });
      }
    },

    async hasProcessedFill(fillId) {
      try {
        const result = await deps.sql.query<{ readonly exists: boolean }>(
          "select exists (select 1 from account_fills where fill_id = $1) as exists",
          [fillId]
        );
        const row = result.rows[0];
        return { ok: true, value: row?.exists === true };
      } catch (error) {
        logger("postgres_has_processed_fill_failed", { detail: detail(error) });
        return failure("db_error", { operation: "hasProcessedFill", detail: detail(error) });
      }
    },

    async recordProcessedFill(trade) {
      try {
        await deps.sql.query(
          "insert into account_fills (fill_id, symbol, realized_pnl, closed_epoch_millis, raw) values ($1, $2, $3, $4, $5) on conflict (fill_id) do nothing",
          [trade.fillId, trade.symbol, trade.realizedPnl, trade.closedEpochMillis, trade]
        );
        return { ok: true, value: undefined };
      } catch (error) {
        logger("postgres_record_fill_failed", { detail: detail(error) });
        return failure("db_error", { operation: "recordProcessedFill", detail: detail(error) });
      }
    },

    async recordAttribution(input) {
      try {
        await deps.sql.query(
          "insert into trade_attributions (fill_id, suggestion_id, result) values ($1, $2, $3) on conflict (fill_id) do nothing",
          [input.fillId, input.suggestionId, input.result]
        );
        return { ok: true, value: undefined };
      } catch (error) {
        logger("postgres_record_attribution_failed", { detail: detail(error) });
        return failure("db_error", { operation: "recordAttribution", detail: detail(error) });
      }
    },

    async readDriftBaseline() {
      try {
        const result = await deps.sql.query<{
          readonly lower: string;
          readonly median: string;
          readonly upper: string;
          readonly config_version?: number | null;
        }>("select lower, median, upper, config_version from drift_baseline where id = 1");
        const row = result.rows[0];
        if (row === undefined) return { ok: true, value: null };
        return {
          ok: true,
          value: {
            lower: row.lower,
            median: row.median,
            upper: row.upper,
            ...(row.config_version != null ? { configVersion: row.config_version } : {}),
          },
        };
      } catch (error) {
        logger("postgres_read_drift_baseline_failed", { detail: detail(error) });
        return failure("db_error", { operation: "readDriftBaseline", detail: detail(error) });
      }
    },

    async setDriftBaseline(baseline) {
      try {
        await deps.sql.query(
          `insert into drift_baseline (id, lower, median, upper, config_version, updated_at)
           values (1, $1, $2, $3, $4, now())
           on conflict (id) do update set lower = $1, median = $2, upper = $3, config_version = $4, updated_at = now()`,
          [baseline.lower, baseline.median, baseline.upper, baseline.configVersion ?? null]
        );
        return { ok: true, value: undefined };
      } catch (error) {
        logger("postgres_set_drift_baseline_failed", { detail: detail(error) });
        return failure("db_error", { operation: "setDriftBaseline", detail: detail(error) });
      }
    },

    async readLiveRSeries(window) {
      try {
        // Join trade_attributions × account_fills × suggestions to compute R values.
        // R = realizedPnl / riskAmount (net, same unit as backtest).
        // Returns raw strings; R computation uses math/decimal.ts for single-source precision.
        const result = await deps.sql.query<{
          readonly realized_pnl: string;
          readonly risk_amount: string | null;
        }>(
          `select f.realized_pnl, (s.payload->'sizing'->>'riskAmount') as risk_amount
           from trade_attributions ta
           join account_fills f on ta.fill_id = f.fill_id
           join suggestions s on ta.suggestion_id = s.id
           order by f.closed_epoch_millis desc
           limit $1`,
          [window]
        );
        // R = realizedPnl / riskAmount computed in JS (not SQL) for precision consistency
        const rs: string[] = [];
        for (const row of result.rows) {
          const riskAmount = row.risk_amount;
          if (riskAmount !== null && riskAmount !== undefined && riskAmount !== "0") {
            rs.push(div(row.realized_pnl, riskAmount));
          }
        }
        // Reverse to chronological order (most recent last)
        return { ok: true, value: rs.reverse() };
      } catch (error) {
        logger("postgres_read_live_r_series_failed", { detail: detail(error) });
        return failure("db_error", { operation: "readLiveRSeries", detail: detail(error) });
      }
    },

    async writeDriftMetric(status) {
      try {
        await deps.sql.query(
          `insert into drift_metrics (live_expectancy, drifting, sample_count, baseline_lower, at_epoch_millis)
           values ($1, $2, $3, $4, $5)`,
          [status.liveExpectancy, status.drifting, status.sampleCount, status.baselineLower, status.atEpochMillis]
        );
        return { ok: true, value: undefined };
      } catch (error) {
        logger("postgres_write_drift_metric_failed", { detail: detail(error) });
        return failure("db_error", { operation: "writeDriftMetric", detail: detail(error) });
      }
    },

    async recordOverrideGrant(input) {
      try {
        await deps.sql.query(
          `insert into override_grants (rule_code, reason, typed_confirmation, requested_at_epoch_millis, active_from_epoch_millis, expires_at_epoch_millis)
           values ($1, $2, $3, $4, $5, $6)`,
          [input.grant.ruleCode, input.grant.reason, input.typedConfirmation, input.grant.requestedAtEpochMillis, input.grant.activeFromEpochMillis, input.grant.expiresAtEpochMillis]
        );
        return { ok: true, value: undefined };
      } catch (error) {
        logger("postgres_record_override_failed", { detail: detail(error) });
        return failure("db_error", { operation: "recordOverrideGrant", detail: detail(error) });
      }
    },

    async readActiveOverrideGrants(nowEpochMillis) {
      try {
        const result = await deps.sql.query<{
          readonly rule_code: string;
          readonly reason: string;
          readonly requested_at_epoch_millis: number;
          readonly active_from_epoch_millis: number;
          readonly expires_at_epoch_millis: number;
        }>(
          `select rule_code, reason, requested_at_epoch_millis, active_from_epoch_millis, expires_at_epoch_millis
           from override_grants
           where active_from_epoch_millis <= $1 and expires_at_epoch_millis > $1`,
          [nowEpochMillis]
        );
        return {
          ok: true,
          value: result.rows.map(r => ({
            ruleCode: r.rule_code,
            reason: r.reason,
            requestedAtEpochMillis: r.requested_at_epoch_millis,
            activeFromEpochMillis: r.active_from_epoch_millis,
            expiresAtEpochMillis: r.expires_at_epoch_millis,
          })),
        };
      } catch (error) {
        logger("postgres_read_override_grants_failed", { detail: detail(error) });
        return failure("db_error", { operation: "readActiveOverrideGrants", detail: detail(error) });
      }
    }
  };
}

function mapBehavioralState(row: BehavioralStateRow): BehavioralState {
  const lastLossEpochMillis =
    row.last_loss_epoch_millis === null || row.last_loss_epoch_millis === undefined
      ? undefined
      : Number(row.last_loss_epoch_millis);

  const tradingDayStartEpochMillis =
    row.trading_day_start_epoch_millis === null || row.trading_day_start_epoch_millis === undefined
      ? undefined
      : Number(row.trading_day_start_epoch_millis);

  return {
    winStreak: row.win_streak,
    dailyLoss: row.daily_loss,
    tradeCountToday: row.trade_count_today,
    ...(lastLossEpochMillis !== undefined ? { lastLossEpochMillis } : {}),
    ...(tradingDayStartEpochMillis !== undefined ? { tradingDayStartEpochMillis } : {}),
  };
}

function parseJsonb(value: unknown): Result<unknown> {
  if (typeof value !== "string") {
    return { ok: true, value };
  }

  try {
    return { ok: true, value: JSON.parse(value) as unknown };
  } catch (error) {
    return failure("invalid_jsonb", { detail: detail(error) });
  }
}

function createdAtMillis(value: unknown): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function failure(code: string, context: Readonly<Record<string, unknown>>): Result<never> {
  return {
    ok: false,
    error: {
      code,
      source,
      context
    }
  };
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

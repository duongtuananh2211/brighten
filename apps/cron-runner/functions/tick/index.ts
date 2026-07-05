import {
  createBinanceRestIngestion,
  createPostgresPersistence,
  systemClockAdapterScaffold
} from "@brighten/adapters";
import type { SqlClient } from "@brighten/adapters";
import type { Tier1AssetClass } from "@brighten/decision-core";
import { runTick } from "../../../apps/cron-runner/dist/src/tick.js";

declare const Deno: {
  readonly env: {
    readonly get: (key: string) => string | undefined;
  };
  readonly serve: (
    handler: () => Response | Promise<Response>
  ) => unknown;
};

type PostgresFactory = (url: string) => {
  readonly unsafe: (text: string, values?: readonly unknown[]) => Promise<readonly unknown[]>;
  readonly end?: () => Promise<void>;
};

Deno.serve(async () => {
  try {
    const result = await runTick({
      ingestion: createBinanceRestIngestion({
        fapiBaseUrl: env("BINANCE_BASE_URL", "https://fapi.binance.com")
      }),
      persistence: createPostgresPersistence({
        sql: await createSqlClient(),
        logger
      }),
      clock: systemClockAdapterScaffold,
      tickConfig: {
        pair: env("PAIR", "BTCUSDT"),
        timeframe: env("TIMEFRAME", "1m"),
        assetClass: parseAssetClass(env("ASSET_CLASS", "crypto")),
        lookbackMs: Number(env("LOOKBACK_MS", "3600000")),
        account: { equity: env("ACCOUNT_EQUITY", "10000") }
      },
      logger
    });

    return json(result);
  } catch (error) {
    logger("tick_handler_exception", { detail: detail(error) });
    return json({ status: "skipped", reason: "tick_handler_exception" });
  }
});

async function createSqlClient(): Promise<SqlClient> {
  const databaseUrl = Deno.env.get("DATABASE_URL");
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    return unavailableSqlClient("DATABASE_URL is required");
  }

  const moduleUrl = env("POSTGRES_JS_URL", "https://deno.land/x/postgresjs@v3.4.5/mod.js");
  const mod = await import(moduleUrl) as { readonly default?: PostgresFactory };
  const postgres = mod.default;
  if (postgres === undefined) {
    return unavailableSqlClient("Postgres module did not expose a default factory");
  }

  const sql = postgres(databaseUrl);
  return {
    async query<T>(text: string, values?: readonly unknown[]) {
      const rows = await sql.unsafe(text, values);
      return { rows: rows as readonly T[] };
    }
  };
}

function unavailableSqlClient(message: string): SqlClient {
  return {
    async query() {
      throw new Error(message);
    }
  };
}

function parseAssetClass(value: string): Tier1AssetClass {
  return value === "fx" ? "fx" : "crypto";
}

function env(key: string, fallback: string): string {
  return Deno.env.get(key) ?? fallback;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200
  });
}

function logger(message: string, context: Readonly<Record<string, unknown>> = {}): void {
  console.log(JSON.stringify({ message, ...context }));
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

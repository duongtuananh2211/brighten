import { createBinanceAccount, createPostgresPersistence, systemClockAdapterScaffold } from "@brighten/adapters";
import type { SqlClient } from "@brighten/adapters";
import type { runFeedback as runFeedbackType } from "../../src/feedback.js";

declare const Deno: {
  readonly env: {
    readonly get: (key: string) => string | undefined;
  };
  readonly serve: (
    handler: (req: Request) => Response | Promise<Response>
  ) => unknown;
};

type PostgresFactory = (url: string) => {
  readonly unsafe: (text: string, values?: readonly unknown[]) => Promise<readonly unknown[]>;
  readonly end?: () => Promise<void>;
};

const feedbackModulePath = "../../src/feedback.ts";

Deno.serve(async () => {
  try {
    const { runFeedback } = await import(feedbackModulePath) as { readonly runFeedback: typeof runFeedbackType };

    const result = await runFeedback({
      account: createBinanceAccount({
        signer: () => "",
        apiKey: Deno.env.get("BINANCE_API_KEY") ?? "",
        logger: console.error,
      }),
      persistence: createPostgresPersistence({ sql: await createSqlClient(), logger: console.error }),
      clock: systemClockAdapterScaffold,
      sinceLookbackMs: 10 * 60_000,
      logger: console.error,
    });

    return json(result);
  } catch (error) {
    logger("feedback_handler_exception", { detail: detail(error) });
    return json({ status: "skipped", reason: "feedback_handler_exception" });
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
    async query() { throw new Error(message); }
  };
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

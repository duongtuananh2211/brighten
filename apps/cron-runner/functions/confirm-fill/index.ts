import { createPostgresPersistence } from "@brighten/adapters";
import type { SqlClient } from "@brighten/adapters";
import type { confirmFill as confirmFillType } from "../../src/feedback.js";

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

Deno.serve(async (req: Request) => {
  try {
    const body = await req.json() as { fillId?: string; suggestionId?: string; result?: "win" | "loss" };

    if (typeof body.fillId !== "string" || typeof body.suggestionId !== "string" || (body.result !== "win" && body.result !== "loss")) {
      return json({ ok: false, error: { code: "invalid_input", source: "confirm-fill" } }, 400);
    }

    const { confirmFill } = await import(feedbackModulePath) as { readonly confirmFill: typeof confirmFillType };

    const persistence = createPostgresPersistence({ sql: await createSqlClient(), logger: console.error });

    const result = await confirmFill(
      { persistence, clock: { nowEpochMillis: () => Date.now() }, logger: console.error },
      { fillId: body.fillId, suggestionId: body.suggestionId, result: body.result },
    );

    return json(result, result.ok ? 200 : 500);
  } catch {
    return json({ ok: false, error: { code: "exception", source: "confirm-fill" } }, 500);
  }
});

async function createSqlClient(): Promise<SqlClient> {
  const databaseUrl = Deno.env.get("DATABASE_URL");
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    return { async query() { throw new Error("DATABASE_URL is required"); } };
  }
  const moduleUrl = Deno.env.get("POSTGRES_JS_URL") ?? "https://deno.land/x/postgresjs@v3.4.5/mod.js";
  const mod = await import(moduleUrl) as { readonly default?: PostgresFactory };
  const postgres = mod.default;
  if (postgres === undefined) {
    return { async query() { throw new Error("Postgres module did not expose a default factory"); } };
  }
  const sql = postgres(databaseUrl);
  return {
    async query<T>(text: string, values?: readonly unknown[]) {
      const rows = await sql.unsafe(text, values);
      return { rows: rows as readonly T[] };
    }
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status
  });
}

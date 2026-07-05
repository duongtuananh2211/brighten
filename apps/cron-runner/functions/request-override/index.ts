// Edge Function entrypoint for override request (Story 3.6).
// Called by apps/web (epic 4) when user clicks "Override" after friction gates.

import { createPostgresPersistence } from "@brighten/adapters";
import type { SqlClient } from "@brighten/adapters";
import { requestOverride } from "../../../apps/cron-runner/dist/src/override.js";

declare const Deno: {
  readonly env: { readonly get: (key: string) => string | undefined };
  readonly serve: (handler: (req: Request) => Response | Promise<Response>) => unknown;
};

type PostgresFactory = (url: string) => {
  readonly unsafe: (text: string, values?: readonly unknown[]) => Promise<readonly unknown[]>;
};

Deno.serve(async (req: Request) => {
  try {
    const body = await req.json() as { ruleCode?: string; reason?: string; typedConfirmation?: string };

    if (typeof body.ruleCode !== "string" || typeof body.reason !== "string" || typeof body.typedConfirmation !== "string") {
      return json({ ok: false, error: { code: "invalid_input", source: "request-override" } }, 400);
    }

    const persistence = createPostgresPersistence({ sql: await createSqlClient(), logger: console.error });

    const result = await requestOverride(
      { persistence, clock: { nowEpochMillis: () => Date.now() }, logger: console.error },
      { ruleCode: body.ruleCode, reason: body.reason, typedConfirmation: body.typedConfirmation },
    );

    return json(result, result.ok ? 200 : 422);
  } catch {
    return json({ ok: false, error: { code: "exception", source: "request-override" } }, 500);
  }
});

async function createSqlClient(): Promise<SqlClient> {
  const databaseUrl = Deno.env.get("DATABASE_URL");
  if (databaseUrl === undefined) {
    return { async query() { throw new Error("DATABASE_URL is required"); } };
  }
  const mod = await import(Deno.env.get("POSTGRES_JS_URL") ?? "https://deno.land/x/postgresjs@v3.4.5/mod.js") as { readonly default?: PostgresFactory };
  const postgres = mod.default;
  if (postgres === undefined) throw new Error("Postgres module unavailable");
  const sql = postgres(databaseUrl);
  return { async query<T>(text: string, values?: readonly unknown[]) { const rows = await sql.unsafe(text, values); return { rows: rows as readonly T[] }; } };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
}

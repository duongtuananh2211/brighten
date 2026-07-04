import type { PipelineResult } from "@brighten/decision-core";

declare const Deno: {
  readonly serve: (
    handler: () => Response | Promise<Response>
  ) => unknown;
};

Deno.serve(() => {
  const scaffoldResult: PipelineResult = { outcome: "silent" };

  return new Response(
    JSON.stringify({ ok: true, core: scaffoldResult.outcome }),
    { headers: { "content-type": "application/json" }, status: 200 }
  );
});

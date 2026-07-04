import type { DecisionCoreScaffold } from "@brighten/decision-core";

declare const Deno: {
  readonly serve: (
    handler: () => Response | Promise<Response>
  ) => unknown;
};

Deno.serve(() => {
  const scaffold: DecisionCoreScaffold = { name: "decision-core" };

  return new Response(
    JSON.stringify({ ok: true, core: scaffold.name }),
    { headers: { "content-type": "application/json" }, status: 200 }
  );
});

import { createClient } from "../../lib/supabase/server";
import { getAuditEventsPage, getOverrideHistory } from "../../lib/queries";
import { LiveStatus } from "../../components/LiveStatus";
import { AuditEventRow } from "../../components/AuditEventRow";
import { OverrideHistory } from "../../components/OverrideHistory";

export default async function NhatKyPage() {
  let events: readonly Record<string, unknown>[] = [];
  let overrides: readonly Record<string, unknown>[] = [];
  let error: string | null = null;

  try {
    const client = createClient();
    events = await getAuditEventsPage(client, { limit: 50 });
    overrides = await getOverrideHistory(client);
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load";
  }

  return (
    <main className="min-h-screen p-6 md:p-8 max-w-3xl mx-auto">
      <header className="mb-8 pb-4 border-b flex items-center justify-between" style={{ borderColor: "var(--color-border)" }}>
        <div>
          <h1 className="font-display text-3xl font-medium" style={{ color: "var(--color-text)" }}>Journal</h1>
          <LiveStatus />
        </div>
        <a href="/" className="text-sm" style={{ color: "var(--color-primary)" }}>← Now</a>
      </header>

      {error !== null && (
        <div className="rounded-lg p-4 mb-6" style={{ background: "var(--color-surface-dim)", color: "var(--color-text-muted)" }}>
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* Override History */}
      <div className="mb-8">
        <OverrideHistory grants={overrides} />
      </div>

      {/* Audit Events */}
      <section>
        <h2 className="text-xs uppercase tracking-wider mb-3" style={{ color: "var(--color-text-muted)" }}>
          Activity Log
        </h2>

        {events.length === 0 ? (
          <div className="rounded-lg p-8 text-center" style={{ background: "var(--color-surface-dim)" }}>
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>No records yet — the engine hasn&apos;t produced any events.</p>
          </div>
        ) : (
          <div>
            {events.map((e) => (
              <AuditEventRow key={String(e.id ?? "")} event={e} />
            ))}
          </div>
        )}
      </section>

      {/* Navigation */}
      <nav className="mt-8 pt-4 border-t text-center" style={{ borderColor: "var(--color-border)" }}>
        <a href="/" className="text-sm" style={{ color: "var(--color-primary)" }}>Back to Now</a>
      </nav>
    </main>
  );
}

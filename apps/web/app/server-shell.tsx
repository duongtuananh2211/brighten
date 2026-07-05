import { createClient } from "../lib/supabase/server";
import {
  getLatestSuggestion,
  getBehavioralState,
  getLatestDriftMetric,
  getDriftBaseline,
  isSuggestionFresh,
  isSystemAlive,
  haltState,
} from "../lib/queries";
import { LiveStatus } from "../components/LiveStatus";
import { SuggestionCard } from "../components/SuggestionCard";
import { TrustRail } from "../components/TrustRail";
import { HaltBanner } from "../components/HaltBanner";
import { SilenceState } from "../components/SilenceState";

export async function ServerShell() {
  let suggestion: Awaited<ReturnType<typeof getLatestSuggestion>> = null;
  let state: Awaited<ReturnType<typeof getBehavioralState>> = null;
  let drift: Awaited<ReturnType<typeof getLatestDriftMetric>> = null;
  let baseline: Awaited<ReturnType<typeof getDriftBaseline>> = null;
  let error: string | null = null;

  try {
    const client = createClient();
    suggestion = await getLatestSuggestion(client);
    state = await getBehavioralState(client);
    drift = await getLatestDriftMetric(client);
    baseline = await getDriftBaseline(client);
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load data";
  }

  const nowMs = Date.now();
  const systemAlive = isSystemAlive(drift?.atEpochMillis, nowMs);
  const hasFreshSuggestion =
    suggestion !== null && isSuggestionFresh(suggestion.atEpochMillis, nowMs);
  const halt = haltState({
    drifting: drift?.drifting ?? false,
    latestTier0BlockReason: null, // fetched from audit_events in a full implementation
  });

  return (
    <main className="min-h-screen p-6 md:p-8 max-w-3xl mx-auto">
      {/* Header */}
      <header className="mb-6 pb-4 border-b flex items-center justify-between" style={{ borderColor: "var(--color-border)" }}>
        <div>
          <h1 className="font-display text-3xl font-medium" style={{ color: "var(--color-text)" }}>
            Brighten
          </h1>
          <LiveStatus />
        </div>
        <a href="/nhat-ky" className="text-sm" style={{ color: "var(--color-primary)" }}>Journal →</a>
      </header>

      {/* Error state */}
      {error !== null && (
        <div className="rounded-lg p-4 mb-6" style={{ background: "var(--color-surface-dim)", color: "var(--color-text-muted)" }}>
          <p className="text-sm">Unable to load data: {error}</p>
        </div>
      )}

      {/* Halt banner (suppresses card when halted) */}
      {halt.halted && (
        <HaltBanner reason={halt.reason} kind={halt.kind} />
      )}

      {/* Trust Rail — always visible */}
      {drift !== null && (
        <TrustRail
          liveExpectancy={drift.liveExpectancy}
          sampleCount={drift.sampleCount}
          drifting={drift.drifting}
          baseline={baseline}
        />
      )}

      {/* Main content: card or silence (suppressed when halted) */}
      {!halt.halted && error === null && hasFreshSuggestion && suggestion !== null ? (
        <SuggestionCard
          suggestion={suggestion}
          winStreak={state?.winStreak}
        />
      ) : !halt.halted && error === null ? (
        <SilenceState alive={systemAlive} />
      ) : null}

      {/* State summary (compact) */}
      {state !== null && (
        <section className="rounded-lg p-4 mt-4" style={{ background: "var(--color-surface-dim)" }}>
          <div className="flex gap-6 text-sm">
            <MiniStat label="Win Streak" value={String(state.winStreak)} />
            <MiniStat label="Daily Loss" value={`$${state.dailyLoss}`} />
            <MiniStat label="Trades Today" value={String(state.tradeCountToday)} />
            {drift !== null && (
              <MiniStat
                label="Expectancy"
                value={drift.liveExpectancy}
                muted={drift.drifting}
              />
            )}
          </div>
        </section>
      )}
    </main>
  );
}

function MiniStat({ label, value, muted }: { readonly label: string; readonly value: string; readonly muted?: boolean }) {
  return (
    <div>
      <span className="text-xs block" style={{ color: "var(--color-text-muted)" }}>{label}</span>
      <span className="font-mono text-sm data-num" style={{ color: muted === true ? "var(--color-halt)" : "var(--color-text)" }}>
        {value}
      </span>
    </div>
  );
}
